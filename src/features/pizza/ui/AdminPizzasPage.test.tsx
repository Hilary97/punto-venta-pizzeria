import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdminPizzaCatalog } from '../domain/pizzaAdmin'
import {
  createIngredient,
  listAdminPizzaCatalog,
  saveStyle,
  setIngredientActive,
  setStyleActive,
  updateExtras,
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
  updateExtras: vi.fn(),
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
      sortOrder: 1,
      active: false,
      prices: { chica: 13000, mediana: 22000, grande: 25000 },
    },
  ],
  ingredients: [
    { id: 'ham', name: 'Jamón', sortOrder: 1, active: true },
    { id: 'garlic', name: 'Ajo', sortOrder: 15, active: false },
  ],
  extras: { extraIngredientCents: 500, extraCheeseCents: 3000 },
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
  for (const write of [createIngredient, updateIngredient, setIngredientActive, setStyleActive, updateSize, updateExtras]) {
    vi.mocked(write).mockResolvedValue(undefined)
  }
  vi.mocked(saveStyle).mockResolvedValue('new')
})

describe('AdminPizzasPage listing', () => {
  it('shows sizes, styles with prices, ingredients and extras', async () => {
    await renderPage()

    expect(within(rowOf(section('Tamaños'), 'Grande')).getByText('Entera, Mitades, Tercios, Cuartos')).toBeInTheDocument()
    const varas = rowOf(section('Estilos'), 'Estilo Varas')
    expect(within(varas).getByText('Ingredientes fijos')).toBeInTheDocument()
    expect(within(varas).getByText('$130.00')).toBeInTheDocument()
    expect(within(varas).getByText('$250.00')).toBeInTheDocument()
    expect(within(varas).getByText('Inactivo')).toBeInTheDocument()
    expect(within(rowOf(section('Estilos'), 'Arma tu combinación')).getByText('Elige 2')).toBeInTheDocument()
    expect(within(rowOf(section('Ingredientes'), 'Ajo')).getByText('Inactivo')).toBeInTheDocument()
    const extras = section('Extras')
    expect(within(extras).getByText('$5.00')).toBeInTheDocument()
    expect(within(extras).getByText('$30.00')).toBeInTheDocument()
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
    expect(screen.queryByLabelText('Ingredientes a elegir')).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('Precio Grande (MXN)'), '210')
    await user.type(screen.getByLabelText('Precio Mediana (MXN)'), '190.50')
    await user.type(screen.getByLabelText('Precio Chica (MXN)'), '110')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(saveStyle).toHaveBeenCalledWith(null, {
      name: 'Estilo Nuevo',
      description: 'Jamón y piña',
      kind: 'special',
      includedIngredients: 0,
      sortOrder: 2,
      active: true,
      prices: { grande: 21000, mediana: 19050, chica: 11000 },
    })
    expect(listAdminPizzaCatalog).toHaveBeenCalledTimes(2)
  })

  it('edits a custom style and its included ingredients', async () => {
    const user = await renderPage()
    await user.click(within(rowOf(section('Estilos'), 'Arma tu combinación')).getByRole('button', { name: 'Editar' }))
    const included = screen.getByLabelText('Ingredientes a elegir')
    expect(included).toHaveValue('2')
    await user.selectOptions(included, '3')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(saveStyle).toHaveBeenCalledWith('custom', {
      name: 'Arma tu combinación',
      description: 'Incluye dos ingredientes',
      kind: 'custom',
      includedIngredients: 3,
      sortOrder: 0,
      active: true,
      prices: { chica: 11000, mediana: 19000, grande: 21000 },
    })
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

  it('edits the extra prices', async () => {
    const user = await renderPage()
    await user.click(within(section('Extras')).getByRole('button', { name: 'Editar extras' }))
    const extra = screen.getByLabelText('Ingrediente extra (MXN)')
    await user.clear(extra)
    await user.type(extra, '7')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(updateExtras).toHaveBeenCalledWith({ extraIngredientCents: 700, extraCheeseCents: 3000 })
  })
})
