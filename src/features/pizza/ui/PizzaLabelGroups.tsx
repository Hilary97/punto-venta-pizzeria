import type { PizzaLabelLayout } from '../domain/pizza'

interface PizzaLabelGroupsProps extends Pick<PizzaLabelLayout, 'groups'> {
  /** Default ingredients by style name, shown subtly under a group of that style (a portion's `½ ` prefix is ignored). */
  styleDescriptions?: Record<string, string>
}

/** The styles or portions of a built pizza, each with its ingredients one per row; renders nothing for other lines. */
export function PizzaLabelGroups({ groups, styleDescriptions = {} }: PizzaLabelGroupsProps) {
  if (groups.length === 0) return null
  return (
    <ul className="mt-1 space-y-1 border-l-4 border-slate-300 pl-3">
      {groups.map((group, index) => {
        const description = styleDescriptions[group.name.replace(/^[½⅓¼] /, '')]
        return (
          <li key={index}>
            <span className="font-semibold">{group.name}</span>
            {description && (
              <span className="block text-[0.65em] leading-snug font-normal text-slate-500 italic dark:text-slate-400">
                {description}
              </span>
            )}
            {group.items.length > 0 && (
              <ul className="ml-6 list-disc font-medium">
                {group.items.map((item, itemIndex) => (
                  <li key={itemIndex}>{item}</li>
                ))}
              </ul>
            )}
          </li>
        )
      })}
    </ul>
  )
}
