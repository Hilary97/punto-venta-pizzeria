const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true })

/** Compares names alphabetically in Spanish: ignores case and accents, `ñ` after `n`, numbers by value. */
export function compareNames(a: string, b: string): number {
  return collator.compare(a, b)
}

/** Sort comparator for any row with a `name`. */
export function byName(a: { name: string }, b: { name: string }): number {
  return compareNames(a.name, b.name)
}
