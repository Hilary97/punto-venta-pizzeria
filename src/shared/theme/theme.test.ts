import { beforeEach, describe, expect, it } from 'vitest'
import { applyTheme, initialTheme, loadTheme, saveTheme, THEME_STORAGE_KEY } from './theme'

describe('theme', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('remembers the chosen theme on this device', () => {
    expect(loadTheme()).toBeNull()
    saveTheme('dark')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
    expect(loadTheme()).toBe('dark')
    saveTheme('light')
    expect(loadTheme()).toBe('light')
  })

  it('ignores an unknown stored value', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'purple')
    expect(loadTheme()).toBeNull()
  })

  it('starts from the stored theme, else from the system preference', () => {
    expect(initialTheme('light', true)).toBe('light')
    expect(initialTheme('dark', false)).toBe('dark')
    expect(initialTheme(null, true)).toBe('dark')
    expect(initialTheme(null, false)).toBe('light')
  })

  it('applies the theme to the page root', () => {
    const root = document.createElement('html')
    applyTheme('dark', root)
    expect(root.classList.contains('dark')).toBe(true)
    expect(root.style.colorScheme).toBe('dark')
    applyTheme('light', root)
    expect(root.classList.contains('dark')).toBe(false)
    expect(root.style.colorScheme).toBe('light')
  })
})
