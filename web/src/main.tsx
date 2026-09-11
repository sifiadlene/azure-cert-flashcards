import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/ibm-plex-sans/700.css'
import '@fontsource/ibm-plex-mono/500.css'
import './index.css'
import './i18n/config'
import App from './App.tsx'
import { loadRuntimeConfig } from './runtimeConfig.ts'

async function start() {
  try {
    await loadRuntimeConfig()
  } catch (error) {
    console.error(error)
    const root = document.getElementById('root')!
    root.setAttribute('role', 'alert')
    root.textContent = 'The application configuration could not be loaded. Try again later.'
    return
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void start()
