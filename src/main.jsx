import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

import './styles/malbeek-theme.css'   // خط ثمانية + متغيّرات ألوان ملبّيك
import './styles/app.css'             // أنماط الشاشات واللوحات

import { AuthProvider } from './app/AuthProvider'
import App from './app/App'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
)
