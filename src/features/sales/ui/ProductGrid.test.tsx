import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Category, Product } from '../../products/domain/product'
import { ProductGrid } from './ProductGrid'

const categories: Category[] = [
  { id: 'c', name: 'Menú', sortOrder: 0 },
  { id: 'd', name: 'Bebidas', sortOrder: 1 },
]
const product = (over: Partial<Product> & Pick<Product, 'id' | 'name'>): Product => ({
  categoryId: 'c',
  priceCents: 9900,
  active: true,
  variants: [],
  ...over,
})

/** Tracks quantities per "productId|variant" so the grid is exercised as the workspace drives it. */
function Harness({ products, showPrices = false }: { products: Product[]; showPrices?: boolean }) {
  const [counts, setCounts] = useState<Record<string, number>>({})
  const key = (id: string, variant: string | null) => `${id}|${variant ?? ''}`
  return (
    <ProductGrid
      categories={categories}
      products={products}
      productQuantity={(id) => Object.entries(counts).reduce((sum, [k, n]) => (k.startsWith(`${id}|`) ? sum + n : sum), 0)}
      variantQuantity={(id, variant) => counts[key(id, variant)] ?? 0}
      onAddProduct={(p, variant) => setCounts((c) => ({ ...c, [key(p.id, variant)]: (c[key(p.id, variant)] ?? 0) + 1 }))}
      onRemoveProduct={(p, variant) => setCounts((c) => ({ ...c, [key(p.id, variant)]: Math.max(0, (c[key(p.id, variant)] ?? 0) - 1) }))}
      showPrices={showPrices}
    />
  )
}

