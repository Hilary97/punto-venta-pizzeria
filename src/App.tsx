import { BrowserRouter, Route, Routes } from 'react-router'
import { AppLayout } from './app/AppLayout'
import { HomeRoute } from './app/HomeRoute'
import { AuthProvider } from './features/auth/ui/AuthContext'
import { LoginPage } from './features/auth/ui/LoginPage'
import { RequireAuth } from './features/auth/ui/RequireAuth'
import { RequireRole } from './features/auth/ui/RequireRole'
import { CashCutPage } from './features/cash-register/ui/CashCutPage'
import { CashHistoryPage } from './features/cash-register/ui/CashHistoryPage'
import { CashSessionDetailPage } from './features/cash-register/ui/CashSessionDetailPage'
import { OpenRegisterPage } from './features/cash-register/ui/OpenRegisterPage'
import { RequireOpenSession } from './features/cash-register/ui/RequireOpenSession'
import { AdminProductsPage } from './features/products/ui/AdminProductsPage'
import { OrdersPage } from './features/orders/ui/OrdersPage'
import { AdminWaitersPage } from './features/waiters/ui/AdminWaitersPage'
import { ReturnsPage } from './features/returns/ui/ReturnsPage'
import type { UserRole } from './shared/supabase/database.types'

const CASH_ROLES: UserRole[] = ['admin', 'cashier']

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
            <Route path="pedidos" element={<OrdersPage />} />
            <Route
              index
              element={
                <RequireRole role={CASH_ROLES}>
                  <HomeRoute />
                </RequireRole>
              }
            />
            <Route
              path="abrir-caja"
              element={
                <RequireRole role={CASH_ROLES}>
                  <OpenRegisterPage />
                </RequireRole>
              }
            />
            <Route
              path="devoluciones"
              element={
                <RequireRole role={CASH_ROLES}>
                  <RequireOpenSession>
                    <ReturnsPage />
                  </RequireOpenSession>
                </RequireRole>
              }
            />
            <Route
              path="corte"
              element={
                <RequireRole role={CASH_ROLES}>
                  <CashCutPage />
                </RequireRole>
              }
            />
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
            <Route
              path="admin/meseros"
              element={
                <RequireRole role="admin">
                  <AdminWaitersPage />
                </RequireRole>
              }
            />
            <Route
              path="admin/historial/:sessionId"
              element={
                <RequireRole role="admin">
                  <CashSessionDetailPage />
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
