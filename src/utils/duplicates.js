// Personal-scale duplicate detection: fetch-all-and-compare in JS (same
// precedent as fuzzySearch.js and the smart-group evaluator) rather than a
// dedicated matching library — fine at address-book scale.

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

// Compares the last 10 digits so "+1 (555) 123-4567" and "555-123-4567"
// still match; shorter numbers compare in full.
function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.slice(-10);
}

function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function pairKey(idA, idB) {
  return idA < idB ? `${idA}-${idB}` : `${idB}-${idA}`;
}

function contactSignals(contact) {
  const emails = (JSON.parse(contact.emails || '[]') || []).map((e) => normalizeEmail(e.value)).filter(Boolean);
  const phones = (JSON.parse(contact.phones || '[]') || []).map((e) => normalizePhone(e.value)).filter((p) => p.length >= 7);
  const name = normalizeName(contact.full_name);
  return { emails, phones, name };
}

function shareSignal(a, b) {
  if (a.name && a.name === b.name) return true;
  if (a.emails.some((e) => b.emails.includes(e))) return true;
  if (a.phones.some((p) => b.phones.includes(p))) return true;
  return false;
}

// Union-find over pairwise signal matches, skipping any pair present in
// `dismissedPairs` (a Set of "minId-maxId" keys) so a user's "not duplicates"
// call sticks even as other contacts are added later.
function findDuplicateGroups(contacts, dismissedPairs = new Set()) {
  const signals = contacts.map(contactSignals);
  const parent = new Map(contacts.map((c) => [c.id, c.id]));

  function find(id) {
    while (parent.get(id) !== id) {
      parent.set(id, parent.get(parent.get(id)));
      id = parent.get(id);
    }
    return id;
  }

  function union(idA, idB) {
    const rootA = find(idA);
    const rootB = find(idB);
    if (rootA !== rootB) parent.set(rootA, rootB);
  }

  for (let i = 0; i < contacts.length; i += 1) {
    for (let j = i + 1; j < contacts.length; j += 1) {
      const key = pairKey(contacts[i].id, contacts[j].id);
      if (dismissedPairs.has(key)) continue;
      if (shareSignal(signals[i], signals[j])) union(contacts[i].id, contacts[j].id);
    }
  }

  const groups = new Map();
  for (const contact of contacts) {
    const root = find(contact.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(contact);
  }

  return [...groups.values()]
    .filter((group) => group.length > 1)
    .sort((a, b) => b.length - a.length);
}

module.exports = { normalizeEmail, normalizePhone, normalizeName, pairKey, findDuplicateGroups };
