import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import '@fontsource/fraunces/400.css'
import '@fontsource/fraunces/500.css'
import '@fontsource/fraunces/400-italic.css'
import '@fontsource/fraunces/500-italic.css'
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import './index.css'
import { AuthProvider } from './auth/AuthContext.tsx'
import RequireAuth from './auth/RequireAuth.tsx'
import Login from './auth/Login.tsx'
import Layout from './Layout.tsx'
import App from './App.tsx'
import Transactions from './transactions/Transactions.tsx'
import Import from './import/Import.tsx'
import Categories from './categories/Categories.tsx'
import Rules from './rules/Rules.tsx'
import Bills from './bills/Bills.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Login/>}/>
          <Route element={<RequireAuth/>}>
            <Route element={<Layout/>}>
              <Route path="/dashboard" element={<App/>}/>
              <Route path="/transactions" element={<Transactions/>}/>
              <Route path="/import" element={<Import/>}/>
              <Route path="/categories" element={<Categories/>}/>
              <Route path="/rules" element={<Rules/>}/>
              <Route path="/bills" element={<Bills/>}/>
            </Route>
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
