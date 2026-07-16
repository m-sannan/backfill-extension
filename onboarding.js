// onboarding.js — first-run wizard. Opened by background.js on install
// (chrome.runtime.onInstalled) or manually from the store listing link.

import { CLIQ } from './src/config.js';

const el = (id) => document.getElementById(id);

const state = { cliq: false, auth: false };

function markDone(stepNum) {
  const num = el('num' + stepNum);
  num.classList.add('done');
  num.textContent = '✓';
}

function refreshGate() {
  const ready = state.cliq && state.auth;
  el('btnOpenLogger').disabled = !ready;
  el('step3Status').textContent = ready
    ? '✓ Ready — open the logger to run your first scan'
    : 'Complete steps 1 & 2 first';
  el('step3Status').className = 'status' + (ready ? ' ok' : '');
  if (ready) markDone(3);
}

// ── Step 1: Cliq tab detection (poll — user logs in in another tab) ──
async function checkCliqTab() {
  const tabs = await chrome.tabs.query({ url: CLIQ.TAB_MATCH });
  const found = tabs.length > 0;
  if (found && !state.cliq) {
    state.cliq = true;
    el('cliqStatus').textContent = '✓ Cliq tab detected';
    el('cliqStatus').className = 'status ok';
    markDone(1);
    refreshGate();
  }
  return found;
}

el('btnOpenCliq').onclick = () => chrome.tabs.create({ url: CLIQ.ORIGIN, active: true });
setInterval(checkCliqTab, 1500);
checkCliqTab();

// ── Step 2: Calendar auth ─────────────────────────────────────────
el('btnConnect').onclick = () => {
  el('authStatus').textContent = 'Connecting…';
  el('authStatus').className = 'status';
  chrome.runtime.sendMessage({ type: 'CONNECT_CALENDAR' }, (res) => {
    if (res?.connected) {
      state.auth = true;
      el('authStatus').textContent = '✓ Connected';
      el('authStatus').className = 'status ok';
      markDone(2);
      refreshGate();
    } else {
      el('authStatus').textContent = 'Failed: ' + (res?.error || 'unknown error');
      el('authStatus').className = 'status err';
    }
  });
};

// If a valid token already exists (re-onboarding), reflect it silently.
chrome.storage.local.get(['authToken', 'authTokenExpiry']).then(({ authToken, authTokenExpiry }) => {
  if (authToken && Date.now() < (authTokenExpiry || 0)) {
    state.auth = true;
    el('authStatus').textContent = '✓ Already connected';
    el('authStatus').className = 'status ok';
    markDone(2);
    refreshGate();
  }
});

// ── Step 3 / exit ─────────────────────────────────────────────────
async function finish(openLogger) {
  await chrome.storage.local.set({ onboardingDone: true });
  if (openLogger) {
    chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') });
  }
  window.close();
}

el('btnOpenLogger').onclick = () => finish(true);
el('linkSkip').onclick = (e) => { e.preventDefault(); finish(false); };
el('skipOnboarding').onchange = () => chrome.storage.local.set({ onboardingDone: el('skipOnboarding').checked });
