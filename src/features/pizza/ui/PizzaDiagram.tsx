interface PizzaDiagramProps {
  /** Number of portions the pizza is split into (1 to 4). */
  count: number
  /** Portion highlighted as the one being edited. */
  index: number
  /** Accessible description, e.g. `Pizza en mitades; Mitad 1 seleccionada`. */
  label: string
}

const CENTER = 32
const RADIUS = 29

function point(degrees: number): string {
  const radians = (degrees * Math.PI) / 180
  return `${(CENTER + RADIUS * Math.cos(radians)).toFixed(2)} ${(CENTER + RADIUS * Math.sin(radians)).toFixed(2)}`
}

/** Small round diagram of the pizza with the portion being edited filled in. */
export function PizzaDiagram({ count, index, label }: PizzaDiagramProps) {
  const sweep = 360 / count
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" role="img" aria-label={label} className="shrink-0">
      <circle cx={CENTER} cy={CENTER} r={RADIUS} className="fill-white stroke-red-800 dark:fill-slate-900 dark:stroke-red-400" strokeWidth={3} />
      {count === 1 ? (
        <circle cx={CENTER} cy={CENTER} r={RADIUS} className="fill-red-700 stroke-red-800 dark:stroke-red-400" strokeWidth={3} />
      ) : (
        <>
          <path
            d={`M${CENTER} ${CENTER} L${point(-90 + index * sweep)} A${RADIUS} ${RADIUS} 0 0 1 ${point(-90 + (index + 1) * sweep)} Z`}
            className="fill-red-700"
          />
          {Array.from({ length: count }, (_, i) => (
            <line
              key={i}
              x1={CENTER}
              y1={CENTER}
              x2={point(-90 + i * sweep).split(' ')[0]}
              y2={point(-90 + i * sweep).split(' ')[1]}
              className="stroke-red-800 dark:stroke-red-400"
              strokeWidth={3}
            />
          ))}
        </>
      )}
    </svg>
  )
}
