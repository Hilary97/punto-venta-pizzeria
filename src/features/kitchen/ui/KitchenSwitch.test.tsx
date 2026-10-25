import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchKitchenEnabled, setKitchenEnabled } from '../infrastructure/kitchenSettingsRepository'
import { KitchenSwitch } from './KitchenSwitch'

vi.mock('../infrastructure/kitchenSettingsRepository', () => ({
  fetchKitchenEnabled: vi.fn(),
  setKitchenEnabled: vi.fn(),
}))

const OFF_NOTICE = 'Cocina desactivada: los pedidos no pasan por Cocina ni Entrega.'

beforeEach(() => {
  vi.resetAllMocks()
})

describe('KitchenSwitch for an admin', () => {
  it('shows the kitchen on with a button to switch it off', async () => {
    vi.mocked(fetchKitchenEnabled).mockResolvedValue(true)
    render(<KitchenSwitch canEdit />)
    expect(await screen.findByRole('button', { name: 'Desactivar cocina' })).toBeVisible()
    expect(screen.getByText('Cocina con pantallas: activada')).toBeVisible()
    expect(screen.queryByText(OFF_NOTICE)).not.toBeInTheDocument()
  })

  it('asks before switching off and finishes pending orders only after confirming', async () => {
    vi.mocked(fetchKitchenEnabled).mockResolvedValue(true)
    vi.mocked(setKitchenEnabled).mockResolvedValue(false)
    const user = userEvent.setup()
    render(<KitchenSwitch canEdit />)

    await user.click(await screen.findByRole('button', { name: 'Desactivar cocina' }))
    const dialog = screen.getByRole('dialog', { name: '¿Desactivar la cocina?' })
    expect(dialog).toHaveTextContent(
      'Los pedidos pendientes en Cocina y Entrega se darán por terminados. Los pedidos nuevos no pasarán por la cocina.',
    )
    expect(setKitchenEnabled).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Desactivar' }))
    expect(setKitchenEnabled).toHaveBeenCalledWith(false)
    expect(await screen.findByText('Cocina con pantallas: desactivada')).toBeVisible()
    expect(screen.getByText(OFF_NOTICE)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Activar cocina' })).toBeVisible()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('cancelling keeps the kitchen on', async () => {
    vi.mocked(fetchKitchenEnabled).mockResolvedValue(true)
    const user = userEvent.setup()
    render(<KitchenSwitch canEdit />)

    await user.click(await screen.findByRole('button', { name: 'Desactivar cocina' }))
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(setKitchenEnabled).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText('Cocina con pantallas: activada')).toBeVisible()
  })

  it('switches the kitchen back on without asking', async () => {
    vi.mocked(fetchKitchenEnabled).mockResolvedValue(false)
    vi.mocked(setKitchenEnabled).mockResolvedValue(true)
    const user = userEvent.setup()
    render(<KitchenSwitch canEdit />)

    await user.click(await screen.findByRole('button', { name: 'Activar cocina' }))
    expect(setKitchenEnabled).toHaveBeenCalledWith(true)
    expect(await screen.findByText('Cocina con pantallas: activada')).toBeVisible()
    expect(screen.queryByText(OFF_NOTICE)).not.toBeInTheDocument()
  })

  it('shows the server error and keeps the previous state', async () => {
    vi.mocked(fetchKitchenEnabled).mockResolvedValue(true)
    vi.mocked(setKitchenEnabled).mockRejectedValue(new Error('Solo un administrador puede activar o desactivar la cocina.'))
    const user = userEvent.setup()
    render(<KitchenSwitch canEdit />)

    await user.click(await screen.findByRole('button', { name: 'Desactivar cocina' }))
    await user.click(screen.getByRole('button', { name: 'Desactivar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Solo un administrador puede activar o desactivar la cocina.')
    expect(screen.getByText('Cocina con pantallas: activada')).toBeVisible()
  })

  it('shows a load error', async () => {
    vi.mocked(fetchKitchenEnabled).mockRejectedValue(new Error('No se pudo cargar el estado de la cocina.'))
    render(<KitchenSwitch canEdit />)
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cargar el estado de la cocina.')
    expect(screen.queryByRole('button', { name: /cocina/ })).not.toBeInTheDocument()
  })
})

describe('KitchenSwitch for a cashier', () => {
  it('shows only the notice when the kitchen is off', async () => {
    vi.mocked(fetchKitchenEnabled).mockResolvedValue(false)
    render(<KitchenSwitch canEdit={false} />)
    expect(await screen.findByText(OFF_NOTICE)).toBeVisible()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('shows nothing when the kitchen is on', async () => {
    vi.mocked(fetchKitchenEnabled).mockResolvedValue(true)
    const { container } = render(<KitchenSwitch canEdit={false} />)
    await vi.waitFor(() => expect(fetchKitchenEnabled).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })
})
