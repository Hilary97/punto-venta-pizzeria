interface OrderFabProps {
  itemCount: number
  onOpen: () => void
}

export function OrderFab({ itemCount, onOpen }: OrderFabProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="fixed inset-x-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-40 rounded-2xl bg-red-700 px-5 py-4 font-semibold text-white shadow-lg lg:hidden"
    >
      Ver pedido ({itemCount})
    </button>
  )
}
