import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { VaultProvider } from './store/VaultContext'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <VaultProvider>
      <App />
    </VaultProvider>
  </StrictMode>,
)
