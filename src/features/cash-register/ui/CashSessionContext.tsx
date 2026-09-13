import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { toUserMessage } from '../../../shared/errors'
import type { CashSession } from '../domain/cashSession'
import { getOpenSession } from '../infrastructure/cashRegisterRepository'

type CashSessionStatus = 'loading' | 'none' | 'open' | 'error'

interface CashSessionState {
  status: CashSessionStatus
  session: CashSession | null
  errorMessage: string | null
}

interface CashSessionContextValue {
  state: CashSessionState
  refresh: () => Promise<void>
}

const CashSessionContext = createContext<CashSessionContextValue | null>(null)

export function CashSessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CashSessionState>({ status: 'loading', session: null, errorMessage: null })

  const refresh = useCallback(async () => {
    setState((current) => ({ ...current, status: 'loading' }))
    try {
      const session = await getOpenSession()
      setState({ status: session ? 'open' : 'none', session, errorMessage: null })
    } catch (error) {
      setState({ status: 'error', session: null, errorMessage: toUserMessage(error) })
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return <CashSessionContext.Provider value={{ state, refresh }}>{children}</CashSessionContext.Provider>
}

export function useCashSession(): CashSessionContextValue {
  const context = useContext(CashSessionContext)
  if (!context) {
    throw new Error('useCashSession debe usarse dentro de <CashSessionProvider>.')
  }
  return context
}
