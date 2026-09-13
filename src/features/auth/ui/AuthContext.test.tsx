import { StrictMode } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { AuthProvider, useAuth } from './AuthContext'

const mocks = vi.hoisted(() => ({ getSession: vi.fn(), subscribe: vi.fn(), profile: vi.fn() }))
vi.mock('../../../shared/supabase/client', () => ({
  isSupabaseConfigured: true,
  getSupabaseClient: () => ({ auth: { getSession: mocks.getSession, onAuthStateChange: mocks.subscribe } }),
}))
vi.mock('../infrastructure/authRepository', () => ({ fetchOwnProfile: mocks.profile }))
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const session = (id: string) => ({ user: { id } })
const profile = (id: string) => ({ id, fullName: id, role: 'admin' })
let notify: (event: string, value: ReturnType<typeof session> | null) => void
function State() {
  const auth = useAuth()
  return <div>{auth.status}:{auth.profile?.id}:{auth.errorMessage}</div>
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.getSession.mockResolvedValue({ data: { session: null } })
  mocks.subscribe.mockImplementation((callback) => {
    notify = callback
    return { data: { subscription: { unsubscribe: vi.fn() } } }
  })
})
it.each(['success', 'failure'])('ignores stale profile %s after sign-out', async (outcome) => {
  const pending = deferred<ReturnType<typeof profile>>()
  mocks.profile.mockReturnValue(pending.promise)
  render(<AuthProvider><State /></AuthProvider>)
  await screen.findByText('signed-out::')
  act(() => notify('SIGNED_IN', session('old')))
  await waitFor(() => expect(mocks.profile).toHaveBeenCalled())
  act(() => notify('SIGNED_OUT', null))
  await act(async () => {
    if (outcome === 'success') pending.resolve(profile('old'))
    else pending.reject(new Error('stale failure'))
  })
  expect(screen.getByText('signed-out::')).toBeInTheDocument()
})
it('ignores initial session results after an auth event', async () => {
  const initial = deferred<{ data: { session: ReturnType<typeof session> } }>()
  mocks.getSession.mockReturnValue(initial.promise)
  mocks.profile.mockResolvedValue(profile('old'))
  render(<AuthProvider><State /></AuthProvider>)
  act(() => notify('SIGNED_OUT', null))
  await act(async () => initial.resolve({ data: { session: session('old') } }))
  expect(screen.getByText('signed-out::')).toBeInTheDocument()
  expect(mocks.profile).not.toHaveBeenCalled()
})
it.each(['success', 'failure'])('keeps a newer profile after stale %s', async (outcome) => {
  const old = deferred<ReturnType<typeof profile>>()
  mocks.profile.mockReturnValueOnce(old.promise).mockResolvedValueOnce(profile('new'))
  render(<AuthProvider><State /></AuthProvider>)
  await screen.findByText('signed-out::')
  act(() => notify('SIGNED_IN', session('old')))
  await waitFor(() => expect(mocks.profile).toHaveBeenCalledTimes(1))
  act(() => notify('SIGNED_IN', session('new')))
  await screen.findByText('signed-in:new:')
  await act(async () => {
    if (outcome === 'success') old.resolve(profile('old'))
    else old.reject(new Error('stale failure'))
  })
  expect(screen.getByText('signed-in:new:')).toBeInTheDocument()
})
it.each([true, false])('handles initial session rejection, stale=%s', async (stale) => {
  const initial = deferred<never>()
  mocks.getSession.mockReturnValue(initial.promise)
  render(<AuthProvider><State /></AuthProvider>)
  if (stale) act(() => notify('SIGNED_OUT', null))
  await act(async () => initial.reject(new Error('session failure')))
  expect(screen.getByText(stale ? 'signed-out::' : 'error::session failure')).toBeInTheDocument()
})
it('shows current returned session errors and current profile failures', async () => {
  mocks.getSession.mockResolvedValue({ data: { session: null }, error: new Error('session error') })
  mocks.profile.mockRejectedValue(new Error('profile error'))
  render(<AuthProvider><State /></AuthProvider>)
  await screen.findByText('error::session error')
  act(() => notify('SIGNED_IN', session('new')))
  await screen.findByText('error::profile error')
})
it('cancels scheduled profile work on sign-out and unmount', async () => {
  const view = render(<AuthProvider><State /></AuthProvider>)
  await screen.findByText('signed-out::')
  act(() => {
    notify('SIGNED_IN', session('old'))
    notify('SIGNED_OUT', null)
  })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
  expect(mocks.profile).not.toHaveBeenCalled()
  act(() => notify('SIGNED_IN', session('new')))
  view.unmount()
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
  expect(mocks.profile).not.toHaveBeenCalled()
})
it('defers SDK profile work outside the auth callback', async () => {
  mocks.profile.mockResolvedValue(profile('new'))
  render(<AuthProvider><State /></AuthProvider>)
  await screen.findByText('signed-out::')
  act(() => {
    notify('SIGNED_IN', session('new'))
    expect(mocks.profile).not.toHaveBeenCalled()
  })
  await screen.findByText('signed-in:new:')
})
it('isolates StrictMode effect lifetimes and unsubscribes on unmount', async () => {
  const initial = deferred<{ data: { session: ReturnType<typeof session> } }>()
  mocks.getSession.mockReturnValueOnce(initial.promise)
  const view = render(<StrictMode><AuthProvider><State /></AuthProvider></StrictMode>)
  await screen.findByText('signed-out::')
  await act(async () => initial.resolve({ data: { session: session('old') } }))
  expect(mocks.profile).not.toHaveBeenCalled()
  view.unmount()
  for (const result of mocks.subscribe.mock.results) {
    expect(result.value.data.subscription.unsubscribe).toHaveBeenCalledTimes(1)
  }
})
