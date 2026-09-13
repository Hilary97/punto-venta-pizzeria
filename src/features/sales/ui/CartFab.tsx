import { MoneyText } from '../../../shared/ui/MoneyText'

interface CartFabProps {
  itemCount: number
  totalCents: number
  onOpen: () => void
}

export function CartFab({ itemCount, totalCents, onOpen }: CartFabProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="fixed inset-x-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-40 flex items-center justify-between gap-3 rounded-2xl bg-red-700 px-5 py-4 text-white shadow-lg lg:hidden"
    >
      <span className="font-semibold">Ver carrito ({itemCount})</span>
      <MoneyText cents={totalCents} className="text-lg font-bold" />
    </button>
  )
}
