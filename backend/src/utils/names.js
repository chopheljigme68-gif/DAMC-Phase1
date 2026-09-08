// Normalizes a person's display name to proper capitalization —
// "sangay choden" -> "Sangay Choden" — while being conservative enough not
// to mangle names that already carry deliberate casing.
//
// Design choices, deliberately narrow:
//  - Collapses runs of whitespace and trims, so "  sangay   choden " is tidy.
//  - Capitalizes the first letter of each whitespace-separated word and each
//    hyphenated part ("pema-lhamu" -> "Pema-Lhamu"), which is what Bhutanese
//    and most Latin-script names want.
//  - Leaves a word ALONE if it already contains an interior capital
//    (McKenzie, DeSuung, JigmeX) — that casing was almost certainly on
//    purpose, and forcing Title Case would break it.
//  - Lowercases a word that is ALL CAPS ("SANGAY" -> "Sangay"), since all-caps
//    is the other common data-entry slip, but preserves short all-caps tokens
//    of length 1 (an initial like "K").
//
// Kept intentionally simple: no locale libraries, no particle rules
// ("van"/"de") — those are rare here and guessing wrong is worse than a
// harmless Title Case. This runs on the server so it applies no matter how
// a name arrives (sign-up, invite, or a later profile edit).

function formatWordCasing(word) {
  if (!word) return word;
  // Already has an interior capital -> intentional casing, leave it.
  if (/[a-z][A-Z]/.test(word) || /^[a-z]+[A-Z]/.test(word)) return word;
  // A single character (an initial) -> just uppercase it.
  if (word.length === 1) return word.toUpperCase();
  // Otherwise: first char upper, rest lower. This both fixes "sangay" and
  // tames "SANGAY".
  return word[0].toUpperCase() + word.slice(1).toLowerCase();
}

function formatName(raw) {
  if (typeof raw !== "string") return raw;
  const trimmed = raw.replace(/\s+/g, " ").trim();
  if (!trimmed) return trimmed;
  return trimmed
    .split(" ")
    .map((word) => word.split("-").map(formatWordCasing).join("-"))
    .join(" ");
}

module.exports = { formatName };