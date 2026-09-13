import { Outlet } from 'react-router'
import { CashSessionProvider } from '../features/cash-register/ui/CashSessionContext'
import { Nav } from './Nav'

export function AppLayout() {
  return (
    <CashSessionProvider>
      <div className="flex min-h-dvh flex-col bg-slate-50">
        <Nav />
        <main className="flex-1">
          <Outlet />
        </main>
      </div>
    </CashSessionProvider>
  )
}
