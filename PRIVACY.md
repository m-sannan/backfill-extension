# Privacy Policy — Backfill

*Last updated: July 2026*

## Summary
Backfill does not collect, transmit, sell, or share your data with anyone. There is no backend server and no analytics.

## What the extension accesses
- **Zoho Cliq call history (read-only)**: names/titles, times, and durations of your calls and meetings, read from the Cliq page you already have open. Your Zoho credentials are never seen or stored.
- **Google Calendar (write + list)**: used solely to create calendar events you explicitly choose to sync, and to list your calendars for the target-calendar picker.

## Where data is stored
- **Locally in your browser only** (`chrome.storage.local` / `chrome.storage.sync`):
  - A sync ledger (which entries were already synced) to prevent duplicates
  - Your settings (duration filters, delay, calendar choice, color)
  - A short-lived Google OAuth access token (~1 hour)
- Nothing is sent anywhere except **directly from your browser to Google's Calendar API** when you click Sync.

## What we do NOT do
- No analytics, tracking, or telemetry
- No third-party servers
- No sale or transfer of data
- No use of data for advertising or credit purposes

## Permissions justification
| Permission | Why |
|---|---|
| `storage` | Settings + sync ledger, stored locally |
| `identity` | Google sign-in via `launchWebAuthFlow` |
| `tabs` | Detect the open Cliq tab and navigate it during a scan |
| `cliq.zoho.in` host | Read your call history from the page |
| `googleapis.com` host | Create calendar events |

## Data removal
Uninstalling the extension deletes all locally stored data. You can also revoke calendar access anytime at [myaccount.google.com/permissions](https://myaccount.google.com/permissions).

## Contact
Open an issue on the GitHub repository (github.com/m-sannan/backfill-extension).
