# Publishing Checklist — Chrome Web Store

## ⚠ Critical first: the `key` / extension-ID / OAuth chain
Your OAuth redirect URI is `https://<EXTENSION_ID>.chromiumapp.org/`. The `key` in `manifest.json` currently pins the dev-install ID. The Web Store **assigns its own ID** and rejects manifests containing `key`.

**Order of operations:**
1. Remove `"key"` from `manifest.json` in the store build only (keep it in the repo for dev installs, or document both).
2. Upload the draft to the [Developer Dashboard](https://chrome.google.com/webstore/devconsole) ($5 one-time fee) — the store shows your **new permanent extension ID** before publishing.
3. Add `https://<NEW_ID>.chromiumapp.org/` as an authorized redirect URI on the Google OAuth client.
4. Existing dev-install users keep working (old ID's redirect URI stays registered too).

## OAuth verification (required — sensitive scopes)
`calendar.events` + `calendar.readonly` are **sensitive scopes**. A published app needs Google OAuth verification, or every user sees a scary "unverified app" warning and you're capped at 100 users.
- Move the OAuth consent screen from Testing → **In production**
- Submit for verification: requires a homepage URL (the GitHub repo works), the privacy policy URL (host `PRIVACY.md` via GitHub Pages or link the raw file), and a short demo video of the OAuth flow
- Verification takes days–weeks; plan for it

## Store listing requirements
- [ ] **Privacy policy URL** (mandatory — you request host permissions)
- [ ] **Single purpose description**: "Syncs Zoho Cliq call history to Google Calendar" — keep the listing narrowly scoped; CWS rejects vague multi-purpose descriptions
- [ ] **Permission justifications** (asked in the dashboard) — copy the table from PRIVACY.md
- [ ] **Data-use disclosures**: declare "no data collected/sold"; matches PRIVACY.md
- [ ] Screenshots: 1280×800 (min 1, ideally 3–5: onboarding, scan grid, sync progress)
- [ ] Small promo tile: 440×280
- [ ] Icon 128×128 (already have)
- [ ] Category: Productivity / Workflow & Planning

## Pre-submission technical checks
- [ ] `manifest_version: 3` ✓
- [ ] No remote code (all JS bundled) ✓
- [ ] Narrow host permissions ✓ (`cliq.zoho.in`, `googleapis.com` only)
- [ ] Version bumped
- [ ] Test the store zip locally: load unpacked from the exact zip contents

## Build the store zip
```bash
# from repo root — excludes docs & dev files
zip -r store-build.zip manifest.json popup.* onboarding.* src icons -x "*.DS_Store"
# then remove the "key" line from manifest.json inside the build
```

## Review notes
- Reviewers may ask why you need `tabs`: "to detect the user's open Zoho Cliq tab and navigate it between call-history pages during a scan; no browsing data is read from other sites."
- Expect 1–7 days review for a new listing.

## GitHub repo setup
- [ ] Push with README.md, PRIVACY.md, LICENSE, PUBLISHING.md
- [ ] Enable GitHub Pages (or link raw PRIVACY.md) for the privacy-policy URL
- [ ] Add topics: `chrome-extension`, `zoho-cliq`, `google-calendar`, `productivity`
- [ ] Optional: GitHub Action to zip a store build on tag
