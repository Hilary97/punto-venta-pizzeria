import { SUPPLY_UNIT_LABELS, type SupplyUnit } from '../domain/supply'

/** Up to 3 decimals, no trailing zeros: `2.5`, `12`, `0.125`. */
export function formatQuantity(value: number): string {
  return String(Number(value.toFixed(3)))
}

/** Quantity followed by its unit label: `2.5 kg`, `12 pz`. */
export function formatQuantityWithUnit(value: number, unit: SupplyUnit): string {
  return `${formatQuantity(value)} ${SUPPLY_UNIT_LABELS[unit]}`
}
