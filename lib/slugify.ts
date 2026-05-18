// Slug derivation for the `teachers` catalog. Spec anchor: S-1 AC-2.1.3.
//
// Pipeline (per task summary + AC-2.1.3):
//   NFKD-normalize → strip combining diacritics → lowercase → replace
//   non-`[a-z0-9]+` runs with `-` → trim leading/trailing `-` → truncate to 64
//   → re-trim trailing `-` (in case truncation severed a hyphen).
//
// NFKD vs NFD: the task summary specifies NFKD (a strict superset of NFD that
// also unfolds compatibility forms — ligatures `ﬁ → fi`, width-variants,
// stylistic variants). For a Spanish-language teacher catalog NFD would
// suffice for the common diacritics, but NFKD costs nothing extra and
// handles the long-tail edge cases without callers needing to think about it.

const MAX_LEN = 64;
// `\p{M}` (Unicode Mark category) catches every combining diacritic emitted
// by NFKD decomposition. Equivalent to the previous `/[̀-ͯ]/g`
// literal-range form but uses the named Unicode-property escape — required
// by biome's `noMisleadingCharacterClass` rule (literal ranges over
// combining marks are ambiguous when the source bytes contain pre-composed
// glyphs).
const COMBINING_MARKS = /\p{M}/gu;
const NON_KEBAB = /[^a-z0-9]+/g;
const TRIM_DASHES = /^-+|-+$/g;
const TRAILING_DASHES = /-+$/g;

export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(NON_KEBAB, '-')
    .replace(TRIM_DASHES, '')
    .slice(0, MAX_LEN)
    .replace(TRAILING_DASHES, '');
}

// Bound on the collision-suffix search. 10k duplicates of a single stem is
// well beyond any plausible maestro catalog; reaching this is a signal that
// the slug stem itself is malformed (e.g. empty input → stem '' → every
// candidate is `-N`). Throwing surfaces the misuse instead of silently
// returning a degenerate slug.
const MAX_COLLISIONS = 10_000;

/**
 * Derive a slug from `input` that is guaranteed unique against `existing`.
 *
 * If the base slug is unique, returns it as-is. Otherwise appends `-2`,
 * `-3`, ... (NOT `-1`; the base form is already the implicit `-1`) and
 * returns the first un-taken candidate. Per AC-2.1.3 "appends `-2`, `-3`,
 * ... until unique".
 *
 * Gaps in the existing-set are filled: `{base, base-2, base-4}` → `base-3`.
 */
export function slugifyUnique(input: string, existing: Iterable<string>): string {
  const base = slugify(input);
  const taken = new Set(existing);
  if (!taken.has(base)) return base;
  for (let n = 2; n < MAX_COLLISIONS; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error(`slugify: exceeded ${MAX_COLLISIONS} collisions for stem "${base}"`);
}
