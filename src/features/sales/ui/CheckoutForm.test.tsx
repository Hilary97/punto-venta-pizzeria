import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CheckoutForm } from './CheckoutForm'

function renderForm(onConfirm = vi.fn().mockResolvedValue(undefined)) {
  render(<CheckoutForm totalCents={10000} isEmpty={false} isSubmitting={false} onConfirm={onConfirm} />)
  return onConfirm
}

async function enableSplit(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('checkbox', { name: 'Dividir cuenta' }))
}

describe('CheckoutForm split bill', () => {
  it('registers the sale as before when the bill is not split', async () => {
    const user = userEvent.setup()
    const onConfirm = renderForm()
    await user.type(screen.getByLabelText('Monto recibido'), '100')
    await user.click(screen.getByRole('button', { name: 'Cobrar $100.00' }))
    expect(onConfirm).toHaveBeenCalledWith(10000)
  })

  it('shows each person share and lets the number of people be edited', async () => {
    const user = userEvent.setup()
    renderForm()
    await enableSplit(user)
    const people = screen.getByLabelText('Número de personas')
    expect(people).toHaveValue(2)
    expect(screen.getByRole('group', { name: 'Persona 1 · $50.00' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Persona 2 · $50.00' })).toBeInTheDocument()

    await user.clear(people)
    await user.type(people, '3')
    expect(screen.getByRole('group', { name: 'Persona 1 · $33.34' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Persona 2 · $33.33' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Persona 3 · $33.33' })).toBeInTheDocument()
  })

  it('shows the change for each person and only lets them be charged when the amount covers their share', async () => {
    const user = userEvent.setup()
    renderForm()
    await enableSplit(user)
    const received = screen.getByLabelText('Recibido de persona 1')
    const charge = screen.getByRole('button', { name: 'Cobrar persona 1' })
    expect(charge).toBeDisabled()

    await user.type(received, '40')
    expect(screen.getByText('Faltan $10.00.')).toBeInTheDocument()
    expect(charge).toBeDisabled()

    await user.clear(received)
    await user.type(received, '200')
    expect(screen.getByText('Cambio: $150.00')).toBeInTheDocument()
    await user.click(charge)
    expect(screen.getByText('Cobrada · Cambio: $150.00')).toBeInTheDocument()
    expect(received).toBeDisabled()
  })

  it('blocks the sale until every person is charged and registers the sum received', async () => {
    const user = userEvent.setup()
    const onConfirm = renderForm()
    await enableSplit(user)
    expect(screen.queryByLabelText('Monto recibido')).not.toBeInTheDocument()
    const submit = screen.getByRole('button', { name: 'Cobrar $100.00' })

    await user.type(screen.getByLabelText('Recibido de persona 1'), '100')
    await user.click(screen.getByRole('button', { name: 'Cobrar persona 1' }))
    expect(screen.getByText('Cobradas 1 de 2')).toBeInTheDocument()
    expect(submit).toBeDisabled()

    await user.type(screen.getByLabelText('Recibido de persona 2'), '50')
    await user.click(screen.getByRole('button', { name: 'Cobrar persona 2' }))
    expect(screen.getByText('Cobradas 2 de 2')).toBeInTheDocument()
    expect(submit).toBeEnabled()
    await user.click(submit)
    expect(onConfirm).toHaveBeenCalledWith(15000)
  })

  it('lets a charged person be undone', async () => {
    const user = userEvent.setup()
    renderForm()
    await enableSplit(user)
    await user.type(screen.getByLabelText('Recibido de persona 1'), '50')
    await user.click(screen.getByRole('button', { name: 'Cobrar persona 1' }))
    await user.click(screen.getByRole('button', { name: 'Deshacer persona 1' }))
    expect(screen.getByText('Cobradas 0 de 2')).toBeInTheDocument()
    expect(screen.getByLabelText('Recibido de persona 1')).toBeEnabled()
  })

  it('clears the charges when the number of people changes', async () => {
    const user = userEvent.setup()
    renderForm()
    await enableSplit(user)
    await user.type(screen.getByLabelText('Recibido de persona 1'), '50')
    await user.click(screen.getByRole('button', { name: 'Cobrar persona 1' }))
    const people = screen.getByLabelText('Número de personas')
    await user.clear(people)
    await user.type(people, '4')
    expect(screen.getByText('Cobradas 0 de 4')).toBeInTheDocument()
    expect(screen.getByLabelText('Recibido de persona 1')).toHaveValue('')
  })
})

describe('CheckoutForm cash keypad', () => {
  function received() {
    return screen.getByLabelText('Monto recibido')
  }

  it('types the received amount with the keypad digits and erases with ⌫ and Borrar todo', async () => {
    const user = userEvent.setup()
    renderForm()
    const keypad = screen.getByRole('group', { name: 'Teclado numérico' })
    await user.click(within(keypad).getByRole('button', { name: '5' }))
    await user.click(within(keypad).getByRole('button', { name: '0' }))
    await user.click(within(keypad).getByRole('button', { name: '0' }))
    expect(received()).toHaveValue('500')
    expect(screen.getByText('Cambio')).toBeInTheDocument()
    expect(screen.getByText('$400.00')).toBeInTheDocument()

    await user.click(within(keypad).getByRole('button', { name: 'Borrar último dígito' }))
    expect(received()).toHaveValue('50')
    await user.click(within(keypad).getByRole('button', { name: 'Borrar todo' }))
    expect(received()).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Cobrar $100.00' })).toBeDisabled()
  })

  it('fills the exact total and adds bills with the quick buttons', async () => {
    const user = userEvent.setup()
    const onConfirm = renderForm()
    const bills = screen.getByRole('group', { name: 'Billetes rápidos' })
    await user.click(within(bills).getByRole('button', { name: '+$50' }))
    await user.click(within(bills).getByRole('button', { name: '+$50' }))
    await user.click(within(bills).getByRole('button', { name: '+$200' }))
    expect(received()).toHaveValue('300')

    await user.click(within(bills).getByRole('button', { name: 'Exacto' }))
    expect(received()).toHaveValue('100')
    await user.click(screen.getByRole('button', { name: 'Cobrar $100.00' }))
    expect(onConfirm).toHaveBeenCalledWith(10000)
  })

  it('shows what is missing and keeps the charge disabled while the amount is short', async () => {
    const user = userEvent.setup()
    const onConfirm = renderForm()
    await user.type(received(), '40')
    expect(screen.getByText('Faltan')).toBeInTheDocument()
    expect(screen.getByText('$60.00')).toBeInTheDocument()
    const charge = screen.getByRole('button', { name: 'Cobrar $100.00' })
    expect(charge).toBeDisabled()
    await user.click(charge)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('hides the keypad and quick bills while the bill is split', async () => {
    const user = userEvent.setup()
    renderForm()
    await enableSplit(user)
    expect(screen.queryByRole('group', { name: 'Teclado numérico' })).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Billetes rápidos' })).not.toBeInTheDocument()
  })
})
