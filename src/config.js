// Shared constants — imported by background.js and popup.js.
// (content.js is standalone: content scripts can't import ES modules.)

export const OAUTH = {
  CLIENT_ID: '62264945252-497jqi532g54bpc1qhboo219c4t4523m.apps.googleusercontent.com',
  // events: create events · calendar.readonly: list calendars for the picker
  SCOPES: [
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/calendar.readonly'
  ].join(' '),
  TOKEN_SAFETY_MARGIN_MS: 60_000
};

export const CLIQ = {
  ORIGIN: 'https://cliq.zoho.in',
  TAB_MATCH: 'https://cliq.zoho.in/*',
  // Company ID is auto-detected from the open tab's URL — never hardcoded.
  historyUrl: (companyId, kind) =>
    `https://cliq.zoho.in/company/${companyId}/history/${kind === 'meeting' ? 'meetings' : 'direct-calls'}`,
  COMPANY_ID_RE: /\/company\/(\d+)\//
};

export const DEFAULT_SETTINGS = {
  minDurationMin: 3,
  roundToNearest: 5,
  includeWeekends: false,
  delayMs: 1200,
  calendarId: 'primary',
  eventColorId: '9' // Blueberry
};

export async function getSettings() {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...stored };
}

export async function saveSettings(patch) {
  await chrome.storage.sync.set(patch);
}
