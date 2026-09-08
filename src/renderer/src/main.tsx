import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/theme.css'
import './styles/layout.css'

const container = document.getElementById('root')
if (!container) throw new Error('Không tìm thấy phần tử #root trong index.html')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
)
