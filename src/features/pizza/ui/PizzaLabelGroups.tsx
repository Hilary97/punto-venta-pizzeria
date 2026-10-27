import type { PizzaLabelLayout } from '../domain/pizza'

/** The styles or portions of a built pizza, each with its ingredients one per row; renders nothing for other lines. */
export function PizzaLabelGroups({ groups }: Pick<PizzaLabelLayout, 'groups'>) {
  if (groups.length === 0) return null
  return (
    <ul className="mt-1 space-y-1 border-l-4 border-slate-300 pl-3">
      {groups.map((group, index) => (
        <li key={index}>
          <span className="font-semibold">{group.name}</span>
          {group.items.length > 0 && (
            <ul className="ml-6 list-disc font-medium">
              {group.items.map((item, itemIndex) => (
                <li key={itemIndex}>{item}</li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  )
}
