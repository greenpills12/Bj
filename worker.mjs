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

async function authorized(request, secret) {
  const token = request.headers.get('Authorization') ?? '';
  if (!secret || token.length > 512) return false;
  const encoder = new TextEncoder();
  const [actual, expected] = await Promise.all([token, 'Bearer ' + secret].map(
    value => crypto.subtle.digest('SHA-256', encoder.encode(value))));
  let different = 0;
  for (const [index, byte] of new Uint8Array(actual).entries()) different |= byte ^ new Uint8Array(expected)[index];
  return different === 0;
}

export default {
  async fetch(request, env) {
    const {pathname, origin} = new URL(request.url);
    if (!pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (request.method === 'POST' && request.headers.get('Origin') !== origin) {
      return fail('Use the Simulation Bank site to submit requests.', 403);
    }
    if (['/api/settings','/api/reserve'].includes(pathname) &&
        !await authorized(request, env.BANK_ADMIN_TOKEN)) return fail('Enter a valid admin key.', 401);
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
    if (request.method === 'GET' && path === '/api/bank') {
      return json(await this.storage.get('bank') ?? blankBank());
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
    if (existing) return existing.bet === stake ? json({round:existing, bank}) : fail('Round ID already used.', 409);
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
    return json({round, bank});
  }
}
