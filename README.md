# Zoya7 shared Simulation Bank

This package deploys as a Cloudflare Worker with static assets and a SQLite-backed Durable Object. The Durable Object is the authority for Simulation Mode odds, reserve, transaction history, and settlement. The bank dashboard refreshes every five seconds while visible, and each round starts with the current server settings.

## Deploy

From the extracted project folder, run the following commands with Node.js installed. This Worker package is for Cloudflare deployment. The Zoya7 game ZIP uploader requires the central Game Math Engine.

```sh
npx wrangler@latest login
npx wrangler@latest deploy
npx wrangler@latest secret put BANK_ADMIN_TOKEN
```

Use a unique randomly generated admin key of at least 32 characters when prompted. The Worker rejects admin writes until the secret is configured. Enter the same key on the deployed site's `/bank/` sign-in page before saving settings or adding reserve credits. Keep the key out of source control and out of the public assets.

Open the Worker URL Wrangler prints on two devices, then enter Simulation Mode through the game's info panel. The shared bank starts at zero with a 30% win rate and 0% push rate. Set the starting balance and odds in the dashboard.

## Behavior

- This is a practice-credit simulator. Regular Blackjack and each player's practice wallet run locally. There are no shared player accounts or real-money balances.
- Simulation bets range from 0.50 to 250 credits in 0.50-credit increments. If the bank cannot cover a sampled win, the round settles as a loss. Pushes return the stake.
- Each server round is settled before its animation starts. Retrying the same request ID returns the original settlement. The browser retains that ID in the open page if the response fails, so retry the same bet there.
- Simulation Mode and bank changes require a connection. Regular play and the page shell can work offline after caching.
- The shared bank is fresh and does not import browser-local settings or balances from the original site.
- Anyone with access to the Worker URL can play simulated rounds. The bank dashboard, full ledger, settings, and reserve controls require the bank password. Keep the deployment limited to trusted testers if you want a controlled test environment.

## Lobby links and artwork

Use the Worker root URL for Blackjack and append `?table=classic` for Blackjack Classic. Both tables return to the Zoya7 lobby when the player taps Back. The original lobby artwork is served under `/lobby/`.

| Table | Icon | Tile |
| --- | --- | --- |
| Blackjack | `/lobby/icon.png` | `/lobby/tile.png` |
| Blackjack Classic | `/lobby/classic-icon.png` | `/lobby/classic-tile.png` |

The game is hosted by the Worker. The connected-game starter's one-call settlement does not support Blackjack's interactive round or the shared Simulation Bank.

On the game screen, Space or Enter deals a placed bet when focus is outside another control. Escape returns to the lobby between hands. The table follows the device’s reduced-motion preference.

## Zoya7 wallet launch

Register `blackjac` as a wallet game with the URL `https://bj.greenpills12.workers.dev/wallet/`.
Store the registered game's signing key as the Worker secret `ZOYA7_WALLET_SECRET`.
Use the Worker dashboard or `npx wrangler secret put ZOYA7_WALLET_SECRET --name bj`
if the deployed Worker is named `bj`. Use the actual deployed Worker name.
A payout cap of at least 2× is needed because a win returns the stake plus the profit.

Set reserve and rates in `/bank/?wallet=GC` and `/bank/?wallet=DC` before enabling play.
Both start at zero and do not draw from practice credits. The bank prevents reducing
the balance below active round holds. The archive shows the authenticated Zoya7 player ID.
A connection failure leaves the pending round available for the same player to retry.
The launch token expires after four hours. Reopen the game from Zoya7 to resume.
