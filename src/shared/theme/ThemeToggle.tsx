import { useState } from 'react'
import { applyTheme, currentTheme, saveTheme } from './theme'

/** Switches this device between light and dark mode and remembers the choice. */
export function ThemeToggle() {
  const [theme, setTheme] = useState(currentTheme)
  const next = theme === 'dark' ? 'light' : 'dark'
  const label = next === 'dark' ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro'

  function handleClick() {
    applyTheme(next)
    saveTheme(next)
    setTheme(next)
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={label}
      title={label}
      className="shrink-0 rounded-lg px-3 py-2 text-lg leading-none text-slate-600 hover:bg-slate-100"
    >
      <span aria-hidden="true">{theme === 'dark' ? '☀️' : '🌙'}</span>
    </button>
  )
}
