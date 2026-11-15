import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { NoteShortcutChips } from './NoteShortcutChips'

function renderChips(note = '', onChange = vi.fn()) {
  render(<NoteShortcutChips label="nota del pedido" shortcuts={['Cubiertos', 'Sin sal']} note={note} maxLength={20} onChange={onChange} />)
  return onChange
}

describe('NoteShortcutChips', () => {
  it('names the group and keeps aria-pressed', () => {
    renderChips('Cubiertos')
    expect(screen.getByRole('group', { name: 'Atajos de nota del pedido' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Cubiertos' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Sin sal' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('renders nothing without shortcuts', () => {
    render(<NoteShortcutChips label="x" shortcuts={[]} note="" maxLength={20} onChange={vi.fn()} />)
    expect(screen.queryByRole('group')).not.toBeInTheDocument()
  })

  it('is a small outline chip when idle: 32px, thin slate border, transparent, slate text', () => {
    renderChips()
    const chip = screen.getByRole('button', { name: 'Cubiertos' })
    for (const cls of ['min-h-8', 'rounded-full', 'border', 'border-slate-300', 'bg-transparent', 'text-slate-700', 'font-medium']) {
      expect(chip).toHaveClass(cls)
    }
    for (const cls of ['min-h-11', 'bg-slate-200', 'bg-red-700', 'px-4', 'font-semibold']) expect(chip).not.toHaveClass(cls)
  })

  it('relies on the dark-mode slate inversion: no dark: slate overrides that would dim the text', () => {
    renderChips()
    const chip = screen.getByRole('button', { name: 'Cubiertos' })
    expect(chip.className).not.toMatch(/dark:[a-z:-]*slate/)
  })

  it('turns soft amber when pressed, with dark variants, never the big red chip', () => {
    renderChips('Cubiertos')
    const chip = screen.getByRole('button', { name: 'Cubiertos' })
    for (const cls of ['bg-amber-50', 'border-amber-300', 'text-amber-900', 'dark:bg-amber-950/60', 'dark:border-amber-700', 'dark:text-amber-100']) {
      expect(chip).toHaveClass(cls)
    }
    for (const cls of ['bg-red-700', 'text-white', 'bg-transparent', 'border-slate-300']) expect(chip).not.toHaveClass(cls)
  })

  it('dims a disabled chip and does not call onChange', async () => {
    const onChange = renderChips('x'.repeat(15))
    const chip = screen.getByRole('button', { name: 'Cubiertos' })
    expect(chip).toBeDisabled()
    expect(chip).toHaveClass('disabled:opacity-40')
    await userEvent.setup().click(chip)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('appends on tap and removes on a second tap', async () => {
    const user = userEvent.setup()
    const onChange = renderChips('Hola')
    await user.click(screen.getByRole('button', { name: 'Sin sal' }))
    expect(onChange).toHaveBeenCalledWith('Hola, Sin sal')
  })
})
