import { formatMoney } from '../money'
import { cn } from './cn'

interface MoneyTextProps {
  cents: number
  className?: string
}

export function MoneyText({ cents, className }: MoneyTextProps) {
  return <span className={cn('tabular-nums', className)}>{formatMoney(cents)}</span>
}
