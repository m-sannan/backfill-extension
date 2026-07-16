// content.js — injected into cliq.zoho.in pages (standalone; content
// scripts can't import ES modules). Scrapes call history on request from
// the popup and reports results back.

const MONTH_MAP = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sept: 8, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
  January: 0, February: 1, March: 2, April: 3, June: 5, July: 6, August: 7,
  September: 8, October: 9, November: 10, December: 11
};

function parseHeaderDate(label) {
  if (/^Yesterday/.test(label)) { const d = new Date(); d.setDate(d.getDate() - 1); return d; }
  if (/^Today/.test(label)) return new Date();
  const m = label.match(/(\d{1,2})\s+(\w+)\s*(\d{4})?/);
  if (!m) return null;
  const mon = MONTH_MAP[m[2]];
  if (mon === undefined) return null;
  return new Date(m[3] ? +m[3] : new Date().getFullYear(), mon, +m[1]);
}

function localDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Shared by both row parsers: "(… Duration 12:34 mins)" or "(… Duration 45 secs)".
// Returns whole minutes (min 1), or null for cancelled/zero/unparseable.
function parseDurationMin(status) {
  if (/cancelled/i.test(status)) return null;
  const m = status.match(/Duration (\d{1,2}):(\d{2}) mins/) || status.match(/Duration (\d+) secs/);
  if (!m) return null;
  const seconds = m.length === 3 ? (+m[1]) * 60 + (+m[2]) : +m[1];
  if (seconds === 0) return null;
  return Math.round(seconds / 60) || 1;
}

function parseDirectCallRow(row) {
  const text = row.children[1]?.innerText?.replace(/\s+/g, ' ').trim() || '';
  const m = text.match(/^(.+?)\s+(\d{1,2}:\d{2}\s?[AP]M)\s+\((.+)\)$/);
  if (!m) return null;
  const [, name, time, status] = m;
  const durationMin = parseDurationMin(status);
  if (durationMin === null) return null;
  return { name: name.trim(), time: time.trim(), durationMin, type: 'direct' };
}

function parseMeetingRow(row) {
  const text = row.children[0]?.innerText?.replace(/\s+/g, ' ').trim() || '';
  const m = text.match(/^(.+?)\s+(?:Audio|Video)\s+(\d+)\s+Participants\s+(\d{1,2}:\d{2}\s?[AP]M)\s+\((.+?)\)/);
  if (!m) return null;
  const [, title, participantCount, time, status] = m;
  const durationMin = parseDurationMin(status);
  if (durationMin === null) return null;
  return {
    name: title.trim(), participants: +participantCount,
    time: time.trim(), durationMin, type: 'meeting'
  };
}

function detectPageType() {
  return location.href.includes('/meetings') ? 'meeting' : 'direct';
}

// Cliq's lazy-load pauses when the tab is backgrounded; spoofing
// visibilityState keeps pagination flowing during a scan.
function spoofVisibility() {
  try {
    Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
    Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  } catch (e) { /* already defined, ignore */ }
}

async function scrollUntilBoundary(startBoundary, maxRounds = 60) {
  const container = document.querySelector('.callhistory-container');
  if (!container) return { rounds: 0, passed: false, noContainer: true };

  for (let i = 0; i < maxRounds; i++) {
    const headers = [...container.querySelectorAll('.date-divider:not(.sticky-date-cnt)')]
      .map(h => h.textContent.trim());
    const dates = headers.map(parseHeaderDate);
    if (dates.some(d => d && d <= startBoundary)) return { rounds: i, passed: true };

    const before = container.scrollHeight;
    container.scrollTop = container.scrollHeight;
    container.dispatchEvent(new Event('scroll', { bubbles: true }));
    await new Promise(r => setTimeout(r, 900));
    if (container.scrollHeight === before) return { rounds: i, passed: false };
  }
  return { rounds: maxRounds, passed: false };
}

// Cliq is a heavy SPA — the browser reports "complete" before the list is
// actually painted. Wait for real rows to avoid a false "no calls found".
async function waitForListReady(maxWaitMs = 6000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const container = document.querySelector('.callhistory-container');
    if (container && container.querySelector('.callhistory-item, .date-divider')) return true;
    await new Promise(r => setTimeout(r, 250));
  }
  return false;
}

async function scrapeRange(startDateStr, endDateStr, options = {}) {
  const { minDurationMin = 3, roundToNearest = 5, includeWeekends = false } = options;

  spoofVisibility();

  const ready = await waitForListReady();
  if (!ready) return { error: 'list-never-rendered', results: [] };

  const [sy, sm, sd] = startDateStr.split('-').map(Number);
  const [ey, em, ed] = endDateStr.split('-').map(Number);
  const startBoundary = new Date(sy, sm - 1, sd);
  const endBoundary = new Date(ey, em - 1, ed);
  endBoundary.setHours(23, 59, 59, 999);

  const scrollResult = await scrollUntilBoundary(startBoundary);
  if (scrollResult.noContainer) return { error: 'not-a-history-page', results: [] };

  const pageType = detectPageType();
  const parser = pageType === 'meeting' ? parseMeetingRow : parseDirectCallRow;

  const container = document.querySelector('.callhistory-container');
  const nodes = [...container.querySelectorAll('.date-divider:not(.sticky-date-cnt), .callhistory-item')];

  let currentDate = null, inRange = false;
  const raw = [];

  nodes.forEach(node => {
    if (node.classList.contains('date-divider')) {
      currentDate = parseHeaderDate(node.textContent.trim());
      inRange = currentDate && currentDate >= startBoundary && currentDate <= endBoundary;
      return;
    }
    if (inRange) {
      const parsed = parser(node);
      if (parsed) raw.push({ ...parsed, date: localDateStr(currentDate), dow: currentDate.getDay() });
    }
  });

  const dayFiltered = includeWeekends ? raw : raw.filter(r => r.dow !== 0 && r.dow !== 6);
  const roundToN = (min) => Math.round(min / roundToNearest) * roundToNearest;

  const results = dayFiltered
    .filter(r => r.durationMin >= minDurationMin)
    .map(r => ({
      name: r.name,
      ...(r.participants ? { participants: r.participants } : {}),
      time: r.time,
      date: r.date,
      durationMin: r.durationMin,
      roundedMin: roundToN(r.durationMin),
      type: r.type,
      dedupKey: `${r.name}|${r.date}|${r.time}`
    }));

  return { pageType, scrollRounds: scrollResult.rounds, rawCount: raw.length, results };
}

// ── Message handlers ──────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'SCRAPE_RANGE') {
    scrapeRange(msg.startDate, msg.endDate, msg.options || {})
      .then(sendResponse)
      .catch(err => sendResponse({ error: err.message, results: [] }));
    return true; // async response
  }
  if (msg.type === 'PING_CLIQ_TAB') {
    sendResponse({ alive: true, pageType: detectPageType(), url: location.href });
  }
});

chrome.runtime.sendMessage({ type: 'CLIQ_TAB_READY', pageType: detectPageType() }).catch(() => {});
