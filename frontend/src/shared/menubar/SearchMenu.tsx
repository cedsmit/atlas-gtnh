import { Gem, Puzzle, Search, Trees } from 'lucide-react'

import { Dropdown, Item, MenuButton } from './primitives'
import { type MenuProps } from './types'

interface Props extends MenuProps {
  searchOpen?: boolean
  onToggleSearch?: () => void
  lootGamesOpen?: boolean
  onToggleLootGames?: () => void
  biomeSearchOpen?: boolean
  onToggleBiomeSearch?: () => void
  oreVeinSearchOpen?: boolean
  onToggleOreVeinSearch?: () => void
}

export function SearchMenu({
  open: isOpen,
  onToggle,
  onClose,
  searchOpen,
  onToggleSearch,
  lootGamesOpen,
  onToggleLootGames,
  biomeSearchOpen,
  onToggleBiomeSearch,
  oreVeinSearchOpen,
  onToggleOreVeinSearch,
}: Props) {
  // Picking an entry opens a panel, so the menu gets out of the way.
  const pick = (fn: () => void) => () => {
    onClose()
    fn()
  }

  return (
    <div className="relative">
      <MenuButton
        open={isOpen}
        onClick={onToggle}
        icon={<Search />}
        caret
        primary={
          searchOpen || lootGamesOpen || biomeSearchOpen || oreVeinSearchOpen
        }
        title="Search the world — blocks, LootGames, biomes, ore veins"
      >
        Search
      </MenuButton>

      {isOpen && (
        <Dropdown className="left-0 w-[228px]">
          {onToggleSearch && (
            <Item
              onClick={pick(onToggleSearch)}
              icon={<Search />}
              check={searchOpen}
            >
              Blocks
            </Item>
          )}
          {onToggleLootGames && (
            <Item
              onClick={pick(onToggleLootGames)}
              icon={<Puzzle />}
              check={lootGamesOpen}
            >
              LootGames dungeons
            </Item>
          )}
          {onToggleBiomeSearch && (
            <Item
              onClick={pick(onToggleBiomeSearch)}
              icon={<Trees />}
              check={biomeSearchOpen}
            >
              Biomes
            </Item>
          )}
          {onToggleOreVeinSearch && (
            <Item
              onClick={pick(onToggleOreVeinSearch)}
              icon={<Gem />}
              check={oreVeinSearchOpen}
            >
              Ore veins
            </Item>
          )}
        </Dropdown>
      )}
    </div>
  )
}
