// background.js — service worker (ES module).
// Owns: the sync queue and message routing. Auth/API → calendar.js,
// dedup state → ledger.js, constants/settings → config.js.

import { getSettings } from './config.js';
import { getAuthToken, listWritableCalendars, toCalendarEvent, insertEvent } from './calendar.js';
import { getLedger, saveLedger, markSynced, isAlreadySynced } from './ledger.js';

// ── First-run onboarding ─────────────────────────────────────────
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason !== 'install') return;
  const { onboardingDone } = await chrome.storage.local.get('onboardingDone');
  if (!onboardingDone) {
    chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') });
  }
});

// ── Open the UI as a full tab; focus it if already open ──────────
chrome.action.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL('popup.html');
  const existing = await chrome.tabs.query({ url });
  if (existing.length) {
    chrome.tabs.update(existing[0].id, { active: true });
    chrome.windows.update(existing[0].windowId, { focused: true });
  } else {
    chrome.tabs.create({ url });
  }
});

// ── Sync queue ────────────────────────────────────────────────────
let syncState = {
  running: false, paused: false, stopped: false,
  queue: [], queueIndex: 0,
  failureCount: 0, apiCallCount: 0, delayMs: 1200
};

const emitProgress = (extra) =>
  chrome.runtime.sendMessage({ type: 'SYNC_PROGRESS', progress: { ...syncState, ...extra } }).catch(() => {});

async function runSyncQueue(entries, delayMs) {
  syncState = {
    running: true, paused: false, stopped: false,
    queue: entries, queueIndex: 0,
    failureCount: 0, apiCallCount: 0, delayMs
  };

  await getAuthToken(true); // interactive up-front; per-request checks are silent
  const { calendarId, eventColorId } = await getSettings();

  await processQueue(calendarId, eventColorId);
}

async function processQueue(calendarId, eventColorId) {
  while (syncState.queueIndex < syncState.queue.length) {
    if (syncState.stopped) break;
    if (syncState.paused) { emitProgress({ status: 'paused' }); return; }

    const entry = syncState.queue[syncState.queueIndex];

    if (await isAlreadySynced(entry.dedupKey)) {
      emitProgress({ status: 'skip', entry, note: 'already synced' });
      syncState.queueIndex++;
      continue;
    }

    try {
      const event = toCalendarEvent(entry, eventColorId);
      const { status, ok, data } = await insertEvent(calendarId, event);
      syncState.apiCallCount++;

      if (status === 429 || status === 403) {
        syncState.paused = true;
        emitProgress({ status: 'rate-limited', entry, note: `HTTP ${status}` });
        return;
      }
      if (!ok) throw new Error(data.error?.message || JSON.stringify(data));

      await markSynced(entry.dedupKey, entry, data.id);
      emitProgress({ status: 'ok', entry });
    } catch (err) {
      syncState.failureCount++;
      emitProgress({ status: 'fail', entry, note: err.message });
      // deliberately NOT written to the ledger — stays retryable on rerun
    }

    syncState.queueIndex++;
    await new Promise(r => setTimeout(r, syncState.delayMs));
  }

  syncState.running = false;
  emitProgress({ status: 'done' });
}

// ── Message routing ───────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case 'CLIQ_TAB_READY':
      chrome.storage.session.set({ cliqTabId: sender.tab?.id, cliqPageType: msg.pageType });
      return;

    case 'CONNECT_CALENDAR':
      getAuthToken(true)
        .then(() => sendResponse({ connected: true }))
        .catch(err => sendResponse({ connected: false, error: err.message }));
      return true;

    case 'LIST_CALENDARS':
      listWritableCalendars()
        .then(calendars => sendResponse({ calendars }))
        .catch(err => sendResponse({ calendars: [], error: err.message }));
      return true;

    case 'START_SYNC':
      runSyncQueue(msg.entries, msg.delayMs || 1200);
      sendResponse({ started: true });
      return;

    case 'PAUSE_SYNC': syncState.paused = true; sendResponse({ ok: true }); return;
    case 'STOP_SYNC': syncState.stopped = true; sendResponse({ ok: true }); return;

    case 'RESUME_SYNC':
      syncState.paused = false;
      getSettings().then(({ calendarId, eventColorId }) => processQueue(calendarId, eventColorId));
      sendResponse({ ok: true });
      return;

    case 'GET_LEDGER':
      getLedger().then(ledger => sendResponse({ ledger }));
      return true;

    case 'IMPORT_LEDGER':
      saveLedger(msg.ledger).then(() => sendResponse({ ok: true }));
      return true;
  }
});
