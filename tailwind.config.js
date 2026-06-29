/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#e0f0ff',
          500: '#0077b6',
          600: '#005f92',
          700: '#004a72',
        },
      },
    },
  },
  plugins: [],
}
