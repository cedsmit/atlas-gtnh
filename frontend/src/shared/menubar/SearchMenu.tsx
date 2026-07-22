import { Gem, Puzzle, Search, Trees, type LucideIcon } from 'lucide-react'

import { Dropdown, Item, MenuButton } from './primitives'
import { type MenuProps } from './types'

/**
 * The searches offered, in menu order. Ids match App's PanelId, so a new search
 * is one entry here plus its panel — nothing in this component's body changes.
 */
const SEARCH_DEFS = [
  {
    id: 'search',
    label: 'Blocks',
    Icon: Search,
    desc: 'Find where a block occurs, by name or id',
  },
  {
    id: 'lootGames',
    label: 'LootGames dungeons',
    Icon: Puzzle,
    desc: 'Locate LootGames dungeons across the dimension',
  },
  {
    id: 'biomeSearch',
    label: 'Biomes',
    Icon: Trees,
    desc: 'Find a biome and highlight where it covers',
  },
  {
    id: 'oreVeinSearch',
    label: 'Ore veins',
    Icon: Gem,
    desc: 'Find Visual Prospecting veins, grouped by ore and sorted by distance from home',
  },
] as const satisfies readonly {
  id: string
  label: string
  Icon: LucideIcon
  desc: string
}[]

export type SearchId = (typeof SEARCH_DEFS)[number]['id']

/** Live state for one search entry. Absent from the record = not offered. */
export interface SearchEntry {
  open?: boolean
  onSelect: () => void
}

interface Props extends MenuProps {
  entries: Partial<Record<SearchId, SearchEntry>>
}

export function SearchMenu({
  open: isOpen,
  onToggle,
  onClose,
  entries,
}: Props) {
  const offered = SEARCH_DEFS.filter((d) => entries[d.id])
  const anyOpen = offered.some((d) => entries[d.id]?.open)

  return (
    <div className="relative">
      <MenuButton
        open={isOpen}
        onClick={onToggle}
        icon={<Search />}
        caret
        active={anyOpen}
        title="Search the world — blocks, LootGames, biomes, ore veins"
      >
        Search
      </MenuButton>

      {isOpen && (
        <Dropdown className="left-0 w-[228px]">
          {offered.map(({ id, label, Icon, desc }) => {
            const entry = entries[id]
            if (!entry) return null
            return (
              <Item
                key={id}
                onClick={() => {
                  // Picking an entry opens a panel, so the menu gets out of the way.
                  onClose()
                  entry.onSelect()
                }}
                icon={<Icon />}
                check={entry.open}
                title={desc}
              >
                {label}
              </Item>
            )
          })}
        </Dropdown>
      )}
    </div>
  )
}
