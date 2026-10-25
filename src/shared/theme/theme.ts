export type Theme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'pizzeria.theme'

/** The theme chosen on this device; `null` when none was chosen (or the stored value is unknown). */
export function loadTheme(storage: Storage = localStorage): Theme | null {
  const value = storage.getItem(THEME_STORAGE_KEY)
  return value === 'light' || value === 'dark' ? value : null
}

export function saveTheme(theme: Theme, storage: Storage = localStorage): void {
  storage.setItem(THEME_STORAGE_KEY, theme)
}

/** The stored choice wins; without one, follow the system preference. */
export function initialTheme(stored: Theme | null, prefersDark: boolean): Theme {
  return stored ?? (prefersDark ? 'dark' : 'light')
}

/** Toggles the `dark` class (which swaps the palette in index.css) and the native color scheme. */
export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  root.classList.toggle('dark', theme === 'dark')
  root.style.colorScheme = theme
}

export function currentTheme(root: HTMLElement = document.documentElement): Theme {
  return root.classList.contains('dark') ? 'dark' : 'light'
}
