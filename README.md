# Momentum

A personal habit tracker that charts your consistency like a stock. Private, encrypted, and installable from a link.

## Put it on GitHub (about 5 minutes)

1. Sign in at [github.com](https://github.com) (create a free account if needed).
2. Click **+** (top right) → **New repository**. Name it `momentum`, set it to **Public**, and click **Create repository**.
3. On the new repo page, click **uploading an existing file**.
4. Unzip `momentum.zip` on your computer, open the folder, select **everything inside it** (including the `icons` folder), and drag it into the upload box. Click **Commit changes**.
   - `index.html` must sit at the top level of the repo, not inside another folder.
5. Go to **Settings → Pages**. Under **Build and deployment**, set Source to **Deploy from a branch**, Branch to **main**, folder **/ (root)**, then **Save**.
6. Wait a minute or two, then refresh that page. Your link appears at the top: `https://YOUR-USERNAME.github.io/momentum/`

The repo being public is fine: it contains only the app's code. Nobody's habit data is ever in the repo.

## Install it (you and friends)

- **iPhone:** open the link in **Safari** → Share button → **Add to Home Screen**.
- **Android:** open the link in **Chrome** → menu (⋮) → **Install app** / **Add to Home screen**.
- **Computer (Chrome/Edge):** click the install icon in the address bar.

Each person creates their own passphrase on their own device. Data never leaves the device.

## Keeping data safe

- Everything is encrypted with AES-256 using a key made from your passphrase. The passphrase is never stored.
- **There is no "forgot passphrase."** Write it down somewhere safe.
- **Back up weekly** (Data tab → Download backup). Save the file to Google Drive, iCloud, or email. The app reminds you after 7 days. A backup only opens with the passphrase that was in use when you made it.
- Moving to a new phone: install the app, choose **Restore from a backup file** on the first screen.
- iPhones can clear website data if the app goes unused for weeks. Installing to the Home Screen and backing up regularly protects you.
- The app locks itself after 10 minutes in the background.

## Updating the app

Edit or replace files in the GitHub repo and commit. Everyone gets the new version the next time they open the app (sometimes it takes two opens). If you change any file, also bump `CACHE = 'momentum-v1'` in `sw.js` to `v2`, `v3`, and so on so old copies get cleared.

## How the price moves

All tuning lives at the top of `engine.js` in `RULES`:

| Rule | Default |
|---|---|
| Start price | 100 |
| Planned habit done | +1 × weight (1–3) |
| Streak bonus | +5% per consecutive completion, max +50% |
| Planned habit missed | −0.8 × weight at end of day, streak resets |
| Done on an unplanned day | +0.5 × weight |
| Volume bars | Minutes invested |

Because every check-in is stored as a raw event, changing these numbers recalculates your whole history. Nothing is lost. Editing a habit's days or weight only applies from that day forward, so past misses stay on the record.

## Files

| File | What it does |
|---|---|
| `index.html`, `styles.css` | Layout and look |
| `app.js` | Screens and interactions |
| `engine.js` | Scoring formula, candles, moving averages, projections |
| `vault.js` | Encryption and on-device storage |
| `sw.js`, `manifest.webmanifest`, `icons/` | Makes it installable and work offline |
| `lightweight-charts.js` | TradingView Lightweight Charts (Apache 2.0, see license file) |
