import { z } from 'zod'
import { getSupabaseClient } from '../../../shared/supabase/client'
import { parseRpcResult } from '../../../shared/supabase/rpc'
import type { CashSession } from '../domain/cashSession'

function mapRow(row: {
  id: string
  opened_by: string
  opened_at: string
  opening_cents: number
  closed_by: string | null
  closed_at: string | null
  counted_cents: number | null
  expected_cents: number | null
  difference_cents: number | null
}): CashSession {
  return {
    id: row.id,
    openedBy: row.opened_by,
    openedAt: row.opened_at,
    openingCents: row.opening_cents,
    closedBy: row.closed_by,
    closedAt: row.closed_at,
    countedCents: row.counted_cents,
    expectedCents: row.expected_cents,
    differenceCents: row.difference_cents,
  }
}

/** Returns the currently open cash session for the shared register, or null if none is open. */
export async function getOpenSession(): Promise<CashSession | null> {
  const { data, error } = await getSupabaseClient()
    .from('cash_sessions')
    .select('*')
    .is('closed_at', null)
    .maybeSingle()

  if (error) throw new Error('No se pudo verificar el estado de la caja.')
  if (!data) return null
  return mapRow(data)
}

const openSessionResultSchema = z.object({
  session_id: z.string(),
})

export async function openCashSession(openingCents: number): Promise<void> {
  const { data, error } = await getSupabaseClient().rpc('open_cash_session', {
    p_opening_cents: openingCents,
  })
  parseRpcResult(openSessionResultSchema, data, error, 'No se pudo abrir la caja.')
}

const cashSummaryResultSchema = z.object({
  opening_cents: z.number().int(),
  sales_total_cents: z.number().int(),
  returns_total_cents: z.number().int(),
  expected_cents: z.number().int(),
  sales_count: z.number().int(),
  returns_count: z.number().int(),
})

export interface CashSummaryReport {
  openingCents: number
  salesTotalCents: number
  returnsTotalCents: number
  expectedCents: number
  salesCount: number
  returnsCount: number
}

export async function getCashSummary(sessionId: string): Promise<CashSummaryReport> {
  const { data, error } = await getSupabaseClient().rpc('get_cash_summary', {
    p_session_id: sessionId,
  })
  const result = parseRpcResult(cashSummaryResultSchema, data, error, 'No se pudo calcular el resumen de caja.')

  return {
    openingCents: result.opening_cents,
    salesTotalCents: result.sales_total_cents,
    returnsTotalCents: result.returns_total_cents,
    expectedCents: result.expected_cents,
    salesCount: result.sales_count,
    returnsCount: result.returns_count,
  }
}

const closeSessionResultSchema = z.object({
  expected_cents: z.number().int(),
  counted_cents: z.number().int(),
  difference_cents: z.number().int(),
})

export interface CloseSessionResult {
  expectedCents: number
  countedCents: number
  differenceCents: number
}

export async function closeCashSession(countedCents: number): Promise<CloseSessionResult> {
  const { data, error } = await getSupabaseClient().rpc('close_cash_session', {
    p_counted_cents: countedCents,
  })
  const result = parseRpcResult(closeSessionResultSchema, data, error, 'No se pudo cerrar la caja.')

  return {
    expectedCents: result.expected_cents,
    countedCents: result.counted_cents,
    differenceCents: result.difference_cents,
  }
}

const deletionResultSchema = z.object({
  deleted_session_id: z.string().uuid(),
})

/** Permanently deletes one closed session; authorization is enforced by the RPC. */
export async function deleteClosedCashSession(sessionId: string): Promise<string> {
  const { data, error } = await getSupabaseClient().rpc('delete_closed_cash_session', {
    p_session_id: sessionId,
  })
  const result = parseRpcResult(deletionResultSchema, data, error, 'No se pudo eliminar el corte.')
  if (result.deleted_session_id !== sessionId) {
    throw new Error('La respuesta no corresponde al corte seleccionado.')
  }
  return result.deleted_session_id
}

/** Admin-only: past (closed) cash sessions, most recent first. */
export async function listPastSessions(): Promise<CashSession[]> {
  const { data, error } = await getSupabaseClient()
    .from('cash_sessions')
    .select('*')
    .not('closed_at', 'is', null)
    .order('closed_at', { ascending: false })

  if (error) throw new Error('No se pudo cargar el historial de cortes.')
  return data.map(mapRow)
}

/** Admin-only: a single closed cash session by id. */
export async function getClosedSessionById(sessionId: string): Promise<CashSession> {
  const { data, error } = await getSupabaseClient()
    .from('cash_sessions')
    .select('*')
    .eq('id', sessionId)
    .not('closed_at', 'is', null)
    .single()

  if (error || !data) throw new Error('No se pudo cargar el corte seleccionado.')
  return mapRow(data)
}
