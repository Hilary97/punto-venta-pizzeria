import { BrowserRouter, Route, Routes } from 'react-router'
import { AppLayout } from './app/AppLayout'
import { HomeRoute } from './app/HomeRoute'
import { AuthProvider } from './features/auth/ui/AuthContext'
import { LoginPage } from './features/auth/ui/LoginPage'
import { RequireAuth } from './features/auth/ui/RequireAuth'
import { RequireRole } from './features/auth/ui/RequireRole'
import { CashCutPage } from './features/cash-register/ui/CashCutPage'
import { CashHistoryPage } from './features/cash-register/ui/CashHistoryPage'
import { OpenRegisterPage } from './features/cash-register/ui/OpenRegisterPage'
import { RequireOpenSession } from './features/cash-register/ui/RequireOpenSession'
import { AdminProductsPage } from './features/products/ui/AdminProductsPage'
import { ReturnsPage } from './features/returns/ui/ReturnsPage'

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            element={
              <RequireAuth>
                <AppLayout />
              </RequireAuth>
            }
          >
            <Route index element={<HomeRoute />} />
            <Route path="abrir-caja" element={<OpenRegisterPage />} />
            <Route
              path="devoluciones"
              element={
                <RequireOpenSession>
                  <ReturnsPage />
                </RequireOpenSession>
              }
            />
            <Route path="corte" element={<CashCutPage />} />
            <Route
              path="admin/productos"
              element={
                <RequireRole role="admin">
                  <AdminProductsPage />
                </RequireRole>
              }
            />
            <Route
              path="admin/historial"
              element={
                <RequireRole role="admin">
                  <CashHistoryPage />
                </RequireRole>
              }
            />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
