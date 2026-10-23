import { Button } from '../../../shared/ui/Button'
import { Modal } from '../../../shared/ui/Modal'
import { cn } from '../../../shared/ui/cn'

/** Up to this many variants fit in one column on a phone; more go in two. */
const SINGLE_COLUMN_MAX = 8

interface VariantPickerModalProps {
  productName: string
  variants: string[]
  onPick: (variant: string) => void
  onClose: () => void
}

export function VariantPickerModal({ productName, variants, onPick, onClose }: VariantPickerModalProps) {
  return (
    <Modal title={productName} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <div className={cn('grid gap-3', variants.length > SINGLE_COLUMN_MAX ? 'grid-cols-2' : 'grid-cols-1')}>
          {variants.map((variant) => (
            <Button key={variant} size="lg" className="min-h-14 w-full" onClick={() => onPick(variant)}>
              {variant}
            </Button>
          ))}
        </div>
        <Button variant="secondary" onClick={onClose}>
          Cancelar
        </Button>
      </div>
    </Modal>
  )
}
