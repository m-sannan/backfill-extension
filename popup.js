// popup.js — the UI (opens as a full tab). ES module.

import { CLIQ, getSettings, saveSettings } from './src/config.js';

let scannedEntries = [];
let selectedDays = new Set();

const el = (id) => document.getElementById(id);

function setStatus(id, msg, cls) {
  const e = el(id);
  e.textContent = msg;
  e.className = 'status' + (cls ? ' ' + cls : '');
}

// ── Cliq tab + company-ID detection ──────────────────────────────
async function findCliqTab() {
  const tabs = await chrome.tabs.query({ url: CLIQ.TAB_MATCH });
  return tabs[0] || null;
}

// Company ID is read from the live tab, never hardcoded — works for any
// teammate/org. Tries the tab URL first, then asks the content script
// (SPA routes sometimes hide it from tabs.query briefly).
async function detectCompanyId(tab) {
  let m = tab.url?.match(CLIQ.COMPANY_ID_RE);
  if (m) return m[1];
  const ping = await sendToContentScript(tab.id, { type: 'PING_CLIQ_TAB' });
  m = ping?.url?.match(CLIQ.COMPANY_ID_RE);
  return m ? m[1] : null;
}

async function refreshTabStatus() {
  const tab = await findCliqTab();
  if (!tab) {
    el('tabStatus').textContent = 'No Cliq tab open — open cliq.zoho.in first';
    el('btnScrape').disabled = true;
    return null;
  }
  el('tabStatus').textContent = '✓ Cliq tab detected';
  el('btnScrape').disabled = false;
  return tab;
}

// ── Auth + calendar picker ───────────────────────────────────────
el('btnConnect').onclick = () => {
  setStatus('authStatus', 'Connecting…');
  chrome.runtime.sendMessage({ type: 'CONNECT_CALENDAR' }, (res) => {
    if (res?.connected) {
      setStatus('authStatus', '✓ Connected', 'ok');
      loadCalendarList();
    } else {
      setStatus('authStatus', 'Failed: ' + (res?.error || 'unknown error'), 'err');
    }
  });
};

async function loadCalendarList() {
  const res = await chrome.runtime.sendMessage({ type: 'LIST_CALENDARS' });
  if (!res?.calendars?.length) return; // keep the Primary fallback option

  const { calendarId } = await getSettings();
  const picker = el('calendarPicker');
  picker.innerHTML = '';
  res.calendars.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.primary ? `${c.summary} (primary)` : c.summary;
    picker.appendChild(opt);
  });
  picker.value = res.calendars.some(c => c.id === calendarId) ? calendarId : (res.calendars.find(c => c.primary)?.id || res.calendars[0].id);
}

el('calendarPicker').onchange = () => saveSettings({ calendarId: el('calendarPicker').value });
el('colorPicker').onchange = () => saveSettings({ eventColorId: el('colorPicker').value });

// ── Settings card ────────────────────────────────────────────────
async function loadSettingsUI() {
  const s = await getSettings();
  el('setMinDuration').value = s.minDurationMin;
  el('setRoundTo').value = s.roundToNearest;
  el('setDelayMs').value = s.delayMs;
  el('setWeekends').checked = s.includeWeekends;
  el('colorPicker').value = s.eventColorId;
}

function bindSetting(id, key, transform) {
  el(id).onchange = async () => {
    const raw = transform(el(id));
    await saveSettings({ [key]: raw });
    setStatus('settingsStatus', '✓ Saved', 'ok');
    setTimeout(() => setStatus('settingsStatus', ''), 1500);
  };
}
bindSetting('setMinDuration', 'minDurationMin', e => Math.max(0, +e.value || 0));
bindSetting('setRoundTo', 'roundToNearest', e => Math.max(1, +e.value || 5));
bindSetting('setDelayMs', 'delayMs', e => Math.max(300, +e.value || 1200));
bindSetting('setWeekends', 'includeWeekends', e => e.checked);

