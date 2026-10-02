import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WaiterShift } from '../domain/waiter'
import { SHIFT_STORAGE_KEY } from '../domain/shiftStorage'
import {
  deviceEndShift,
  deviceGetShift,
  deviceListWaiters,
  deviceStartShift,
} from '../infrastructure/waitersRepository'
import { WaiterShiftGate } from './WaiterShiftGate'

vi.mock('../infrastructure/waitersRepository', () => ({
  deviceListWaiters: vi.fn(),
  deviceStartShift: vi.fn(),
  deviceGetShift: vi.fn(),
  deviceEndShift: vi.fn(),
}))

const SECRET = 'b2'.repeat(32)

const shift: WaiterShift = {
  token: 'tok-1',
  waiterId: 'w1',
  fullName: 'Carlos',
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
}

function renderGate() {
  return render(
    <WaiterShiftGate secret={SECRET}>
      {(current, onChangeWaiter) => (
        <div>
          <p>Mesero: {current.fullName}</p>
          <button type="button" onClick={onChangeWaiter}>
            Cambiar mesero
          </button>
        </div>
      )}
    </WaiterShiftGate>,
  )
}

async function enterPin(user: ReturnType<typeof userEvent.setup>, digits: string) {
  for (const digit of digits) await user.click(screen.getByRole('button', { name: digit }))
}

beforeEach(() => {
  vi.resetAllMocks()
  localStorage.clear()
  vi.mocked(deviceListWaiters).mockResolvedValue([
    { id: 'w1', fullName: 'Carlos' },
    { id: 'w2', fullName: 'Lucia' },
  ])
  vi.mocked(deviceStartShift).mockResolvedValue(shift)
  vi.mocked(deviceGetShift).mockResolvedValue(shift)
  vi.mocked(deviceEndShift).mockResolvedValue(undefined)
})

describe('WaiterShiftGate', () => {
  it('lists the active waiters', async () => {
    renderGate()
    expect(await screen.findByText('¿Quién está tomando pedidos?')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Carlos' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Lucia' })).toBeVisible()
  })

  it('lists waiters with the device secret', async () => {
    renderGate()
    await screen.findByText('¿Quién está tomando pedidos?')
    expect(deviceListWaiters).toHaveBeenCalledWith(SECRET)
  })

  it('explains when there are no waiters', async () => {
    vi.mocked(deviceListWaiters).mockResolvedValue([])
    renderGate()
    expect(await screen.findByText(/no hay meseros registrados/i)).toBeVisible()
  })

  it('starts the shift automatically after four digits and renders the children', async () => {
    const user = userEvent.setup()
    renderGate()
    await user.click(await screen.findByRole('button', { name: 'Carlos' }))
    await enterPin(user, '1234')
    expect(deviceStartShift).toHaveBeenCalledWith(SECRET, 'w1', '1234')
    expect(await screen.findByText('Mesero: Carlos')).toBeVisible()
    expect(JSON.parse(localStorage.getItem(SHIFT_STORAGE_KEY)!).token).toBe('tok-1')
  })

  it('never shows the PIN digits', async () => {
    const user = userEvent.setup()
    vi.mocked(deviceStartShift).mockRejectedValue(new Error('PIN incorrecto.'))
    renderGate()
    await user.click(await screen.findByRole('button', { name: 'Carlos' }))
    await user.click(screen.getByRole('button', { name: '1' }))
    await user.click(screen.getByRole('button', { name: '2' }))
    expect(screen.queryByText('12')).not.toBeInTheDocument()
  })

  it('shows the server message and clears the PIN on a wrong PIN', async () => {
    const user = userEvent.setup()
    vi.mocked(deviceStartShift).mockRejectedValueOnce(new Error('PIN incorrecto.'))
    renderGate()
    await user.click(await screen.findByRole('button', { name: 'Carlos' }))
    await enterPin(user, '0000')
    expect(await screen.findByRole('alert')).toHaveTextContent('PIN incorrecto.')
    await enterPin(user, '1234')
    expect(deviceStartShift).toHaveBeenLastCalledWith(SECRET, 'w1', '1234')
    expect(deviceStartShift).toHaveBeenCalledTimes(2)
  })

  it('goes back to the waiter list with Volver', async () => {
    const user = userEvent.setup()
    renderGate()
    await user.click(await screen.findByRole('button', { name: 'Carlos' }))
    await user.click(screen.getByRole('button', { name: /volver/i }))
    expect(screen.getByText('¿Quién está tomando pedidos?')).toBeVisible()
  })

  it('skips the gate when the stored shift is still valid on the server', async () => {
    localStorage.setItem(SHIFT_STORAGE_KEY, JSON.stringify(shift))
    renderGate()
    expect(screen.getByRole('status')).toBeVisible()
    expect(await screen.findByText('Mesero: Carlos')).toBeVisible()
    expect(deviceGetShift).toHaveBeenCalledWith(SECRET, 'tok-1')
    expect(deviceStartShift).not.toHaveBeenCalled()
  })

  it('shows the gate when the server rejects the stored shift', async () => {
    localStorage.setItem(SHIFT_STORAGE_KEY, JSON.stringify(shift))
    vi.mocked(deviceGetShift).mockResolvedValue(null)
    renderGate()
    expect(await screen.findByText('¿Quién está tomando pedidos?')).toBeVisible()
    expect(localStorage.getItem(SHIFT_STORAGE_KEY)).toBeNull()
  })

  it('ends the shift with Cambiar mesero and shows the gate, even if the network fails', async () => {
    const user = userEvent.setup()
    localStorage.setItem(SHIFT_STORAGE_KEY, JSON.stringify(shift))
    vi.mocked(deviceEndShift).mockRejectedValue(new Error('offline'))
    renderGate()
    await user.click(await screen.findByRole('button', { name: /cambiar mesero/i }))
    expect(deviceEndShift).toHaveBeenCalledWith(SECRET, 'tok-1')
    await waitFor(() => expect(screen.getByText('¿Quién está tomando pedidos?')).toBeVisible())
    expect(localStorage.getItem(SHIFT_STORAGE_KEY)).toBeNull()
  })
})
