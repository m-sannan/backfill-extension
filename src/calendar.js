// Google Calendar layer — OAuth + API calls.
//
// Uses launchWebAuthFlow (works on Chrome, Edge, Brave; getAuthToken is
// Chrome-only). Implicit-flow tokens expire in ~1h with no refresh, so
// getAuthToken() is called before EVERY request — it's a no-op while the
// cached token is valid, and silently re-auths when it isn't.

import { OAUTH } from './config.js';

let cachedToken = null;
let cachedTokenExpiry = 0;

function launchAuthFlow(interactive) {
  return new Promise((resolve, reject) => {
    const authUrl = 'https://accounts.google.com/o/oauth2/auth?' + new URLSearchParams({
      client_id: OAUTH.CLIENT_ID,
      response_type: 'token',
      redirect_uri: chrome.identity.getRedirectURL(),
      scope: OAUTH.SCOPES,
      prompt: interactive ? 'select_account consent' : 'none'
    }).toString();

    chrome.identity.launchWebAuthFlow({ url: authUrl, interactive }, (responseUrl) => {
      if (chrome.runtime.lastError || !responseUrl) {
        reject(new Error(chrome.runtime.lastError?.message || 'Auth flow returned no response'));
        return;
      }
      const params = new URLSearchParams(new URL(responseUrl).hash.slice(1));
      const token = params.get('access_token');
      const expiresIn = parseInt(params.get('expires_in') || '3600', 10);
      if (!token) { reject(new Error('No access_token in response')); return; }

      cachedToken = token;
      cachedTokenExpiry = Date.now() + expiresIn * 1000 - OAUTH.TOKEN_SAFETY_MARGIN_MS;
      chrome.storage.local.set({ authToken: token, authTokenExpiry: cachedTokenExpiry });
      resolve(token);
    });
  });
}

export async function getAuthToken(interactive = true) {
  if (cachedToken && Date.now() < cachedTokenExpiry) return cachedToken;

  const stored = await chrome.storage.local.get(['authToken', 'authTokenExpiry']);
  if (stored.authToken && Date.now() < (stored.authTokenExpiry || 0)) {
    cachedToken = stored.authToken;
    cachedTokenExpiry = stored.authTokenExpiry;
    return cachedToken;
  }

  // Try silent refresh first (no popup if the Google session is alive);
  // fall back to interactive if the caller allows it.
  try {
    return await launchAuthFlow(false);
  } catch {
    if (!interactive) throw new Error('Token expired — reconnect Google Calendar');
    return launchAuthFlow(true);
  }
}

// ── Calendar list (for the target-calendar picker) ──────────────
export async function listWritableCalendars() {
  const token = await getAuthToken(true);
  const res = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
    headers: { Authorization: 'Bearer ' + token }
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`);
  return (data.items || [])
    .filter(c => c.accessRole === 'owner' || c.accessRole === 'writer')
    .map(c => ({ id: c.id, summary: c.summary, primary: !!c.primary }));
}

// ── Event creation ───────────────────────────────────────────────
function parse12h(t) {
  const m = String(t).trim().match(/(\d{1,2}):(\d{2})\s?([AP]M)/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const ap = m[3].toUpperCase();
  if (ap === 'PM' && h !== 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  return { h, min };
}

const LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone; // e.g. Asia/Kolkata

export function toCalendarEvent(entry, colorId) {
  const t = parse12h(entry.time);
  if (!t) throw new Error(`Unparseable time "${entry.time}" for "${entry.name}"`);

  const dur = entry.roundedMin || entry.durationMin || 5;
  const startLocal = `${entry.date}T${String(t.h).padStart(2, '0')}:${String(t.min).padStart(2, '0')}:00`;
  const endDate = new Date(new Date(startLocal).getTime() + dur * 60000);
  const endLocal = `${entry.date}T${String(endDate.getHours()).padStart(2, '0')}:${String(endDate.getMinutes()).padStart(2, '0')}:00`;

  const summary = entry.type === 'meeting' ? entry.name : `Call with ${entry.name}`;
  const desc = `Synced from Cliq call history${entry.participants ? ' · ' + entry.participants + ' participants' : ''} · key:${entry.dedupKey}`;

  const event = {
    summary,
    description: desc,
    // Explicit timeZone: correct even if the machine's clock/zone changes.
    start: { dateTime: startLocal, timeZone: LOCAL_TZ },
    end: { dateTime: endLocal, timeZone: LOCAL_TZ }
  };
  if (colorId) event.colorId = colorId;
  return event;
}

export async function insertEvent(calendarId, event) {
  const token = await getAuthToken(false); // per-request expiry check
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(event)
    }
  );
  const data = await res.json();
  return { status: res.status, ok: res.ok, data };
}
