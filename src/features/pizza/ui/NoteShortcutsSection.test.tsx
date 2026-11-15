import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addNoteShortcut,
  deleteNoteShortcut,
  listAdminNoteShortcuts,
  moveNoteShortcut,
} from '../infrastructure/noteShortcutAdminRepository'
import { NoteShortcutsSection } from './NoteShortcutsSection'

vi.mock('../infrastructure/noteShortcutAdminRepository', () => ({
  listAdminNoteShortcuts: vi.fn(),
  addNoteShortcut: vi.fn(),
  deleteNoteShortcut: vi.fn(),
  moveNoteShortcut: vi.fn(),
}))

function rows() {
  return within(screen.getByRole('list', { name: /^Atajos de nota/ })).getAllByRole('listitem')
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(listAdminNoteShortcuts).mockResolvedValue([
    { id: 'a', label: 'Sin cebolla' },
    { id: 'b', label: 'Bien cocida' },
    { id: 'c', label: 'Poca sal' },
  ])
  vi.mocked(addNoteShortcut).mockResolvedValue(undefined)
  vi.mocked(deleteNoteShortcut).mockResolvedValue(undefined)
  vi.mocked(moveNoteShortcut).mockResolvedValue(undefined)
})

describe('NoteShortcutsSection', () => {
  it('lists the shortcuts in order under its heading', async () => {
    render(<NoteShortcutsSection scope="pizza" />)
    expect(await screen.findByRole('heading', { name: 'Atajos de notas de pizza' })).toBeVisible()
    await screen.findByRole('list', { name: 'Atajos de notas de pizza' })
    expect(rows().map((row) => within(row).getByTestId('note-shortcut-label').textContent)).toEqual([
      'Sin cebolla',
      'Bien cocida',
      'Poca sal',
    ])
  })

  it('shows an empty hint when there are none', async () => {
    vi.mocked(listAdminNoteShortcuts).mockResolvedValue([])
    render(<NoteShortcutsSection scope="pizza" />)
    expect(await screen.findByText('Todavía no agregaste ningún atajo: el mesero escribe las notas a mano.')).toBeVisible()
  })

  it('adds a typed label, clears the field and reloads', async () => {
    const user = userEvent.setup()
    render(<NoteShortcutsSection scope="pizza" />)
    await screen.findByRole('list', { name: 'Atajos de notas de pizza' })
    await user.type(screen.getByLabelText('Nuevo atajo'), 'Sin queso')
    await user.click(screen.getByRole('button', { name: 'Agregar atajo' }))
    expect(addNoteShortcut).toHaveBeenCalledWith('pizza', 'Sin queso')
    expect(listAdminNoteShortcuts).toHaveBeenCalledTimes(2)
    expect(screen.getByLabelText('Nuevo atajo')).toHaveValue('')
  })

  it('shows the server message and keeps the typed text when adding fails', async () => {
    vi.mocked(addNoteShortcut).mockRejectedValue(new Error('Ese atajo ya existe.'))
    const user = userEvent.setup()
    render(<NoteShortcutsSection scope="pizza" />)
    await screen.findByRole('list', { name: 'Atajos de notas de pizza' })
    await user.type(screen.getByLabelText('Nuevo atajo'), 'Poca sal')
    await user.click(screen.getByRole('button', { name: 'Agregar atajo' }))
    expect(await screen.findByText('Ese atajo ya existe.')).toBeVisible()
    expect(screen.getByLabelText('Nuevo atajo')).toHaveValue('Poca sal')
  })

  it('limits the field to 40 characters and disables Agregar atajo while it is blank', async () => {
    const user = userEvent.setup()
    render(<NoteShortcutsSection scope="pizza" />)
    await screen.findByRole('list', { name: 'Atajos de notas de pizza' })
    expect(screen.getByLabelText('Nuevo atajo')).toHaveAttribute('maxlength', '40')
    expect(screen.getByRole('button', { name: 'Agregar atajo' })).toBeDisabled()
    await user.type(screen.getByLabelText('Nuevo atajo'), '   ')
    expect(screen.getByRole('button', { name: 'Agregar atajo' })).toBeDisabled()
  })

  it('moves and removes', async () => {
    const user = userEvent.setup()
    render(<NoteShortcutsSection scope="pizza" />)
    await screen.findByRole('list', { name: 'Atajos de notas de pizza' })
    expect(within(rows()[0]!).getByRole('button', { name: 'Subir' })).toBeDisabled()
    expect(within(rows()[2]!).getByRole('button', { name: 'Bajar' })).toBeDisabled()
    await user.click(within(rows()[2]!).getByRole('button', { name: 'Subir' }))
    expect(moveNoteShortcut).toHaveBeenCalledWith('c', -1)
    await user.click(within(rows()[0]!).getByRole('button', { name: 'Bajar' }))
    expect(moveNoteShortcut).toHaveBeenLastCalledWith('a', 1)
    await user.click(within(rows()[1]!).getByRole('button', { name: 'Quitar' }))
    expect(deleteNoteShortcut).toHaveBeenCalledWith('b')
    expect(listAdminNoteShortcuts).toHaveBeenCalledTimes(4)
  })

  it('shows the error when loading fails', async () => {
    vi.mocked(listAdminNoteShortcuts).mockRejectedValue(new Error('No se pudieron cargar los atajos de notas.'))
    render(<NoteShortcutsSection scope="pizza" />)
    expect(await screen.findByText('No se pudieron cargar los atajos de notas.')).toBeVisible()
  })

  it('asks the repository for its own scope', async () => {
    render(<NoteShortcutsSection scope="pizza" />)
    await screen.findByRole('list', { name: 'Atajos de notas de pizza' })
    expect(listAdminNoteShortcuts).toHaveBeenCalledWith('pizza')
  })

  it('order scope: own heading, list, hint and calls', async () => {
    vi.mocked(listAdminNoteShortcuts).mockResolvedValue([
      { id: 'o1', label: 'Pagan con $500' },
      { id: 'o2', label: 'Cubiertos' },
    ])
    const user = userEvent.setup()
    render(<NoteShortcutsSection scope="order" />)
    expect(await screen.findByRole('heading', { name: 'Atajos de nota del pedido' })).toBeVisible()
    await screen.findByRole('list', { name: 'Atajos de nota del pedido' })
    expect(listAdminNoteShortcuts).toHaveBeenCalledWith('order')
    expect(screen.getByText(/Nota del pedido/)).toBeVisible()
    await user.type(screen.getByLabelText('Nuevo atajo'), 'Entregar rápido')
    await user.click(screen.getByRole('button', { name: 'Agregar atajo' }))
    expect(addNoteShortcut).toHaveBeenCalledWith('order', 'Entregar rápido')
    await user.click(within(rows()[1]!).getByRole('button', { name: 'Subir' }))
    expect(moveNoteShortcut).toHaveBeenCalledWith('o2', -1)
    await user.click(within(rows()[0]!).getByRole('button', { name: 'Quitar' }))
    expect(deleteNoteShortcut).toHaveBeenCalledWith('o1')
  })

  it('order scope: empty hint', async () => {
    vi.mocked(listAdminNoteShortcuts).mockResolvedValue([])
    render(<NoteShortcutsSection scope="order" />)
    expect(await screen.findByText('Todavía no agregaste ningún atajo: el mesero escribe la nota del pedido a mano.')).toBeVisible()
  })
})
