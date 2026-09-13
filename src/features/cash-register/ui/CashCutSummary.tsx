import type { ReactNode } from 'react'
import { MoneyText } from '../../../shared/ui/MoneyText'

interface CashCutSummaryProps {
  openingCents: number
  salesTotalCents: number
  returnsTotalCents: number
  expectedCents: number
  salesCount: number
  returnsCount: number
  countedCents: number | null
  differenceCents: number | null
  openedAt: string
  closedAt: string | null
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-200 py-2 last:border-0">
      <span className="text-slate-600">{label}</span>
      <span className="font-semibold text-slate-900">{value}</span>
    </div>
  )
}

export function CashCutSummary(props: CashCutSummaryProps) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 print:border-0 print:shadow-none">
      <h2 className="mb-4 text-center text-xl font-bold text-slate-900">Corte de caja</h2>
      <p className="mb-4 text-center text-sm text-slate-500">
        Abierta: {new Date(props.openedAt).toLocaleString('es-MX')}
        {props.closedAt && <> · Cerrada: {new Date(props.closedAt).toLocaleString('es-MX')}</>}
      </p>

      <Row label="Fondo inicial" value={<MoneyText cents={props.openingCents} />} />
      <Row label={`Ventas (${props.salesCount})`} value={<MoneyText cents={props.salesTotalCents} />} />
      <Row label={`Devoluciones (${props.returnsCount})`} value={<MoneyText cents={-props.returnsTotalCents} />} />
      <Row label="Efectivo esperado" value={<MoneyText cents={props.expectedCents} />} />
      {props.countedCents !== null && <Row label="Efectivo contado" value={<MoneyText cents={props.countedCents} />} />}
      {props.differenceCents !== null && (
        <Row
          label="Diferencia"
          value={
            <span className={props.differenceCents < 0 ? 'text-red-700' : 'text-emerald-700'}>
              <MoneyText cents={props.differenceCents} />
            </span>
          }
        />
      )}
    </div>
  )
}
