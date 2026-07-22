/**
 * The single definition of the app's palette.
 *
 * Consumed from both sides so a colour is only ever changed here:
 *  - `tailwind.config.ts` builds the utility classes from it
 *  - the Three.js map scene reads it via `threeColor()`, since a WebGL clear
 *    colour can't be a CSS class
 *
 * Keeping it in one place is why the map void and the app shell can't drift
 * apart again.
 */

/**
 * `zinc` is redefined rather than aliased so the existing `zinc-*` classes
 * across the app pick the theme up directly — the scale keeps zinc's shape,
 * just cooler and a shade darker.
 */
export const ZINC = {
  50: '#f4f5f6',
  100: '#e6e8eb',
  200: '#d3d7dd',
  300: '#c7cbd1',
  400: '#a9aeb6',
  500: '#767c85',
  600: '#626770',
  700: '#2a2e35',
  800: '#23262c',
  900: '#14161b',
  950: '#0d0e11',
} as const

/**
 * Surfaces and accent triples used by the map-view chrome. Each accent has a
 * fg / bg / line set so an "active" control is one lookup.
 */
export const ATLAS = {
  /** Page background — also the map scene's clear colour. */
  bg: '#08090b',
  map: '#0d1210',
  bar: '#101215',
  row: '#0f1114',
  menu: '#14161b',
  input: '#16181d',
  hover: '#181b20',
  accent: '#34d399',
  'accent-bg': '#16241f',
  'accent-line': '#1e3a2f',
  amber: '#f5b544',
  'amber-bg': '#241f14',
  'amber-line': '#3a2f1e',
  cyan: '#4dd6e0',
  'cyan-bg': '#122224',
  'cyan-line': '#1c3a3d',
  danger: '#f26666',
} as const

/** `'#08090b'` → `0x08090b`, for Three.js colours. */
export function threeColor(hex: string): number {
  return parseInt(hex.replace('#', ''), 16)
}
