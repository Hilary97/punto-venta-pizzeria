import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdminPizzaCatalog } from '../domain/pizzaAdmin'
import {
  createExtra,
  createIngredient,
  listAdminPizzaCatalog,
  saveStyle,
  setExtraActive,
  setIngredientActive,
  setStyleActive,
  updateExtra,
  updateExtraIngredientPrice,
  updateIngredient,
  updateSize,
} from '../infrastructure/pizzaAdminRepository'
import { AdminPizzasPage } from './AdminPizzasPage'

vi.mock('../infrastructure/pizzaAdminRepository', () => ({
  listAdminPizzaCatalog: vi.fn(),
  createIngredient: vi.fn(),
  updateIngredient: vi.fn(),
  setIngredientActive: vi.fn(),
  saveStyle: vi.fn(),
  setStyleActive: vi.fn(),
  updateSize: vi.fn(),
  updateExtraIngredientPrice: vi.fn(),
  createExtra: vi.fn(),
  updateExtra: vi.fn(),
  setExtraActive: vi.fn(),
}))

const catalog: AdminPizzaCatalog = {
  sizes: [
    { code: 'grande', name: 'Grande', allowedPortions: [1, 2, 3, 4], sortOrder: 1 },
    { code: 'mediana', name: 'Mediana', allowedPortions: [1, 2], sortOrder: 2 },
    { code: 'chica', name: 'Chica', allowedPortions: [1], sortOrder: 3 },
  ],
  styles: [
    {
      id: 'custom',
      name: 'Arma tu combinación',
      description: 'Incluye dos ingredientes',
      kind: 'custom',
      includedIngredients: 2,
      chargesElaboration: false,
      splitFees: { halves: 0, thirds: 0, quarters: 0 },
      sortOrder: 0,
      active: true,
      prices: { chica: 11000, mediana: 19000, grande: 21000 },
    },
    {
      id: 'varas',
      name: 'Estilo Varas',
      description: 'Pepperoni y jamón',
      kind: 'special',
      includedIngredients: 0,
      chargesElaboration: true,
      splitFees: { halves: 1000, thirds: 2000, quarters: 3000 },
      sortOrder: 1,
      active: false,
      prices: { chica: 13000, mediana: 22000, grande: 25000 },
    },
  ],
  ingredients: [
    { id: 'ham', name: 'Jamón', sortOrder: 1, active: true },
    { id: 'garlic', name: 'Ajo', sortOrder: 15, active: false },
  ],
  extraIngredientCents: 500,
  extras: [
    { id: 'cheese', name: 'Extra queso', priceCents: 3000, sortOrder: 1, active: true },
    { id: 'crust', name: 'Orilla rellena', priceCents: 4000, sortOrder: 2, active: false },
  ],
}

function section(name: string) {
  return screen.getByRole('region', { name })
}

function rowOf(region: HTMLElement, name: string) {
  return within(region).getByRole('row', { name: new RegExp(name) })
}

async function renderPage() {
  const user = userEvent.setup()
  render(<AdminPizzasPage />)
  await screen.findByRole('heading', { name: 'Pizzas' })
  return user
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(listAdminPizzaCatalog).mockResolvedValue(catalog)
  for (const write of [
    createIngredient,
    updateIngredient,
    setIngredientActive,
    setStyleActive,
    updateSize,
    updateExtraIngredientPrice,
    createExtra,
    updateExtra,
    setExtraActive,
  ]) {
    vi.mocked(write).mockResolvedValue(undefined)
  }
  vi.mocked(saveStyle).mockResolvedValue('new')
})

