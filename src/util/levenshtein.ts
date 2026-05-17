/**
 * Classic Wagner-Fischer Levenshtein distance. Used for "did you mean …?"
 * suggestions when a user misspells a unit or variable name.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  // Single-row DP, reusing two arrays.
  let prev = new Array<number>(b.length + 1)
  let curr = new Array<number>(b.length + 1)
  for (let j = 0; j <= b.length; j++) prev[j] = j

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(
        prev[j]! + 1, // deletion
        curr[j - 1]! + 1, // insertion
        prev[j - 1]! + cost, // substitution
      )
    }
    ;[prev, curr] = [curr, prev]
  }
  return prev[b.length]!
}

/**
 * Pick the closest candidate within `maxDistance`, or null. Length-aware:
 * a query of 3 chars won't accept a 10-char suggestion. Empty candidate
 * set returns null.
 */
export function suggest(
  query: string,
  candidates: Iterable<string>,
  maxDistance = 2,
): string | null {
  let best: { name: string; dist: number } | null = null
  for (const name of candidates) {
    if (Math.abs(name.length - query.length) > maxDistance) continue
    const d = levenshtein(query, name)
    if (d <= maxDistance && (!best || d < best.dist)) {
      best = { name, dist: d }
    }
  }
  return best?.name ?? null
}