describe('ProductGrid tiles', () => {
  it('adds one unit per tap and shows the quantity as a ×N badge, without a stepper on the tile', async () => {
    const user = userEvent.setup()
    render(<Harness products={[product({ id: 'p', name: 'Papas gajo' })]} />)
    expect(screen.queryByText('×1')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Papas gajo' }))
    expect(screen.getByText('×1')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Papas gajo' }))
    expect(screen.getByText('×2')).toBeVisible()
    expect(screen.queryByRole('button', { name: /quitar|agregar uno/i })).not.toBeInTheDocument()
  })

  it('makes product tiles at least 64px tall and marks the ones in the order', async () => {
    const user = userEvent.setup()
    render(<Harness products={[product({ id: 'p', name: 'Cerveza' })]} />)
    const tile = screen.getByRole('button', { name: 'Cerveza' })
    expect(tile).toHaveClass('min-h-16')
    const item = tile.closest('li')!
    expect(item).not.toHaveClass('dark:bg-red-950/60')
    await user.click(tile)
    expect(item).toHaveClass('border-red-700', 'bg-red-50', 'dark:bg-red-950/60')
  })

  it('hides prices unless asked to show them', () => {
    const { unmount } = render(<Harness products={[product({ id: 'p', name: 'Papas' })]} />)
    expect(screen.getByRole('button', { name: 'Papas' })).not.toHaveTextContent(/\$|99/)
    unmount()
    render(<Harness products={[product({ id: 'p', name: 'Papas' })]} showPrices />)
    expect(screen.getByRole('button', { name: /Papas/ })).toHaveTextContent('99.00')
  })

  it('shows a sold-out product disabled with the Agotado label', async () => {
    const user = userEvent.setup()
    render(
      <Harness
        products={[
          product({ id: 'soda', name: 'Refresco', trackStock: true, stock: 0, stockMin: 6 }),
          product({ id: 'beer', name: 'Cerveza', trackStock: true, stock: 2, stockMin: 6 }),
        ]}
      />,
    )
    const soda = screen.getByRole('button', { name: /Refresco/ })
    expect(soda).toBeDisabled()
    expect(within(soda).getByText('Agotado')).toBeVisible()
    await user.click(soda)
    expect(screen.queryByText('×1')).not.toBeInTheDocument()
    expect(within(screen.getByRole('button', { name: /Cerveza/ })).queryByText('Agotado')).not.toBeInTheDocument()
  })
})

describe('ProductGrid variants', () => {
  const burger = product({ id: 'b', name: 'Hamburguesa', variants: ['Res', 'Pollo'] })

  it('chooses the variant inline on the tile: each tap on a choice adds one unit of it', async () => {
    const user = userEvent.setup()
    render(<Harness products={[burger]} />)
    const choices = screen.getByRole('group', { name: 'Elige: Hamburguesa' })
    expect(within(choices).getByText('Elige:')).toBeVisible()
    for (const chip of within(choices).getAllByRole('button')) expect(chip).toHaveClass('min-h-11')

    await user.click(within(choices).getByRole('button', { name: 'Pollo' }))
    expect(within(choices).getByRole('button', { name: 'Pollo ×1' })).toBeVisible()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(within(choices).getByRole('button', { name: 'Pollo ×1' }))
    await user.click(within(choices).getByRole('button', { name: 'Res' }))
    expect(within(choices).getByRole('button', { name: 'Pollo ×2' })).toBeVisible()
    expect(within(choices).getByRole('button', { name: 'Res ×1' })).toBeVisible()
    expect(screen.getByText('×3')).toBeVisible()
  })

  it('shows a sold-out product with variants as Agotado, without choices', () => {
    render(<Harness products={[{ ...burger, trackStock: true, stock: 0, stockMin: 0 }]} />)
    expect(screen.getByText('Agotado')).toBeVisible()
    expect(screen.queryByRole('group', { name: /elige/i })).not.toBeInTheDocument()
  })
})

describe('ProductGrid search and categories', () => {
  const products = [
    product({ id: 'a', name: 'Alitas' }),
    product({ id: 'k', name: 'Coca-Cola', categoryId: 'd' }),
  ]

  it('has no Todos pill, starts on the first category and filters by category pill, with pills at least 44px tall', async () => {
    const user = userEvent.setup()
    render(<Harness products={products} />)
    const pills = screen.getByRole('group', { name: 'Categorías' })
    expect(within(pills).queryByRole('button', { name: 'Todos' })).not.toBeInTheDocument()
    for (const pill of within(pills).getAllByRole('button')) expect(pill).toHaveClass('min-h-11')
    expect(within(pills).getByRole('button', { name: 'Menú' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Alitas' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Coca-Cola' })).not.toBeInTheDocument()

    await user.click(within(pills).getByRole('button', { name: 'Bebidas' }))
    expect(within(pills).getByRole('button', { name: 'Bebidas' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(pills).getByRole('button', { name: 'Menú' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByRole('button', { name: 'Alitas' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Coca-Cola' })).toBeVisible()
  })

  it('searches every category while a query is present, then returns to the selected category', async () => {
    const user = userEvent.setup()
    render(<Harness products={products} />)
    const search = screen.getByRole('searchbox', { name: 'Buscar producto por nombre' })
    await user.type(search, 'coca')
    expect(screen.getByRole('button', { name: 'Coca-Cola' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Alitas' })).not.toBeInTheDocument()
    await user.clear(search)
    expect(screen.queryByRole('button', { name: 'Coca-Cola' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Alitas' })).toBeVisible()
  })

  it('searches by name ignoring case and says when nothing matches', async () => {
    const user = userEvent.setup()
    render(<Harness products={products} />)
    await user.type(screen.getByRole('searchbox', { name: 'Buscar producto por nombre' }), 'ALI')
    expect(screen.getByRole('button', { name: 'Alitas' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Coca-Cola' })).not.toBeInTheDocument()
    await user.type(screen.getByRole('searchbox'), 'zzz')
    expect(screen.getByText('No hay productos que coincidan con la búsqueda y categoría.')).toBeVisible()
  })
})

describe('ProductGrid long press', () => {
  afterEach(() => vi.useRealTimers())

  function longPress(el: HTMLElement) {
    fireEvent.pointerDown(el)
    act(() => vi.advanceTimersByTime(500))
    fireEvent.pointerUp(el)
    fireEvent.click(el)
  }

  it('removes one unit when a product tile is held, and unmarks it at zero', () => {
    vi.useFakeTimers()
    render(<Harness products={[product({ id: 'p', name: 'Cerveza' })]} />)
    const tile = screen.getByRole('button', { name: 'Cerveza' })
    fireEvent.click(tile)
    fireEvent.click(tile)
    expect(screen.getByText('×2')).toBeInTheDocument()

    longPress(tile)
    expect(screen.getByText('×1')).toBeInTheDocument()
    longPress(tile)
    expect(screen.queryByText(/×\d/)).not.toBeInTheDocument()
    expect(tile.closest('li')).not.toHaveClass('border-red-700')
  })

  it('removes one unit of the held variant only', () => {
    vi.useFakeTimers()
    render(<Harness products={[product({ id: 'b', name: 'Monster', variants: ['Res', 'Pollo'] })]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Res' }))
    fireEvent.click(screen.getByRole('button', { name: 'Pollo' }))
    longPress(screen.getByRole('button', { name: /Pollo/ }))
    expect(screen.getByRole('button', { name: /Res/ })).toHaveTextContent('×1')
    expect(screen.getByRole('button', { name: 'Pollo' })).not.toHaveTextContent('×')
  })

  it('a short press still adds, and holding a tile not in the order does nothing', () => {
    vi.useFakeTimers()
    render(<Harness products={[product({ id: 'p', name: 'Agua' })]} />)
    const tile = screen.getByRole('button', { name: 'Agua' })
    longPress(tile)
    expect(screen.queryByText(/×\d/)).not.toBeInTheDocument()
    fireEvent.pointerDown(tile)
    act(() => vi.advanceTimersByTime(200))
    fireEvent.pointerUp(tile)
    fireEvent.click(tile)
    expect(screen.getByText('×1')).toBeInTheDocument()
  })
})
