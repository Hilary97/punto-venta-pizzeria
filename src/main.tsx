import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { applyTheme, initialTheme, loadTheme } from './shared/theme/theme'

applyTheme(initialTheme(loadTheme(), window.matchMedia('(prefers-color-scheme: dark)').matches))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
