/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#0070F3',
          50: '#E6F0FF',
          100: '#CCE1FF',
          200: '#99C3FF',
          300: '#66A5FF',
          400: '#3387FF',
          500: '#0070F3',
          600: '#005AC2',
          700: '#004391',
          800: '#002D61',
          900: '#001630',
        },
      },
    },
  },
  plugins: [],
  darkMode: 'class',
} 