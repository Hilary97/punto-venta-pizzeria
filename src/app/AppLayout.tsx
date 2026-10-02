import type { ReactNode } from 'react'
import { Outlet } from 'react-router'
import { CashSessionProvider } from '../features/cash-register/ui/CashSessionContext'
import { Nav } from './Nav'

/** App chrome (nav + cash session); renders `children` when given, else the matched child route. */
export function AppLayout({ children }: { children?: ReactNode }) {
  return (
    <CashSessionProvider>
      <div className="flex min-h-dvh flex-col bg-slate-50">
        <Nav />
        <main className="flex-1">
          {children ?? <Outlet />}
        </main>
      </div>
    </CashSessionProvider>
  )
}