// ── Scrape ───────────────────────────────────────────────────────
el('btnScrape').onclick = async () => {
  const tab = await findCliqTab();
  if (!tab) { setStatus('scrapeStatus', 'No Cliq tab found.', 'err'); return; }

  const startDate = el('startDate').value;
  const endDate = el('endDate').value;
  if (!startDate || !endDate) { setStatus('scrapeStatus', 'Pick a date range first.', 'err'); return; }

  const companyId = await detectCompanyId(tab);
  if (!companyId) {
    setStatus('scrapeStatus', '⚠ Could not detect your Cliq company ID — open any Cliq page inside your org and retry.', 'err');
    return;
  }

  const settings = await getSettings();
  const options = {
    minDurationMin: settings.minDurationMin,
    roundToNearest: settings.roundToNearest,
    includeWeekends: settings.includeWeekends
  };

  setStatus('scrapeStatus', 'Scanning Direct Calls…');
  await chrome.tabs.update(tab.id, { url: CLIQ.historyUrl(companyId, 'direct') });
  await waitForTabLoad(tab.id);
  const directResult = await sendToContentScript(tab.id, { type: 'SCRAPE_RANGE', startDate, endDate, options });

  setStatus('scrapeStatus', 'Scanning Meetings…');
  await chrome.tabs.update(tab.id, { url: CLIQ.historyUrl(companyId, 'meeting') });
  await waitForTabLoad(tab.id);
  const meetingResult = await sendToContentScript(tab.id, { type: 'SCRAPE_RANGE', startDate, endDate, options });

  const combined = [...(directResult?.results || []), ...(meetingResult?.results || [])];
  scannedEntries = combined;

  if (directResult?.error === 'list-never-rendered' || meetingResult?.error === 'list-never-rendered') {
    setStatus('scrapeStatus', '⚠ Cliq took too long to load the list — try again (usually transient).', 'err');
    return;
  }
  if (directResult?.error === 'not-a-history-page' || meetingResult?.error === 'not-a-history-page') {
    setStatus('scrapeStatus', '⚠ Could not find the call list — is Cliq logged in correctly?', 'err');
    return;
  }
  if (!combined.length) {
    setStatus('scrapeStatus', 'No calls found in that range.', 'warn');
    return;
  }

  setStatus('scrapeStatus', `✓ Found ${combined.length} entries (${directResult?.results?.length || 0} calls, ${meetingResult?.results?.length || 0} meetings)`, 'ok');
  renderDayGrid(combined);
};

function waitForTabLoad(tabId) {
  return new Promise((resolve) => {
    function listener(id, info) {
      if (id === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        setTimeout(resolve, 1200); // settle time for content script injection
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

function sendToContentScript(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) resolve({ results: [], error: chrome.runtime.lastError.message });
      else resolve(response);
    });
  });
}

// ── Day grid ─────────────────────────────────────────────────────
async function renderDayGrid(entries) {
  const ledgerRes = await chrome.runtime.sendMessage({ type: 'GET_LEDGER' });
  const ledger = ledgerRes?.ledger || {};

  const byDate = {};
  entries.forEach(e => { (byDate[e.date] = byDate[e.date] || []).push(e); });
  const dates = Object.keys(byDate).sort();
  selectedDays = new Set(dates);

  const grid = el('dayGrid');
  grid.innerHTML = '';
  dates.forEach(date => {
    const d = new Date(date + 'T00:00:00');
    const already = byDate[date].filter(e => ledger[e.dedupKey]?.status === 'synced').length;
    const box = document.createElement('div');
    box.className = 'day-box selected';
    box.innerHTML = `<div>${d.toLocaleDateString('en-US', { weekday: 'short' })}</div><div class="dd">${d.getDate()}</div><div>${byDate[date].length}${already ? ' · ' + already + ' done' : ''}</div>`;
    box.onclick = () => {
      box.classList.toggle('selected');
      if (box.classList.contains('selected')) selectedDays.add(date); else selectedDays.delete(date);
    };
    grid.appendChild(box);
  });

  el('weekGrid').style.display = 'block';
}

