import type { Config } from 'tailwindcss'

import { ATLAS, ZINC } from './src/shared/theme'

// Colours live in src/shared/theme.ts, not here: the Three.js map scene needs
// the same values for its clear colour and cannot read a utility class, so a
// copy in this file would silently drift from the map.
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        zinc: ZINC,
        atlas: ATLAS,
      },
      keyframes: {
        slide: {
          '0%': { transform: 'translateX(-150%)' },
          '100%': { transform: 'translateX(450%)' },
        },
      },
    },
  },
  plugins: [],
} satisfies Config
