import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { VariantPickerModal } from './VariantPickerModal'

describe('VariantPickerModal', () => {
  it('lists one button per variant and reports the picked one', async () => {
    const onPick = vi.fn()
    render(<VariantPickerModal productName="Hamburguesa" variants={['Res', 'Pollo']} onPick={onPick} onClose={vi.fn()} />)
    expect(screen.getByRole('dialog', { name: 'Hamburguesa' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Pollo' }))
    expect(onPick).toHaveBeenCalledWith('Pollo')
    expect(screen.getByRole('button', { name: 'Res' })).toBeInTheDocument()
  })

  it('shows up to 8 variants in one column and more in two', () => {
    const variants = (length: number) => Array.from({ length }, (_, i) => `V${i}`)
    const { unmount } = render(
      <VariantPickerModal productName="Alitas" variants={variants(8)} onPick={vi.fn()} onClose={vi.fn()} />,
    )
    expect(screen.getByRole('button', { name: 'V0' }).parentElement).not.toHaveClass('grid-cols-2')
    unmount()

    render(<VariantPickerModal productName="Alitas" variants={variants(16)} onPick={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getAllByRole('button', { name: /^V\d+$/ })).toHaveLength(16)
    expect(screen.getByRole('button', { name: 'V0' }).parentElement).toHaveClass('grid-cols-2')
  })

  it('closes from the cancel button', async () => {
    const onClose = vi.fn()
    render(<VariantPickerModal productName="Hamburguesa" variants={['Res']} onPick={vi.fn()} onClose={onClose} />)
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onClose).toHaveBeenCalled()
  })
})
