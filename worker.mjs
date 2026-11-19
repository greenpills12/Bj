import { standardHand } from './standard-hand.mjs';
import { walletCall, WalletError } from './wallet.mjs';

const maxBankInput = 1_000_000_000 * 400;
const defaultInfo = {
  "title": "Blackjack rules",
  "rules": "Six decks. Dealer stands on all 17s and checks for blackjack with an Ace or ten showing.\nBlackjack pays 3 to 2. Other wins pay 1 to 1. A push returns your bet.\nDouble on your first two cards. Split equal-value cards into up to four hands per spot. Split Aces get one card each.\nInsurance is offered against an Ace, costs half your bet and pays 2 to 1 if the dealer has blackjack.\nBlackjack Classic has three betting spots. Choose a spot, then tap chips to bet.",
  "simulationTitle": "Simulation Mode",
  "simulationText": "The bank panel sets the win and push rates. A sampled win becomes a loss if the bank cannot cover it. A push returns the stake. Cards are randomly drawn to match the resulting outcome.\n\nPlace one bet using separate practice credits. Cards play out automatically. Wins pay 1 to 1.",
  "image": "",
  "alt": ""
};
const maxStake = 250 * 400;
const walletRulesKey = 'wallet-rules';
const defaultWalletRules = 'standard';
const blankBank = () => ({
  collected:0, paid:0, reserve:0, adjustment:0,
  winRate:30, pushRate:0, lastChange:null, rounds:[]
});
const publicPending = round => round ? {id:round.id, bet:round.bet, currency:round.currency, ruleset:round.ruleset ?? "simulation"} : null;
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
    if ((path === '/' || path === '/index.html') && url.searchParams.has('token')) {
      const token = url.searchParams.get('token');
      const currency = url.searchParams.get('currency') === 'DC' ? 'DC' : 'GC';
      const launch = new URL('/wallet/',url.origin);
      if (/^[a-f0-9]{64}$/.test(token)) launch.hash = new URLSearchParams({token,currency});
      return redirect(launch.pathname + launch.hash);
    }
    if (path === '/wallet' || path === '/wallet/') {
      const asset = await env.ASSETS.fetch(new Request(new URL('/',url.origin), request));
      const response = new Response(asset.body, asset);
      response.headers.set('Cache-Control','no-store');
      response.headers.set('Referrer-Policy','no-referrer');
      return response;
    }
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
    if (bankPage || (path === '/api/info' && request.method !== 'GET') || ['/api/bank','/api/history','/api/settings','/api/reserve','/api/wallet/settings'].includes(path)) {
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
  constructor(ctx, env) {
    this.storage = ctx.storage;
    this.env = env;
    this.walletBusy = new Set();
  }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    const scope = url.searchParams.get('wallet');
    if (scope !== null && !['DC','GC'].includes(scope)) return fail('Invalid wallet currency.');
    const bankKey = scope ? 'bank:wallet:' + scope : 'bank';
    if (path === '/api/wallet/session' || path === '/api/wallet/round') {
      if (request.method !== 'POST') return fail('Unknown endpoint.', 404);
      const body = await request.json().catch(() => null);
      if (typeof body?.token !== 'string' || !/^[a-f0-9]{64}$/.test(body.token)) return fail('Open this game from Zoya7.', 401);
      try {
        const player = await walletCall(this.env, 'authenticate', {token:body.token});
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(player.player ?? '') || !Array.isArray(player.currencies) || !player.balances) {
          throw new WalletError('The wallet returned an invalid player.', 502);
        }
        if (path.endsWith('/session')) return json({
          ...player, ruleset:await this.storage.get(walletRulesKey) ?? defaultWalletRules,
          pending:publicPending(await this.storage.get('wallet-active:' + player.player))
        });
        if (this.walletBusy.has(player.player)) return fail('A wallet request is in progress. Retry this round.', 503);
        this.walletBusy.add(player.player);
        try {
          return await this.playWalletRound(body, player);
        } finally {
          this.walletBusy.delete(player.player);
        }
      } catch (error) {
        if (error instanceof WalletError) return json({error:error.message, code:error.code}, error.status);
        return fail('Could not confirm the round. Retry the same bet.', 503);
      }
    }
    if (path === '/api/wallet/settings') {
      if (request.method !== 'POST') return fail('Unknown endpoint.', 404);
      const body = await request.json().catch(() => null);
      if (!['standard','simulation'].includes(body?.ruleset)) return fail('Choose a valid Blackjack mode.');
      await this.storage.put(walletRulesKey, body.ruleset);
      return json({ruleset:body.ruleset});
    }
    if (path === '/api/info') {
      if (request.method === 'GET') return json(await this.storage.get('info') ?? defaultInfo);
      if (request.method !== 'POST') return fail('Unknown endpoint.', 404);
      const body = await request.json().catch(() => null);
      if (!body || typeof body !== 'object') return fail('Invalid info panel.');
      const limits = {title:100, rules:5000, simulationTitle:100, simulationText:5000, alt:300, image:109300};
      const info = {};
      for (const [field, limit] of Object.entries(limits)) {
        if (typeof body[field] !== 'string' || body[field].length > limit) return fail('Invalid ' + field + '.');
        info[field] = body[field].trim();
      }
      if (info.image && (!info.alt || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(info.image))) {
        return fail('Choose a PNG, JPEG or WebP image and enter its description.');
      }
      if (encoder.encode(JSON.stringify(info)).length > 126000) return fail('Use a smaller graphic or shorter copy.');
      await this.storage.put('info', info);
      return json(info);
    }
    if (request.method === 'GET' && path === '/api/history') {
      const after = url.searchParams.get('after');
      if (after !== null && !/^[a-f0-9-]{36}$/.test(after)) return fail('Invalid archive cursor.');
      const entries = [...await this.storage.list({
        prefix:scope ? 'wallet-round:' + scope + ':' : 'round:', limit:51,
        ...(after ? {startAfter:(scope ? 'wallet-round:' + scope + ':' : 'round:') + after} : {})
      })];
      const page = entries.slice(0,50);
      return json({
        rounds:page.map(([key, round]) => ({...round, id:key.split(':').at(-1)})),
        nextAfter:entries.length > 50 ? page.at(-1)[0].split(':').at(-1) : null
      });
    }
    if (request.method === 'GET' && ['/api/bank','/api/status'].includes(path)) {
      const bank = await this.storage.get(bankKey) ?? blankBank();
      return json(path === '/api/status' ? {balance:balance(bank)} :
        {...bank, walletRuleset:await this.storage.get(walletRulesKey) ?? defaultWalletRules});
    }
    if (request.method !== 'POST' || !['/api/round','/api/settings','/api/reserve'].includes(path)) {
      return fail('Unknown endpoint.', 404);
    }
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('A JSON object is required.');
    return this.storage.transaction(async txn => {
      const bank = await txn.get(bankKey) ?? blankBank();
      if (path === '/api/round') {
        if (scope) return fail('Use the wallet round endpoint.');
        return this.settleRound(txn, bank, body);
      }
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
          if (target < (bank.held ?? 0)) return fail('Pending rounds need part of this reserve.');
          bank.adjustment += target - balance(bank);
        }
        bank.winRate = winRate;
        bank.pushRate = pushRate;
      }
      await txn.put(bankKey, bank);
      return json(bank);
    });
  }

  async playWalletRound({id, stake, currency, token}, player) {
    if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id) ||
        !['GC','DC'].includes(currency) || !Number.isSafeInteger(stake) ||
        stake <= 0 || stake > (currency === 'GC' ? 250000 * 400 : maxStake) ||
        stake % (currency === 'GC' ? 400 : 4) !== 0) return fail('Invalid wallet bet.');
    const activeKey = 'wallet-active:' + player.player;
    const bankKey = 'bank:wallet:' + currency;
    const roundKey = 'wallet-round:' + currency + ':' + id;
    const prepared = await this.storage.transaction(async txn => {
      const bank = await txn.get(bankKey) ?? blankBank();
      const existing = await txn.get(roundKey);
      if (existing) {
        if (existing.playerId !== player.player || existing.bet !== stake) return {error:'Round ID already used.'};
        return {round:existing, complete:true, bank};
      }
      const active = await txn.get(activeKey);
      if (active) return active.id === id && active.bet === stake && active.currency === currency
        ? {round:active} : {error:'Finish your pending round first.', pending:active};
      if (!player.currencies.includes(currency)) return {error:'This currency is switched off.'};
      const ruleset = await txn.get(walletRulesKey) ?? defaultWalletRules;
      if (ruleset === 'standard' && stake % (currency === 'GC' ? 800 : 8) !== 0) {
        return {error:'Standard bets must be in even GC or even DC cents for an exact 3:2 payout.'};
      }
      const available = balance(bank) - (bank.held ?? 0);
      const standard = ruleset === 'standard';
      if (standard && available < stake * 1.5) {
        return {error:'Bank reserve cannot cover a standard hand at this bet. No bet was charged.'};
      }
      const cards = standard ? standardHand() : null;
      const roll = standard ? null : randomPercent();
      const bankLimited = !standard && roll < bank.winRate && available < stake;
      const multiplier = cards ? cards.multiplier : roll < bank.winRate ? (bankLimited ? 0 : 2)
        : roll < bank.winRate + bank.pushRate ? 1 : 0;
      const outcome = multiplier > 1 ? 'win' : multiplier === 1 ? 'push' : 'loss';
      const held = standard ? stake * 1.5 : outcome === 'win' ? stake : 0;
      const round = {id, playerId:player.player, currency, bet:stake, ruleset, outcome, bankLimited,
        held, payout:stake * multiplier, ...(cards ? {cards:{player:cards.player, house:cards.house}} : {})};
      bank.held = (bank.held ?? 0) + held;
      await txn.put({[bankKey]:bank, [activeKey]:round});
      return {round};
    });
    if (prepared.error) return json({error:prepared.error, pending:publicPending(prepared.pending)}, prepared.pending ? 503 : 409);
    if (prepared.complete) {
      if (prepared.round.outcome === 'void') return fail('That round was canceled. Place a new bet.', 409);
      return json({round:prepared.round, balances:player.balances, bank:{balance:balance(prepared.bank)}});
    }
    const round = prepared.round;
    const amount = stake / 400;
    const booking = {token, round:id, currency};
    const refund = async () => {
      await walletCall(this.env, 'rollback', {...booking, txn:id + '-refund', ref:id + '-bet', amount});
      await this.finishWalletRound(activeKey, bankKey, roundKey, round, true);
      return fail('The payout exceeded Zoya7’s win cap. Your bet was refunded.', 409);
    };
    if (round.refunding) return refund();
    let wallet;
    try {
      wallet = await walletCall(this.env, 'bet', {...booking, txn:id + '-bet', amount});
    } catch (error) {
      // A timeout or expired session leaves the hold in place until the same round is retried.
      if (error instanceof WalletError && ['bet','balance','closed','currency','amount'].includes(error.code)) {
        await this.finishWalletRound(activeKey, bankKey, roundKey, round, true);
        return fail(error.message, error.status);
      }
      throw error;
    }
    const payout = (round.payout ?? (round.outcome === 'win' ? 2 * stake : round.outcome === 'push' ? stake : 0)) / 400;
    if (payout) {
      try {
        wallet = await walletCall(this.env, 'win', {...booking, txn:id + '-win', amount:payout});
      } catch (error) {
        if (!(error instanceof WalletError) || error.code !== 'limit') throw error;
        await this.storage.put(activeKey, {...round, refunding:true});
        return refund();
      }
    }
    const settled = await this.finishWalletRound(activeKey, bankKey, roundKey, round, false);
    return json({...settled, balances:wallet.balances});
  }

  async finishWalletRound(activeKey, bankKey, roundKey, round, canceled) {
    return this.storage.transaction(async txn => {
      const bank = await txn.get(bankKey) ?? blankBank();
      const active = await txn.get(activeKey);
      const existing = await txn.get(roundKey);
      if (existing) return {round:existing, bank:{balance:balance(bank)}};
      if (active?.id !== round.id) throw new WalletError('Round changed. Reopen the game from Zoya7.', 409);
      bank.held -= round.held;
      const payout = canceled ? round.bet : round.payout ?? (round.outcome === 'win' ? 2 * round.bet : round.outcome === 'push' ? round.bet : 0);
      const change = round.bet - payout;
      bank.collected += Math.max(0, change);
      bank.paid += Math.max(0, -change);
      const {held, ...record} = round;
      const completed = {...record, payout, outcome:canceled ? 'void' : round.outcome, change, balance:balance(bank), at:Date.now()};
      if (!canceled) {
        bank.lastChange = change;
        bank.rounds = [completed, ...bank.rounds].slice(0,100);
      }
      await txn.put({[bankKey]:bank,[roundKey]:completed});
      await txn.delete(activeKey);
      return {round:completed, bank:{balance:balance(bank)}};
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
    const round = {bet:stake, outcome, bankLimited, change, balance:balance(bank), at:Date.now()};
    bank.rounds = [round, ...bank.rounds].slice(0, 100);
    await txn.put({bank, [key]:round});
    return json({round:{outcome}, bank:{balance:balance(bank)}});
  }
}
