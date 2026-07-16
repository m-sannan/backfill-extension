// Ledger — records which entries have already been synced, keyed by
// dedupKey (`name|date|time`). Lives in chrome.storage.local (persistent,
// per-machine). Export/import in the popup covers portability.

export async function getLedger() {
  const { ledger } = await chrome.storage.local.get('ledger');
  return ledger || {};
}

export async function saveLedger(ledger) {
  await chrome.storage.local.set({ ledger });
}

export async function markSynced(dedupKey, entry, eventId) {
  const ledger = await getLedger();
  ledger[dedupKey] = {
    status: 'synced',
    eventId,
    syncedAt: new Date().toISOString(),
    name: entry.name,
    date: entry.date
  };
  await saveLedger(ledger);
}

export async function isAlreadySynced(dedupKey) {
  const ledger = await getLedger();
  return ledger[dedupKey]?.status === 'synced';
}
