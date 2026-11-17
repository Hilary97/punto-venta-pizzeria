import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { PizzaCatalog } from '../../pizza/domain/pizza'
import { VoiceOrderSheet, type VoiceConfirmedLine } from './VoiceOrderSheet'

const CATALOG: PizzaCatalog = {
  sizes: [{ code: 'grande', name: 'Grande', allowedPortions: [1, 2, 3, 4], sortOrder: 1, doughLeft: null }],
  styles: [{ id: 'pep', name: 'Estilo Pepperoni', description: '', kind: 'special', includedIngredients: 0, sortOrder: 1 }],
  ingredients: [],
  extras: [],
}

/** Unambiguous catalog: one Coca-Cola and one product with variants. */
const PRODUCTS = [
  { id: 'coca', name: 'Coca-Cola 600 ml', variants: [] },
  { id: 'alitas', name: 'Alitas 5 pzas', variants: ['Búfalo', 'BBQ'] },
]

const GRANDE_PEP = { size: 'grande', portions: [{ styleId: 'pep', ingredientIds: [], extraIngredientIds: [] }], extraIds: [] }

function openSheet(overrides: Partial<Parameters<typeof VoiceOrderSheet>[0]> = {}) {
  const onAdd = vi.fn<(lines: VoiceConfirmedLine[]) => void>()
  const onClose = vi.fn<() => void>()
  render(<VoiceOrderSheet open products={PRODUCTS} pizzaCatalog={CATALOG} onAdd={onAdd} onClose={onClose} {...overrides} />)
  return { onAdd, onClose }
}

async function interpret(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.type(screen.getByLabelText('Dicta o escribe el pedido'), text)
  await user.click(screen.getByRole('button', { name: 'Interpretar' }))
}

