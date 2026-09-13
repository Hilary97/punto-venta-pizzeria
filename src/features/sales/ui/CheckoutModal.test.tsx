import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CheckoutModal } from './CheckoutModal'

describe('CheckoutModal', () => {
  it('shows the computed change once a sufficient amount is entered', async () => {
    const user = userEvent.setup()
    render(<CheckoutModal totalCents={15000} onConfirm={vi.fn()} onClose={vi.fn()} />)

    const receivedInput = screen.getByLabelText(/monto recibido/i)
    await user.type(receivedInput, '200')

    expect(screen.getByText('$50.00')).toBeInTheDocument()
  })

  it('disables the confirm button when the received amount is insufficient', async () => {
    const user = userEvent.setup()
    render(<CheckoutModal totalCents={15000} onConfirm={vi.fn()} onClose={vi.fn()} />)

    const receivedInput = screen.getByLabelText(/monto recibido/i)
    await user.type(receivedInput, '100')

    expect(screen.getByRole('button', { name: /confirmar/i })).toBeDisabled()
  })

  it('enables the confirm button and calls onConfirm with cents when the amount is sufficient', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(<CheckoutModal totalCents={15000} onConfirm={onConfirm} onClose={vi.fn()} />)

    const receivedInput = screen.getByLabelText(/monto recibido/i)
    await user.type(receivedInput, '200')

    const confirmButton = screen.getByRole('button', { name: /confirmar/i })
    expect(confirmButton).toBeEnabled()

    await user.click(confirmButton)
    expect(onConfirm).toHaveBeenCalledWith(20000)
  })
})
