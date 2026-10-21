import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getScheduledLeadMinutes, setScheduledLeadMinutes } from '../infrastructure/orderSettingsRepository'
import { ScheduledLeadSection } from './ScheduledLeadSection'

vi.mock('../infrastructure/orderSettingsRepository', () => ({
  getScheduledLeadMinutes: vi.fn(),
  setScheduledLeadMinutes: vi.fn(),
}))

const RANGE_MESSAGE = 'La anticipación debe estar entre 0 y 240 minutos.'

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(getScheduledLeadMinutes).mockResolvedValue(20)
  vi.mocked(setScheduledLeadMinutes).mockImplementation(async (minutes) => minutes)
})

async function renderLoaded() {
  render(<ScheduledLeadSection />)
  const input = await screen.findByLabelText('Minutos de anticipación')
  await screen.findByDisplayValue('20')
  return input
}

describe('ScheduledLeadSection', () => {
  it('loads the current lead minutes', async () => {
    await renderLoaded()

    expect(screen.getByRole('heading', { name: 'Pedidos programados' })).toBeInTheDocument()
    expect(screen.getByLabelText('Minutos de anticipación')).toHaveValue(20)
  })

  it('saves a new value and shows the status', async () => {
    const user = userEvent.setup()
    const input = await renderLoaded()

    await user.clear(input)
    await user.type(input, '45')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(setScheduledLeadMinutes).toHaveBeenCalledWith(45)
    expect(await screen.findByText('Anticipación guardada.')).toBeInTheDocument()
  })

  it('shows the server error in an alert and keeps the value', async () => {
    const user = userEvent.setup()
    vi.mocked(setScheduledLeadMinutes).mockRejectedValue(
      new Error('Solo un administrador puede cambiar la anticipación de los pedidos programados.'),
    )
    const input = await renderLoaded()

    await user.clear(input)
    await user.type(input, '30')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Solo un administrador puede cambiar la anticipación de los pedidos programados.',
    )
    expect(input).toHaveValue(30)
    expect(screen.queryByText('Anticipación guardada.')).not.toBeInTheDocument()
  })

  it.each(['', '241', '-1', '1.5'])('rejects %j on the client without calling the server', async (value) => {
    const user = userEvent.setup()
    const input = await renderLoaded()

    await user.clear(input)
    if (value) await user.type(input, value)
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(RANGE_MESSAGE)
    expect(setScheduledLeadMinutes).not.toHaveBeenCalled()
  })
})
