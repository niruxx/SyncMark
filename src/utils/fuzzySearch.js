// A small dependency-free subsequence fuzzy matcher — the same category of
// algorithm as fzf/VS Code's simple fuzzy finder, not a full library. Query
// characters must appear in the target in order (not necessarily adjacent);
// the score rewards runs of consecutive matches and an early match start, so
// "jsmith" scores "John Smith" higher than a same-length but scattered hit.
//
// Used for contacts' ?q= search: fetch-all-and-score-in-JS, same "personal
// scale, do it in JS" precedent as the CardDAV/CalDAV query REPORTs and the
// Calendar's client-side recurrence expansion.

function fuzzyScore(query, text) {
  const q = String(query || '').toLowerCase().trim();
  const t = String(text || '').toLowerCase();
  if (!q) return 0;
  if (!t) return -1;

  let score = 0;
  let textIndex = 0;
  let consecutiveRun = 0;
  let firstMatchIndex = -1;

  for (let i = 0; i < q.length; i += 1) {
    const char = q[i];
    const foundAt = t.indexOf(char, textIndex);
    if (foundAt === -1) return -1; // not a subsequence at all — no match

    if (firstMatchIndex === -1) firstMatchIndex = foundAt;

    if (foundAt === textIndex) {
      consecutiveRun += 1;
      score += consecutiveRun * 2; // reward runs of consecutive characters
    } else {
      consecutiveRun = 1;
      score += 1;
    }

    textIndex = foundAt + 1;
  }

  // Slightly prefer matches that start earlier in the text (e.g. a match at
  // the start of a name over the same match buried inside an email domain).
  score += Math.max(0, 5 - firstMatchIndex);
  // Slightly prefer shorter targets for an equal match quality (a full-string
  // match on "Al" beats the same match diluted across a long address).
  score -= t.length * 0.01;

  return score;
}

// haystacks: an array of strings (name, org, title, phones, emails, tags...).
// Returns the best score across all of them, or -1 if none match at all.
function fuzzyScoreAny(query, haystacks) {
  let best = -1;
  for (const text of haystacks) {
    const score = fuzzyScore(query, text);
    if (score > best) best = score;
  }
  return best;
}

module.exports = { fuzzyScore, fuzzyScoreAny };
