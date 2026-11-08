import { useState } from 'react'
import type { PizzaLabelLayout } from '../domain/pizza'

interface PizzaLabelGroupsProps extends Pick<PizzaLabelLayout, 'groups'> {
  /**
   * Default ingredients by style name (a portion's `½ ` prefix is ignored). Hidden at first: tapping the
   * style name shows them subtly under it, tapping again hides them.
   */
  styleDescriptions?: Record<string, string>
}

/** The styles or portions of a built pizza, each with its ingredients one per row; renders nothing for other lines. */
export function PizzaLabelGroups({ groups, styleDescriptions = {} }: PizzaLabelGroupsProps) {
  const [shown, setShown] = useState<ReadonlySet<number>>(new Set())
  if (groups.length === 0) return null

  function toggle(index: number) {
    setShown((current) => {
      const next = new Set(current)
      if (!next.delete(index)) next.add(index)
      return next
    })
  }

  return (
    <ul className="mt-1 space-y-1 border-l-4 border-slate-300 pl-3">
      {groups.map((group, index) => {
        const description = styleDescriptions[group.name.replace(/^[½⅓¼] /, '')]
        const open = shown.has(index)
        return (
          <li key={index}>
            {description ? (
              <button
                type="button"
                aria-expanded={open}
                onClick={() => toggle(index)}
                className="cursor-pointer text-left font-semibold underline decoration-slate-300 decoration-dotted underline-offset-4"
              >
                {group.name}
              </button>
            ) : (
              <span className="font-semibold">{group.name}</span>
            )}
            {description && open && (
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
