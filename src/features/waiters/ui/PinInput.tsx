import { PIN_LENGTH } from '../domain/waiter'
import { Input } from '../../../shared/ui/Input'

interface PinInputProps {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
}

export function PinInput({ id, label, value, onChange }: PinInputProps) {
  return (
    <Input
      id={id}
      label={label}
      type="password"
      inputMode="numeric"
      maxLength={PIN_LENGTH}
      autoComplete="off"
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
      required
    />
  )
}