describe('AdminPizzasPage listing', () => {
  it('shows sizes, styles with prices, ingredients and extras', async () => {
    await renderPage()

    expect(within(rowOf(section('Tamaños'), 'Grande')).getByText('Entera, Mitades, Tercios, Cuartos')).toBeInTheDocument()
    const varas = rowOf(section('Estilos'), 'Estilo Varas')
    expect(within(varas).getByText('Fijos')).toBeInTheDocument()
    expect(within(varas).getByText('$130.00')).toBeInTheDocument()
    expect(within(varas).getByText('$250.00')).toBeInTheDocument()
    expect(within(varas).getByText('Inactivo')).toBeInTheDocument()
    expect(within(rowOf(section('Estilos'), 'Arma tu combinación')).getByText('Elige 2')).toBeInTheDocument()
    expect(within(rowOf(section('Ingredientes'), 'Ajo')).getByText('Inactivo')).toBeInTheDocument()
    const extras = section('Extras')
    expect(within(extras).getByText('Ingrediente extra (por porción)')).toBeInTheDocument()
    expect(within(extras).getByText('$5.00')).toBeInTheDocument()
    const cheese = rowOf(extras, 'Extra queso')
    expect(within(cheese).getByText('$30.00')).toBeInTheDocument()
    expect(within(cheese).getByText('Activo')).toBeInTheDocument()
    const crust = rowOf(extras, 'Orilla rellena')
    expect(within(crust).getByText('$40.00')).toBeInTheDocument()
    expect(within(crust).getByText('Inactivo')).toBeInTheDocument()
    expect(within(extras).queryByText('Extra queso (por porción)')).not.toBeInTheDocument()
  })

  it('shows a load error', async () => {
    vi.mocked(listAdminPizzaCatalog).mockRejectedValue(new Error('No se pudo cargar la configuración de pizzas.'))
    render(<AdminPizzasPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cargar la configuración de pizzas.')
  })
})

describe('AdminPizzasPage ingredients', () => {
  it('creates an ingredient and reloads', async () => {
    const user = await renderPage()
    await user.click(within(section('Ingredientes')).getByRole('button', { name: 'Nuevo ingrediente' }))
    await user.type(screen.getByLabelText('Nombre'), 'Elote')
    const order = screen.getByLabelText('Orden')
    expect(order).toHaveValue('16')
    await user.clear(order)
    await user.type(order, '20')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(createIngredient).toHaveBeenCalledWith({ name: 'Elote', sortOrder: 20, active: true })
    expect(listAdminPizzaCatalog).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('edits an ingredient', async () => {
    const user = await renderPage()
    await user.click(within(rowOf(section('Ingredientes'), 'Jamón')).getByRole('button', { name: 'Editar' }))
    const name = screen.getByLabelText('Nombre')
    await user.clear(name)
    await user.type(name, 'Jamón de pavo')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(updateIngredient).toHaveBeenCalledWith('ham', { name: 'Jamón de pavo', sortOrder: 1, active: true })
  })

  it('keeps the dialog open with the server message and no reload', async () => {
    vi.mocked(createIngredient).mockRejectedValue(new Error('Ya existe un ingrediente con ese nombre.'))
    const user = await renderPage()
    await user.click(within(section('Ingredientes')).getByRole('button', { name: 'Nuevo ingrediente' }))
    await user.type(screen.getByLabelText('Nombre'), 'Jamón')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(within(screen.getByRole('dialog')).getByRole('alert')).toHaveTextContent('Ya existe un ingrediente con ese nombre.')
    expect(listAdminPizzaCatalog).toHaveBeenCalledTimes(1)
  })

  it('rejects a blank name without calling the repository', async () => {
    const user = await renderPage()
    await user.click(within(section('Ingredientes')).getByRole('button', { name: 'Nuevo ingrediente' }))
    await user.type(screen.getByLabelText('Nombre'), '   ')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(screen.getByRole('alert')).toHaveTextContent('El nombre es obligatorio.')
    expect(createIngredient).not.toHaveBeenCalled()
  })

  it('activates an inactive ingredient', async () => {
    const user = await renderPage()
    await user.click(within(rowOf(section('Ingredientes'), 'Ajo')).getByRole('button', { name: 'Activar' }))

    expect(setIngredientActive).toHaveBeenCalledWith('garlic', true)
    expect(listAdminPizzaCatalog).toHaveBeenCalledTimes(2)
  })
})

describe('AdminPizzasPage styles', () => {
  it('creates a special style with prices in pesos', async () => {
    const user = await renderPage()
    await user.click(within(section('Estilos')).getByRole('button', { name: 'Nuevo estilo' }))
    await user.type(screen.getByLabelText('Nombre'), 'Estilo Nuevo')
    await user.type(screen.getByLabelText('Descripción'), 'Jamón y piña')
    expect(screen.getByLabelText('Ingredientes a elegir')).toHaveValue('2')
    expect(screen.queryByText(/no se podrán cobrar/)).not.toBeInTheDocument()
    expect(screen.getByLabelText('Cobra elaboración al dividir')).not.toBeChecked()
    expect(screen.getByLabelText('Mitades (MXN)')).toHaveValue('0.00')
    expect(screen.getByLabelText('Mitades (MXN)')).toBeDisabled()
    expect(screen.getByLabelText('Tercios (MXN)')).toHaveValue('0.00')
    expect(screen.getByLabelText('Tercios (MXN)')).toBeDisabled()
    expect(screen.getByLabelText('Cuartos (MXN)')).toHaveValue('0.00')
    expect(screen.getByLabelText('Cuartos (MXN)')).toBeDisabled()
    await user.click(screen.getByLabelText('Cobra elaboración al dividir'))
    expect(screen.getByLabelText('Mitades (MXN)')).toBeEnabled()
    expect(screen.getByLabelText('Tercios (MXN)')).toBeEnabled()
    expect(screen.getByLabelText('Cuartos (MXN)')).toBeEnabled()
    await user.clear(screen.getByLabelText('Mitades (MXN)'))
    await user.type(screen.getByLabelText('Mitades (MXN)'), '15')
    await user.type(screen.getByLabelText('Precio Grande (MXN)'), '210')
    await user.type(screen.getByLabelText('Precio Mediana (MXN)'), '190.50')
    await user.type(screen.getByLabelText('Precio Chica (MXN)'), '110')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(saveStyle).toHaveBeenCalledWith(null, {
      name: 'Estilo Nuevo',
      description: 'Jamón y piña',
      kind: 'special',
      includedIngredients: 2,
      chargesElaboration: true,
      splitFees: { halves: 1500, thirds: 0, quarters: 0 },
      sortOrder: 2,
      active: true,
      prices: { grande: 21000, mediana: 19050, chica: 11000 },
    })
    expect(listAdminPizzaCatalog).toHaveBeenCalledTimes(2)
  })

  it('edits the elaboration fees of a style', async () => {
    const user = await renderPage()
    await user.click(within(rowOf(section('Estilos'), 'Estilo Varas')).getByRole('button', { name: 'Editar' }))
    expect(screen.getByLabelText('Mitades (MXN)')).toHaveValue('10.00')
    expect(screen.getByLabelText('Tercios (MXN)')).toHaveValue('20.00')
    const quarters = screen.getByLabelText('Cuartos (MXN)')
    expect(quarters).toHaveValue('30.00')
    await user.clear(quarters)
    await user.type(quarters, '45.50')
    const halves = screen.getByLabelText('Mitades (MXN)')
    await user.clear(halves)
    await user.type(halves, '0')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(saveStyle).toHaveBeenCalledWith(
      'varas',
      expect.objectContaining({ kind: 'special', splitFees: { halves: 0, thirds: 2000, quarters: 4550 } }),
    )
    expect(listAdminPizzaCatalog).toHaveBeenCalledTimes(2)
  })

  it('turns a style\'s elaboration off keeping its fees', async () => {
    const user = await renderPage()
    await user.click(within(rowOf(section('Estilos'), 'Estilo Varas')).getByRole('button', { name: 'Editar' }))
    const toggle = screen.getByLabelText('Cobra elaboración al dividir')
    expect(toggle).toBeChecked()
    await user.click(toggle)
    expect(screen.getByLabelText('Mitades (MXN)')).toBeDisabled()
    expect(screen.getByLabelText('Mitades (MXN)')).toHaveValue('10.00')
    expect(screen.getByLabelText('Tercios (MXN)')).toHaveValue('20.00')
    expect(screen.getByLabelText('Cuartos (MXN)')).toHaveValue('30.00')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(saveStyle).toHaveBeenCalledWith(
      'varas',
      expect.objectContaining({ chargesElaboration: false, splitFees: { halves: 1000, thirds: 2000, quarters: 3000 } }),
    )
  })

  it('shows no elaboration charge for an unmarked style even with fees', async () => {
    vi.mocked(listAdminPizzaCatalog).mockResolvedValue({
      ...catalog,
      styles: catalog.styles.map((style) => ({ ...style, chargesElaboration: false })),
    })
    await renderPage()
    const varas = rowOf(section('Estilos'), 'Estilo Varas')
    expect(within(varas).getByText('Sin cargo por elaboración')).toBeInTheDocument()
    expect(within(varas).queryByText(/Elaboración:/)).not.toBeInTheDocument()
  })

  it('rejects an invalid elaboration fee without calling the repository', async () => {
    const user = await renderPage()
    await user.click(within(rowOf(section('Estilos'), 'Estilo Varas')).getByRole('button', { name: 'Editar' }))
    const thirds = screen.getByLabelText('Tercios (MXN)')
    await user.clear(thirds)
    await user.type(thirds, 'abc')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Ingresa un cargo por elaboración válido para Tercios, por ejemplo 10.00.',
    )
    expect(saveStyle).not.toHaveBeenCalled()
    expect(listAdminPizzaCatalog).toHaveBeenCalledTimes(1)
  })

  it('shows each style\'s elaboration fees', async () => {
    await renderPage()
    const varas = rowOf(section('Estilos'), 'Estilo Varas')
    expect(within(varas).getByText('Fijos')).toBeInTheDocument()
    expect(within(varas).getByText('Elaboración: Mitades $10.00 · Tercios $20.00 · Cuartos $30.00')).toBeInTheDocument()
    expect(within(rowOf(section('Estilos'), 'Arma tu combinación')).getByText('Sin cargo por elaboración')).toBeInTheDocument()
  })

  it('has no global elaboration fee', async () => {
    await renderPage()
    expect(within(section('Estilos')).queryByRole('button', { name: 'Editar cargo' })).not.toBeInTheDocument()
  })

  it('edits a custom style and its included ingredients', async () => {
    const user = await renderPage()
    await user.click(within(rowOf(section('Estilos'), 'Arma tu combinación')).getByRole('button', { name: 'Editar' }))
    expect(screen.getByText(/los pedidos abiertos con este estilo no se podrán cobrar/)).toBeInTheDocument()
    expect(screen.getByLabelText('Mitades (MXN)')).toHaveValue('0.00')
    const included = screen.getByLabelText('Ingredientes a elegir')
    expect(included).toHaveValue('2')
    await user.selectOptions(included, '3')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(saveStyle).toHaveBeenCalledWith('custom', {
      name: 'Arma tu combinación',
      description: 'Incluye dos ingredientes',
      kind: 'custom',
      includedIngredients: 3,
      chargesElaboration: false,
      splitFees: { halves: 0, thirds: 0, quarters: 0 },
      sortOrder: 0,
      active: true,
      prices: { chica: 11000, mediana: 19000, grande: 21000 },
    })
  })

  it('lets a special style include 0-4 ingredients and a custom one 1-4', async () => {
    const user = await renderPage()
    await user.click(within(section('Estilos')).getByRole('button', { name: 'Nuevo estilo' }))
    const included = screen.getByLabelText('Ingredientes a elegir')
    const options = () => within(included).getAllByRole('option').map((option) => option.textContent)
    expect(options()).toEqual(['0', '1', '2', '3', '4'])
    await user.selectOptions(included, '0')
    await user.selectOptions(screen.getByLabelText('Tipo'), 'custom')
    expect(options()).toEqual(['1', '2', '3', '4'])
    expect(included).toHaveValue('1')
  })

  it('lists the included ingredients of a special style', async () => {
    vi.mocked(listAdminPizzaCatalog).mockResolvedValue({
      ...catalog,
      styles: catalog.styles.map((style) => ({ ...style, includedIngredients: 2 })),
    })
    await renderPage()
    expect(within(rowOf(section('Estilos'), 'Estilo Varas')).getByText('Fijos + elige 2')).toBeInTheDocument()
    expect(within(rowOf(section('Estilos'), 'Estilo Varas')).queryByText('Sin cargo por elaboración')).not.toBeInTheDocument()
  })

  it('rejects an invalid price without calling the repository', async () => {
    const user = await renderPage()
    await user.click(within(rowOf(section('Estilos'), 'Estilo Varas')).getByRole('button', { name: 'Editar' }))
    const price = screen.getByLabelText('Precio Chica (MXN)')
    await user.clear(price)
    await user.type(price, 'abc')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(screen.getByRole('alert')).toHaveTextContent('Ingresa un precio válido para Chica, por ejemplo 150.50.')
    expect(saveStyle).not.toHaveBeenCalled()
  })

  it('deactivates a style', async () => {
    const user = await renderPage()
    await user.click(within(rowOf(section('Estilos'), 'Arma tu combinación')).getByRole('button', { name: 'Desactivar' }))

    expect(setStyleActive).toHaveBeenCalledWith('custom', false)
  })
})

describe('AdminPizzasPage sizes and extras', () => {
  it('edits a size name and its allowed portions', async () => {
    const user = await renderPage()
    await user.click(within(rowOf(section('Tamaños'), 'Grande')).getByRole('button', { name: 'Editar' }))
    const name = screen.getByLabelText('Nombre')
    await user.clear(name)
    await user.type(name, 'Familiar')
    expect(screen.getByText(/los pedidos abiertos con este tamaño no se podrán cobrar/)).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: 'Tercios' }))
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(updateSize).toHaveBeenCalledWith('grande', { name: 'Familiar', allowedPortions: [1, 2, 4] })
  })

  it('needs at least one allowed portion', async () => {
    const user = await renderPage()
    await user.click(within(rowOf(section('Tamaños'), 'Chica')).getByRole('button', { name: 'Editar' }))
    await user.click(screen.getByRole('checkbox', { name: 'Entera' }))
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(screen.getByRole('alert')).toHaveTextContent('Elige al menos una forma de dividir la pizza.')
    expect(updateSize).not.toHaveBeenCalled()
  })

  it('edits the extra ingredient price', async () => {
    const user = await renderPage()
    await user.click(within(section('Extras')).getByRole('button', { name: 'Editar precio' }))
    expect(screen.getByRole('dialog', { name: 'Precio de ingrediente extra' })).toBeInTheDocument()
    const extra = screen.getByLabelText('Ingrediente extra (MXN)')
    await user.clear(extra)
    await user.type(extra, '7')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(updateExtraIngredientPrice).toHaveBeenCalledWith({ extraIngredientCents: 700 })
    expect(listAdminPizzaCatalog).toHaveBeenCalledTimes(2)
  })
})