// ── Sync ─────────────────────────────────────────────────────────
el('btnSync').onclick = async () => {
  const toSync = scannedEntries.filter(e => selectedDays.has(e.date));
  if (!toSync.length) return;

  const { delayMs } = await getSettings();
  el('progressCard').style.display = 'block';
  el('log').innerHTML = '';
  chrome.runtime.sendMessage({ type: 'START_SYNC', entries: toSync, delayMs });
};

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== 'SYNC_PROGRESS') return;
  const p = msg.progress;

  el('statCalls').textContent = p.apiCallCount;
  el('statPending').textContent = Math.max(0, p.queue.length - p.queueIndex);

  const pct = Math.round((p.queueIndex / p.queue.length) * 100);
  el('progressFill').style.width = pct + '%';

  if (p.entry) {
    const row = document.createElement('div');
    row.className = 'log-row';
    const badgeClass = p.status === 'ok' ? 'ok' : p.status === 'skip' ? 'skip' : 'fail';
    const badgeText = p.status === 'ok' ? 'OK' : p.status === 'skip' ? 'SKIP' : 'FAIL';
    row.innerHTML = `<span class="badge ${badgeClass}">${badgeText}</span><span>${p.entry.name} — ${p.entry.date}</span>`;
    el('log').prepend(row);
  }

  if (p.status === 'done') {
    setStatus('syncStatus', p.failureCount > 0 ? `⚠ Done — ${p.failureCount} failed, rerun to retry` : '✓ Done — all synced', p.failureCount > 0 ? 'err' : 'ok');
    refreshLedgerCount();
  }
  if (p.status === 'rate-limited') {
    setStatus('syncStatus', 'Rate limited — raise delay and click Resume', 'warn');
    el('btnResume').disabled = false;
  }
});

el('btnPause').onclick = () => chrome.runtime.sendMessage({ type: 'PAUSE_SYNC' });
el('btnStop').onclick = () => chrome.runtime.sendMessage({ type: 'STOP_SYNC' });
el('btnResume').onclick = () => { el('btnResume').disabled = true; chrome.runtime.sendMessage({ type: 'RESUME_SYNC' }); };

// ── Exports ──────────────────────────────────────────────────────
function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

// CSV of the current scan (all days, not just selected)
el('btnExportCsv').onclick = () => {
  if (!scannedEntries.length) return;
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = ['name', 'type', 'date', 'time', 'durationMin', 'roundedMin', 'participants'];
  const rows = scannedEntries.map(e => header.map(h => esc(e[h])).join(','));
  const csv = [header.join(','), ...rows].join('\n');
  downloadBlob(new Blob([csv], { type: 'text/csv' }), `backfill-calls-${el('startDate').value}_to_${el('endDate').value}.csv`);
};

el('btnExport').onclick = async () => {
  const res = await chrome.runtime.sendMessage({ type: 'GET_LEDGER' });
  const blob = new Blob([JSON.stringify(res.ledger, null, 2)], { type: 'application/json' });
  downloadBlob(blob, `backfill-ledger-backup-${new Date().toISOString().slice(0, 10)}.json`);
};

el('btnImport').onclick = () => el('fileImport').click();
el('fileImport').onchange = (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const ledger = JSON.parse(reader.result);
      await chrome.runtime.sendMessage({ type: 'IMPORT_LEDGER', ledger });
      refreshLedgerCount();
      alert('Ledger imported.');
    } catch (err) { alert('Invalid file: ' + err.message); }
  };
  reader.readAsText(file);
};

async function refreshLedgerCount() {
  const res = await chrome.runtime.sendMessage({ type: 'GET_LEDGER' });
  el('statLedger').textContent = Object.keys(res?.ledger || {}).length;
}

// ── Init ─────────────────────────────────────────────────────────
(function init() {
  const end = new Date(); end.setDate(end.getDate() - 1);
  const start = new Date(); start.setDate(start.getDate() - 7);
  el('endDate').value = end.toISOString().slice(0, 10);
  el('startDate').value = start.toISOString().slice(0, 10);
  refreshTabStatus();
  refreshLedgerCount();
  loadSettingsUI();
  loadCalendarList(); // silent — populates picker if a valid token exists
})();
