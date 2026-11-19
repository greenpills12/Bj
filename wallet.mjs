const root = 'https://zoya777.greenpills12.workers.dev/api/game-math/wallet/';
const encoder = new TextEncoder();

export class WalletError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function walletCall(env, action, payload, send = fetch) {
  const game = env.ZOYA7_GAME_ID;
  if (!env.ZOYA7_WALLET_SECRET || !/^[a-z][a-z0-9]{2,23}$/.test(game ?? '')) {
    throw new WalletError('The wallet connection is not configured.', 503, 'configuration');
  }
  const body = JSON.stringify(payload);
  const time = String(Date.now());
  const key = await crypto.subtle.importKey('raw', encoder.encode(env.ZOYA7_WALLET_SECRET),
    {name:'HMAC', hash:'SHA-256'}, false, ['sign']);
  const signature = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(time + '.' + body)))]
    .map(byte => byte.toString(16).padStart(2,'0')).join('');
  let response, data;
  try {
    response = await send(root + action, {
      method:'POST', redirect:'error', signal:AbortSignal.timeout(10000), body,
      headers:{
        'Content-Type':'application/json', 'X-Zoya7-Game':game,
        'X-Zoya7-Time':time, 'X-Zoya7-Signature':signature,
      }
    });
    data = await response.json();
  } catch {
    throw new WalletError('Wallet connection interrupted. Retry this round.', 503);
  }
  if (!response.ok) {
    const code = data.error?.code;
    const status = code === 'busy' || code === 'signature' || response.status >= 500 ? 503 : response.status;
    const message = status === 503 ? 'Wallet unavailable. Retry this round.' : data.error?.message || 'Wallet request refused.';
    throw new WalletError(message, status, code);
  }
  return data;
}
