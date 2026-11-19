const maxBankInput = 1_000_000_000 * 400;
const maxStake = 250 * 400;
const blankBank = () => ({
  collected:0, paid:0, reserve:0, adjustment:0,
  winRate:30, pushRate:0, lastChange:null, rounds:[]
});
const balance = bank => bank.collected + bank.reserve - bank.paid + bank.adjustment;
const json = (data, status = 200) => Response.json(data, {
  status, headers:{'Cache-Control':'no-store'}
});
const fail = (error, status = 400) => json({error}, status);

const cookieName = '__Host-zoya7-bank';
const sessionSeconds = 8 * 60 * 60;
const encoder = new TextEncoder();
const cookieFlags = '; Path=/; Secure; HttpOnly; SameSite=Strict';
const hex = bytes => Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2,'0')).join('');

async function signSession(secret, value) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret),
    {name:'HMAC', hash:'SHA-256'}, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}

function sameString(actual, expected) {
  if (actual.length !== expected.length) return false;
  let different = 0;
  for (let i = 0; i < actual.length; i++) different |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return different === 0;
}

async function hasSession(request, secret) {
  const cookie = (request.headers.get('Cookie') ?? '').split(';').map(entry => entry.trim())
    .find(entry => entry.startsWith(cookieName + '='));
  const value = cookie?.slice(cookieName.length + 1) ?? '';
  const match = /^(\d{10}\.[a-f0-9-]{36})\.([a-f0-9]{64})$/.exec(value);
  if (!secret || !match || Number(match[1].split('.')[0]) <= Math.floor(Date.now()/1000)) return false;
  return sameString(match[2], await signSession(secret, match[1]));
}

function redirect(location, cookie) {
  const headers = {'Location':location, 'Cache-Control':'no-store'};
  if (cookie !== undefined) headers['Set-Cookie'] = cookie;
  return new Response(null, {status:303, headers});
}

function loginPage(message = '', status = 200) {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bank sign in · Zoya7</title><link rel="stylesheet" href="/table.css">
</head><body class="bank-page"><main class="bank-shell">
<div class="bank-heading"><h1>Simulation Bank</h1></div>
<form method="post" action="/bank/login" id="settings-form">
<label for="password">Bank password</label>
<input type="password" name="password" id="password" autocomplete="current-password" required autofocus>
${message ? '<p role="alert">' + message + '</p>' : ''}
<button type="submit">Sign in</button>
</form><a href="/">Back to Blackjack</a></main></body></html>`, {
    status, headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store',
      'Content-Security-Policy':"default-src 'none'; style-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"}
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const secret = env.BANK_ADMIN_TOKEN;
    if (/%(?:2f|5c)/i.test(url.pathname)) return fail('Invalid path.');
    let path;
    try { path = decodeURIComponent(url.pathname).replace(/\/+/g,'/'); }
    catch { return fail('Invalid path.'); }
    const bankPage = /^\/bank(?:\/|$)/i.test(path);
    const api = path.startsWith('/api/');
    if ((api || bankPage) && request.method === 'POST' && request.headers.get('Origin') !== url.origin) {
      return fail('Submit this request from the game site.', 403);
    }
    if (path === '/bank/login' && request.method === 'POST') {
      if (!secret) return loginPage('The bank password has not been configured.', 503);
      const form = await request.formData().catch(() => null);
      const password = form?.get('password');
      if (typeof password !== 'string' || password.length > 512 ||
          !sameString(await signSession(secret, password), await signSession(secret, secret))) {
        return loginPage('Incorrect password.', 401);
      }
      const payload = (Math.floor(Date.now()/1000) + sessionSeconds) + '.' + crypto.randomUUID();
      const signature = await signSession(secret, payload);
      return redirect('/bank/', cookieName + '=' + payload + '.' + signature + cookieFlags + '; Max-Age=' + sessionSeconds);
    }
    if (path === '/bank/logout' && request.method === 'POST') {
      return redirect('/bank/', cookieName + '=' + cookieFlags + '; Max-Age=0');
    }
    if (bankPage || ['/api/bank','/api/settings','/api/reserve'].includes(path)) {
      if (!await hasSession(request, secret)) return bankPage ? loginPage() : fail('Sign in to the bank first.', 401);
      if (bankPage) {
        const asset = await env.ASSETS.fetch(request);
        const response = new Response(asset.body, asset);
        response.headers.set('Cache-Control','private, no-store');
        return response;
      }
    }
    if (!api) return env.ASSETS.fetch(request);
    return env.SIMULATION_BANK.get(env.SIMULATION_BANK.idFromName('shared')).fetch(request);
  }
};

function randomPercent() {
  const number = new Uint32Array(1);
  do { crypto.getRandomValues(number); } while (number[0] >= 4294967200);
  return number[0] % 100;
}

export class SimulationBank {
  constructor(ctx) { this.storage = ctx.storage; }

  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (request.method === 'GET' && ['/api/bank','/api/status'].includes(path)) {
      const bank = await this.storage.get('bank') ?? blankBank();
      return json(path === '/api/status' ? {balance:balance(bank)} : bank);
    }
    if (request.method !== 'POST' || !['/api/round','/api/settings','/api/reserve'].includes(path)) {
      return fail('Unknown endpoint.', 404);
    }
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('A JSON object is required.');
    return this.storage.transaction(async txn => {
      const bank = await txn.get('bank') ?? blankBank();
      if (path === '/api/round') return this.settleRound(txn, bank, body);
      if (path === '/api/reserve') {
        if (!Number.isSafeInteger(body.amount) || body.amount <= 0 || body.amount > maxBankInput ||
            !Number.isSafeInteger(bank.reserve + body.amount + bank.collected)) return fail('Invalid reserve amount.');
        bank.reserve += body.amount;
      } else {
        const {target, winRate = bank.winRate, pushRate = bank.pushRate} = body;
        if (!Number.isInteger(winRate) || !Number.isInteger(pushRate) ||
            winRate < 0 || pushRate < 0 || winRate + pushRate > 100) return fail('Win and push rates must total 100% or less.');
        if (target !== undefined) {
          if (!Number.isSafeInteger(target) || target < 0 || target > maxBankInput) return fail('Invalid bank balance.');
          bank.adjustment += target - balance(bank);
        }
        bank.winRate = winRate;
        bank.pushRate = pushRate;
      }
      await txn.put('bank', bank);
      return json(bank);
    });
  }

  async settleRound(txn, bank, {id, stake}) {
    if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id) ||
        !Number.isSafeInteger(stake) || stake < 200 || stake > maxStake || stake % 200 !== 0) {
      return fail('Choose a stake from 0.50 to 250 credits.');
    }
    const key = 'round:' + id;
    const existing = await txn.get(key);
    if (existing) return existing.bet === stake ? json({round:{outcome:existing.outcome}, bank:{balance:balance(bank)}}) : fail('Round ID already used.', 409);
    const roll = randomPercent();
    const bankLimited = roll < bank.winRate && balance(bank) < stake;
    const outcome = roll < bank.winRate ? (bankLimited ? 'loss' : 'win')
      : roll < bank.winRate + bank.pushRate ? 'push' : 'loss';
    const change = outcome === 'win' ? -stake : outcome === 'loss' ? stake : 0;
    bank.collected += Math.max(0, change);
    bank.paid += Math.max(0, -change);
    bank.lastChange = change;
    const round = {bet:stake, outcome, bankLimited, change, balance:balance(bank)};
    bank.rounds = [round, ...bank.rounds].slice(0, 100);
    await txn.put({bank, [key]:round});
    return json({round:{outcome}, bank:{balance:balance(bank)}});
  }
}
