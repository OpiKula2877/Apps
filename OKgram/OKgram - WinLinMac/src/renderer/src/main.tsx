import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { api } from './api'
import { App } from './App'
import './styles.css'

window.addEventListener('error', (event) => api.log(`${event.message} @ ${event.filename}:${event.lineno}`))
window.addEventListener('unhandledrejection', (event) => api.log(`unhandled: ${String((event.reason as Error)?.stack ?? event.reason)}`))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
