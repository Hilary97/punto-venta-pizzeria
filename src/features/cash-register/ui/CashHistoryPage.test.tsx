import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as repository from '../infrastructure/cashRegisterRepository'
import { CashHistoryPage } from './CashHistoryPage'

vi.mock('../infrastructure/cashRegisterRepository', () => ({
  listPastSessions: vi.fn(),
  deleteClosedCashSession: vi.fn(),
}))

const navigate = vi.hoisted(() => vi.fn())
vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router')
  return { ...actual, useNavigate: () => navigate }
})

const makeSession = (day: 1 | 2) => ({
  id: `00000000-0000-4000-8000-00000000000${day}`,
  openedBy: 'admin', openedAt: `2026-09-0${day}T12:00:00Z`,
  openingCents: 0, closedBy: 'admin', closedAt: `2026-09-0${day}T20:00:00Z`,
  countedCents: 0, expectedCents: 0, differenceCents: 0,
})

const sessions: [ReturnType<typeof makeSession>, ReturnType<typeof makeSession>] = [
  makeSession(1),
  makeSession(2),
]

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(repository.listPastSessions).mockResolvedValue(sessions)
  vi.mocked(repository.deleteClosedCashSession).mockResolvedValue(sessions[0].id)
})

function renderPage() {
  return render(
    <MemoryRouter>
      <CashHistoryPage />
    </MemoryRouter>,
  )
}

async function openConfirmation() {
  const user = userEvent.setup()
  renderPage()
  const buttons = await screen.findAllByRole('button', { name: /eliminar corte del/i })
  expect(buttons).toHaveLength(2)
  const [firstButton, secondButton] = buttons
  if (!firstButton || !secondButton) throw new Error('Expected a deletion button for each session')
  await user.click(firstButton)
  return { user, dialog: screen.getByRole('dialog'), buttons, secondButton }
}

describe('permanent cash history deletion', () => {
  it('names the date and consequences; cancellation has no effect', async () => {
    const { user, dialog } = await openConfirmation()
    expect(dialog).toHaveTextContent(new Date(sessions[0].openedAt).toLocaleString('es-MX'))
    expect(dialog).toHaveTextContent(/irreversible/i)
    expect(dialog).toHaveTextContent(/ventas y devoluciones/i)
    expect(dialog).toHaveTextContent(/caja abierta no se modifica/i)
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(repository.deleteClosedCashSession).not.toHaveBeenCalled()
    expect(screen.getAllByRole('button', { name: /eliminar corte del/i })).toHaveLength(2)
  })

  it('deletes exactly the selected id and removes only that row without reloading', async () => {
    const { user, dialog, secondButton } = await openConfirmation()
    const remainingName = secondButton.getAttribute('aria-label')!
    await user.click(within(dialog).getByRole('button', { name: 'Eliminar definitivamente' }))
    expect(repository.deleteClosedCashSession).toHaveBeenCalledExactlyOnceWith(sessions[0].id)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /eliminar corte del/i })).toHaveLength(1)
    expect(screen.getByRole('button', { name: remainingName })).toBeVisible()
    expect(repository.listPastSessions).toHaveBeenCalledTimes(1)
  })

  it('retains the dialog and both rows on failure', async () => {
    vi.mocked(repository.deleteClosedCashSession).mockRejectedValue(new Error('No se pudo eliminar.'))
    const { user, dialog } = await openConfirmation()
    await user.click(within(dialog).getByRole('button', { name: 'Eliminar definitivamente' }))
    expect(screen.getByRole('dialog')).toBeVisible()
    expect(within(dialog).getByText('No se pudo eliminar.')).toBeVisible()
    expect(screen.getAllByRole('button', { name: /eliminar corte del/i })).toHaveLength(2)
    expect(within(dialog).getByRole('button', { name: 'Cancelar' })).toBeEnabled()
  })

  it('guards immediate reentry and blocks closing or selecting another row while pending', async () => {
    let resolve!: (id: string) => void
    vi.mocked(repository.deleteClosedCashSession).mockReturnValue(new Promise((done) => { resolve = done }))
    const { dialog, buttons } = await openConfirmation()
    const confirm = within(dialog).getByRole('button', { name: 'Eliminar definitivamente' })
    act(() => { fireEvent.click(confirm); fireEvent.click(confirm) })
    expect(repository.deleteClosedCashSession).toHaveBeenCalledTimes(1)
    expect(confirm).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Cancelar' })).toBeDisabled()
    buttons.forEach((button) => expect(button).toBeDisabled())
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cerrar' }))
    expect(screen.getByRole('dialog')).toBeVisible()
    await act(async () => resolve(sessions[0].id))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('has no deletion controls when history is empty', async () => {
    vi.mocked(repository.listPastSessions).mockResolvedValue([])
    renderPage()
    await screen.findByText(/aún no hay cortes/i)
    expect(screen.queryByRole('button', { name: /eliminar/i })).not.toBeInTheDocument()
  })
})

describe('cash history detail navigation', () => {
  it('navigates to the detail route for the selected session', async () => {
    const user = userEvent.setup()
    renderPage()
    const detailButtons = await screen.findAllByRole('button', { name: /ver detalle/i })
    expect(detailButtons).toHaveLength(2)
    const [firstButton] = detailButtons
    if (!firstButton) throw new Error('Expected a detail button for each session')
    await user.click(firstButton)
    expect(navigate).toHaveBeenCalledExactlyOnceWith(`/admin/historial/${sessions[0].id}`)
  })
})
