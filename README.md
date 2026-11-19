# Zoya7 shared Simulation Bank

This package deploys as a Cloudflare Worker with static assets and a SQLite-backed Durable Object. The Durable Object is the authority for Simulation Mode odds, reserve, transaction history, and settlement. The bank dashboard refreshes every five seconds while visible, and each round starts with the current server settings.

## Deploy

From the extracted project folder, run the following commands with Node.js installed.

```sh
npx wrangler@latest login
npx wrangler@latest deploy
npx wrangler@latest secret put BANK_ADMIN_TOKEN
```

Use a unique randomly generated admin key of at least 32 characters when prompted. The Worker rejects admin writes until the secret is configured. Enter the same key in the Admin key field on the deployed site's `/bank/` page before saving settings or adding reserve credits. Keep the key out of source control and out of the public assets.

Open the Worker URL Wrangler prints on two devices, then enter Simulation Mode through the game's info panel. The shared bank starts at zero with a 30% win rate and 0% push rate. Set the starting balance and odds in the dashboard.

## Behavior

- This is a practice-credit simulator. Regular Blackjack and each player's practice wallet run locally. There are no shared player accounts or real-money balances.
- Simulation bets range from 0.50 to 250 credits in 0.50-credit increments. If the bank cannot cover a sampled win, the round settles as a loss. Pushes return the stake.
- Each server round is settled before its animation starts. Retrying the same request ID returns the original settlement. The browser retains that ID in the open page if the response fails, so retry the same bet there.
- Simulation Mode and bank changes require a connection. Regular play and the page shell can work offline after caching.
- The shared bank is fresh and does not import browser-local settings or balances from the original site.
- Anyone with access to the Worker URL can view the shared practice bank and submit simulated rounds. The admin key protects configuration and reserve changes. Keep the deployment limited to trusted testers if you want a controlled test environment.
