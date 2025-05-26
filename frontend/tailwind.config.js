/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#FF6B00',
          dark: '#CC5500',
        },
        secondary: {
          DEFAULT: '#333333',
          light: '#666666',
        },
        background: {
          DEFAULT: '#F5F5F5',
          dark: '#1A1A1A',
        },
        success: '#4CAF50',
        error: '#F44336',
        warning: '#FFC107',
      },
      borderRadius: {
        DEFAULT: '0.5rem',
      },
      spacing: {
        '72': '18rem',
        '84': '21rem',
        '96': '24rem',
      },
    },
  },
  plugins: [],
} 