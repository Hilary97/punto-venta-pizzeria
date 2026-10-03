import { Button } from '../../../shared/ui/Button'
import { Modal } from '../../../shared/ui/Modal'

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
        {variants.map((variant) => (
          <Button key={variant} size="lg" className="min-h-14 w-full" onClick={() => onPick(variant)}>
            {variant}
          </Button>
        ))}
        <Button variant="secondary" onClick={onClose}>
          Cancelar
        </Button>
      </div>
    </Modal>
  )
}
