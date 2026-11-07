/**
 * Splits a total in cents among people. Leftover cents go to the first people,
 * so the shares always add up to the total. Returns no shares for an invalid count.
 */
export function splitCents(totalCents: number, people: number): number[] {
  if (!Number.isSafeInteger(people) || people < 1) return []
  const base = Math.floor(totalCents / people)
  const leftover = totalCents - base * people
  return Array.from({ length: people }, (_, index) => base + (index < leftover ? 1 : 0))
}
