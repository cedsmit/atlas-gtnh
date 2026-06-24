/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      keyframes: {
        slide: {
          '0%': { transform: 'translateX(-150%)' },
          '100%': { transform: 'translateX(450%)' },
        },
      },
    },
  },
  plugins: [],
}