describe('AdminPizzasPage extras', () => {
  it('creates an extra and reloads', async () => {
    const user = await renderPage()
    await user.click(within(section('Extras')).getByRole('button', { name: 'Nuevo extra' }))
    expect(screen.getByRole('dialog', { name: 'Nuevo extra' })).toBeInTheDocument()
    await user.type(screen.getByLabelText('Nombre'), 'Doble salsa')
    await user.type(screen.getByLabelText('Precio (MXN)'), '25.50')
    expect(screen.getByLabelText('Orden')).toHaveValue('3')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(createExtra).toHaveBeenCalledWith({ name: 'Doble salsa', priceCents: 2550, sortOrder: 3, active: true })
    expect(listAdminPizzaCatalog).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('edits an extra', async () => {
    const user = await renderPage()
    await user.click(within(rowOf(section('Extras'), 'Extra queso')).getByRole('button', { name: 'Editar' }))
    expect(screen.getByRole('dialog', { name: 'Editar extra' })).toBeInTheDocument()
    expect(screen.getByLabelText('Precio (MXN)')).toHaveValue('30.00')
    const price = screen.getByLabelText('Precio (MXN)')
    await user.clear(price)
    await user.type(price, '35')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(updateExtra).toHaveBeenCalledWith('cheese', { name: 'Extra queso', priceCents: 3500, sortOrder: 1, active: true })
  })

  it('keeps the dialog open with the server message and no reload', async () => {
    vi.mocked(createExtra).mockRejectedValue(new Error('Ya existe un extra con ese nombre.'))
    const user = await renderPage()
    await user.click(within(section('Extras')).getByRole('button', { name: 'Nuevo extra' }))
    await user.type(screen.getByLabelText('Nombre'), 'Extra queso')
    await user.type(screen.getByLabelText('Precio (MXN)'), '30')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(within(screen.getByRole('dialog')).getByRole('alert')).toHaveTextContent('Ya existe un extra con ese nombre.')
    expect(listAdminPizzaCatalog).toHaveBeenCalledTimes(1)
  })

  it('rejects an invalid price without calling the repository', async () => {
    const user = await renderPage()
    await user.click(within(section('Extras')).getByRole('button', { name: 'Nuevo extra' }))
    await user.type(screen.getByLabelText('Nombre'), 'Doble salsa')
    await user.type(screen.getByLabelText('Precio (MXN)'), 'abc')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(screen.getByRole('alert')).toHaveTextContent('Ingresa un precio válido, por ejemplo 150.50.')
    expect(createExtra).not.toHaveBeenCalled()
  })

  it('deactivates and activates an extra', async () => {
    const user = await renderPage()
    await user.click(within(rowOf(section('Extras'), 'Extra queso')).getByRole('button', { name: 'Desactivar' }))
    expect(setExtraActive).toHaveBeenCalledWith('cheese', false)
    await user.click(within(rowOf(section('Extras'), 'Orilla rellena')).getByRole('button', { name: 'Activar' }))
    expect(setExtraActive).toHaveBeenCalledWith('crust', true)
  })
})