describe('VoiceOrderSheet', () => {
  it('shows one row per interpreted line with its name and quantity, and nothing interpreted on open', async () => {
    const { onAdd } = openSheet()
    const user = userEvent.setup()
    expect(screen.queryByRole('group', { name: /^Cantidad de/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Agregar al pedido' })).toBeDisabled()
    await interpret(user, 'dos cocas y una grande de pepperoni')
    expect(screen.getByText('Coca-Cola 600 ml')).toBeVisible()
    expect(screen.getByText('Pizza Grande: Estilo Pepperoni')).toBeVisible()
    expect(within(screen.getByRole('group', { name: 'Cantidad de Coca-Cola 600 ml' })).getByText('×2')).toBeVisible()
    expect(within(screen.getByRole('group', { name: 'Cantidad de Pizza Grande: Estilo Pepperoni' })).getByText('×1')).toBeVisible()
    expect(onAdd).not.toHaveBeenCalled()
  })

  it('adds only through Agregar al pedido, with the complete resolved lines', async () => {
    const { onAdd } = openSheet()
    const user = userEvent.setup()
    await interpret(user, 'dos cocas y una grande de pepperoni')
    expect(onAdd).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Agregar al pedido' }))
    expect(onAdd).toHaveBeenCalledTimes(1)
    expect(onAdd).toHaveBeenCalledWith([
      { kind: 'product', productId: 'coca', name: 'Coca-Cola 600 ml', variant: null, quantity: 2, notes: '' },
      { kind: 'pizza', pizza: GRANDE_PEP, name: 'Pizza Grande: Estilo Pepperoni', quantity: 1, notes: '' },
    ])
  })

  it('requires choosing one option of a pickProduct row before it can be added', async () => {
    const { onAdd } = openSheet({
      products: [
        { id: 'coca600', name: 'Coca-Cola 600 ml', variants: [] },
        { id: 'coca2l', name: 'Coca-Cola 2 litros', variants: [] },
      ],
    })
    const user = userEvent.setup()
    await interpret(user, 'tres cocas')
    const add = screen.getByRole('button', { name: 'Agregar al pedido' })
    expect(add).toBeDisabled()
    const choices = screen.getByRole('group', { name: 'Elige: tres cocas' })
    expect(within(choices).getByRole('button', { name: 'Coca-Cola 600 ml' })).toBeVisible()
    expect(within(choices).getByRole('button', { name: 'Coca-Cola 2 litros' })).toBeVisible()
    await user.click(within(choices).getByRole('button', { name: 'Coca-Cola 2 litros' }))
    expect(add).toBeEnabled()
    await user.click(add)
    expect(onAdd).toHaveBeenCalledWith([
      { kind: 'product', productId: 'coca2l', name: 'Coca-Cola 2 litros', variant: null, quantity: 3, notes: 'cocas' },
    ])
  })

  it('requires choosing a variant of a missingVariant row before it can be added', async () => {
    const { onAdd } = openSheet()
    const user = userEvent.setup()
    await interpret(user, '2 alitas')
    const add = screen.getByRole('button', { name: 'Agregar al pedido' })
    expect(add).toBeDisabled()
    const choices = screen.getByRole('group', { name: 'Elige: Alitas 5 pzas' })
    await user.click(within(choices).getByRole('button', { name: 'Búfalo' }))
    expect(add).toBeEnabled()
    await user.click(add)
    expect(onAdd).toHaveBeenCalledWith([
      { kind: 'product', productId: 'alitas', name: 'Alitas 5 pzas', variant: 'Búfalo', quantity: 2, notes: '' },
    ])
  })

  it('shows unknown text with its reason, never adds it, and it does not block the other rows', async () => {
    const { onAdd } = openSheet()
    const user = userEvent.setup()
    await interpret(user, 'dos tacos')
    expect(within(screen.getByRole('list')).getByText('dos tacos')).toBeVisible()
    expect(screen.getByText(/No reconocí/)).toBeVisible()
    expect(screen.getByText('1 línea no se va a agregar')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Agregar al pedido' })).toBeDisabled()
    expect(onAdd).not.toHaveBeenCalled()

    await interpret(user, 'dos tacos y una coca')
    expect(screen.getByText(/No reconocí/)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Agregar al pedido' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Agregar al pedido' }))
    expect(onAdd).toHaveBeenCalledTimes(1)
    expect(onAdd).toHaveBeenCalledWith([
      { kind: 'product', productId: 'coca', name: 'Coca-Cola 600 ml', variant: null, quantity: 1, notes: '' },
    ])
  })

  it('lets the quantity be adjusted before adding, so a noted line of three arrives as one line of three', async () => {
    const { onAdd } = openSheet()
    const user = userEvent.setup()
    await interpret(user, '3 cocas sin hielo')
    const stepper = screen.getByRole('group', { name: 'Cantidad de Coca-Cola 600 ml' })
    expect(within(stepper).getByText('×3')).toBeVisible()
    expect(screen.getByText('Nota: sin hielo')).toBeVisible()
    await user.click(within(stepper).getByRole('button', { name: 'Agregar uno' }))
    expect(within(stepper).getByText('×4')).toBeVisible()
    await user.click(within(stepper).getByRole('button', { name: 'Quitar uno' }))
    await user.click(within(stepper).getByRole('button', { name: 'Quitar uno' }))
    expect(within(stepper).getByText('×2')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Agregar al pedido' }))
    expect(onAdd).toHaveBeenCalledWith([
      { kind: 'product', productId: 'coca', name: 'Coca-Cola 600 ml', variant: null, quantity: 2, notes: 'sin hielo' },
    ])
  })

  it('S8/S10: never hands over a product line without the variant the server requires', async () => {
    const { onAdd } = openSheet({
      products: [
        { id: 'alitas5', name: 'Alitas 5 pzas', variants: ['Búfalo', 'BBQ'] },
        { id: 'alitas10', name: 'Alitas 10 pzas', variants: ['Búfalo', 'BBQ'] },
      ],
    })
    const user = userEvent.setup()
    await interpret(user, '2 alitas')
    await user.click(within(screen.getByRole('group', { name: 'Elige: 2 alitas' })).getByRole('button', { name: 'Alitas 5 pzas' }))
    const add = screen.getByRole('button', { name: 'Agregar al pedido' })
    if (!(add as HTMLButtonElement).disabled) await user.click(add)
    for (const call of onAdd.mock.calls) expect(call[0].every((line) => line.kind !== 'product' || line.variant !== null)).toBe(true)
    expect(add).toBeDisabled()
    await user.click(within(screen.getByRole('group', { name: 'Elige: Alitas 5 pzas' })).getByRole('button', { name: 'Búfalo' }))
    expect(add).toBeEnabled()
    await user.click(add)
    expect(onAdd).toHaveBeenCalledTimes(1)
    expect(onAdd).toHaveBeenCalledWith([
      { kind: 'product', productId: 'alitas5', name: 'Alitas 5 pzas', variant: 'Búfalo', quantity: 2, notes: 'alitas' },
    ])
  })

  it('A1: pins the minimum quantity at one, like the builder control', async () => {
    const { onAdd } = openSheet()
    const user = userEvent.setup()
    await interpret(user, 'una coca')
    const stepper = screen.getByRole('group', { name: 'Cantidad de Coca-Cola 600 ml' })
    await user.click(within(stepper).getByRole('button', { name: 'Quitar uno' }))
    expect(within(stepper).queryByText('×0')).not.toBeInTheDocument()
    expect(within(stepper).getByText('×1')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Agregar al pedido' }))
    expect(onAdd).toHaveBeenCalledWith([
      { kind: 'product', productId: 'coca', name: 'Coca-Cola 600 ml', variant: null, quantity: 1, notes: '' },
    ])
  })

  it('Cancelar closes without adding anything', async () => {
    const { onAdd, onClose } = openSheet()
    const user = userEvent.setup()
    await interpret(user, 'una coca')
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onAdd).not.toHaveBeenCalled()
  })
})
