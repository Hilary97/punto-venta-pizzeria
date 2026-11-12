import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Sheet } from './Sheet'

function Harness({ onClose = () => {} }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)}>Abrir</button>
      {open && (
        <Sheet
          title="Elegir mesa"
          description="Toca una mesa."
          onClose={() => {
            onClose()
            setOpen(false)
          }}
          footer={<button>Listo</button>}
        >
          <button>Primera</button>
          <button>Última</button>
        </Sheet>
      )}
    </>
  )
}

describe('Sheet', () => {
  it('is a modal dialog named by its title and described by its description', () => {
    render(
      <Sheet title="Elegir mesa" description="Toca una mesa." onClose={() => {}}>
        contenido
      </Sheet>,
    )
    const dialog = screen.getByRole('dialog', { name: 'Elegir mesa' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleDescription('Toca una mesa.')
    expect(dialog).toHaveTextContent('contenido')
  })

  it('closes with the Cerrar button, which is at least 44px tall', async () => {
    const onClose = vi.fn()
    render(
      <Sheet title="T" onClose={onClose}>
        x
      </Sheet>,
    )
    const close = screen.getByRole('button', { name: 'Cerrar' })
    expect(close).toHaveClass('min-h-11')
    await userEvent.click(close)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes with Escape and returns focus to the control that opened it', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    const opener = screen.getByRole('button', { name: 'Abrir' })
    await user.click(opener)
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement)

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })

  it('closes when the dimmed backdrop is pressed', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Abrir' }))
    await user.click(screen.getByTestId('sheet-backdrop'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('keeps Tab focus inside the dialog, footer included', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Abrir' }))
    const dialog = screen.getByRole('dialog')
    for (let i = 0; i < 8; i++) {
      await user.tab()
      expect(dialog).toContainElement(document.activeElement as HTMLElement)
    }
    await user.tab({ shift: true })
    expect(dialog).toContainElement(document.activeElement as HTMLElement)
    expect(screen.getByRole('button', { name: 'Listo' })).toBeInTheDocument()
  })
})
