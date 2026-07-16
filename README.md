# Backfill

**Sync Cliq Calls to Calendar.** Chrome/Edge extension that scans your **Zoho Cliq** call & meeting history and syncs the time blocks to **Google Calendar** — so your actual call time shows up on your calendar and nothing gets missed.

## Features
- Scans Direct Calls **and** Meetings for any date range
- One-click sync to any writable Google Calendar (color-coded events)
- **Duplicate-safe**: a local ledger tracks what's synced — re-running is always safe
- Filters: minimum duration, round-to-nearest, include/exclude weekends
- CSV export of any scan
- Rate-limit aware (pause/resume, configurable delay)
- Guided onboarding on first install

## Privacy
Everything runs locally in your browser. Call data goes **directly from your browser to the Google Calendar API** — there is no third-party server, no analytics, no data collection. See [PRIVACY.md](PRIVACY.md).

## Install

### From the Chrome Web Store
*(link once published)*

### From source (developer mode)
1. Clone this repo.
2. `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select the repo folder.
3. The onboarding page opens automatically — follow the 3 steps.

> **OAuth note (from-source installs):** the bundled Google OAuth client is in testing mode. Either ask the maintainer to add your Google account as a test user, or [create your own OAuth client](#setting-up-your-own-oauth-client).

## Usage
1. Keep a logged-in `cliq.zoho.in` tab open.
2. Click the extension icon → pick a date range → **Scan Cliq for this range**.
3. Toggle days on/off in the grid → **Sync selected days**.
4. Optional: **Export scan as CSV**.

## Settings
| Setting | Default | Notes |
|---|---|---|
| Min duration | 3 min | Calls shorter than this are ignored |
| Round to | 5 min | Event length rounding |
| Include weekends | off | |
| Sync delay | 1200 ms | Raise if you hit rate limits |
| Target calendar | primary | Any calendar you can write to |
| Event color | Blueberry | |

Settings persist via `chrome.storage.sync` (follow your Chrome profile).

## Architecture
```
manifest.json          MV3, module service worker
popup.html/js/css      Main UI (opens as a full tab)
onboarding.html/js/css First-run wizard
src/
  content.js           DOM scraper for cliq.zoho.in (standalone)
  background.js        Sync queue + message routing
  calendar.js          OAuth (launchWebAuthFlow) + Calendar API
  ledger.js            Dedup ledger (chrome.storage.local)
  config.js            Constants + settings helpers
```
Design notes:
- **`launchWebAuthFlow` over `getAuthToken`** — works on Edge/Brave, not just Chrome. Cost: implicit-flow tokens (~1h, no refresh), so token expiry is checked before every API request with silent re-auth.
- **Company ID is auto-detected** from the open Cliq tab URL — nothing org-specific is hardcoded.
- **Scrape resilience**: visibility-state spoofing keeps Cliq's lazy-load paginating while backgrounded; the scraper waits for real rows to render before declaring "no calls".

## Setting up your own OAuth client
1. Google Cloud Console → create a project → enable **Google Calendar API**.
2. OAuth consent screen → External → add scopes `calendar.events` and `calendar.readonly`.
3. Create an **OAuth Client ID** of type **Web application**.
4. Add your extension's redirect URI: `https://<EXTENSION_ID>.chromiumapp.org/` (get the ID from `chrome://extensions`).
5. Put the client ID in `src/config.js` → `OAUTH.CLIENT_ID`.

## Zoho data centers
Currently matches `cliq.zoho.in` only. If your org is on `.com` / `.eu` / `.com.au`, update `host_permissions` + `content_scripts.matches` in `manifest.json` and `CLIQ.ORIGIN` / `CLIQ.TAB_MATCH` in `src/config.js`. PRs adding multi-DC support welcome.

## Roadmap
- [ ] Scheduled/automatic daily sync
- [ ] Time analytics (hours per person / per day)
- [ ] Multi-DC support (`.com`, `.eu`, …)

## Contributing
Issues and PRs welcome. Keep changes small and focused; test against a real Cliq account before submitting (the scraper depends on Cliq's DOM: `.callhistory-container`, `.callhistory-item`, `.date-divider`).

## License
[MIT](LICENSE)
