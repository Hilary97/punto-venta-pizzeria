import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { applyTheme, loadTheme } from './theme'
import { ThemeToggle } from './ThemeToggle'

describe('ThemeToggle', () => {
  beforeEach(() => {
    localStorage.clear()
    applyTheme('light')
  })

  it('switches between light and dark and remembers the choice', async () => {
    render(<ThemeToggle />)

    await userEvent.click(screen.getByRole('button', { name: 'Cambiar a modo oscuro' }))
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(loadTheme()).toBe('dark')

    await userEvent.click(screen.getByRole('button', { name: 'Cambiar a modo claro' }))
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(loadTheme()).toBe('light')
  })

  it('reflects the theme already applied to the page', () => {
    applyTheme('dark')
    render(<ThemeToggle />)
    expect(screen.getByRole('button', { name: 'Cambiar a modo claro' })).toBeVisible()
  })
})
