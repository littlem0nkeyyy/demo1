import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/app/**/*.{ts,tsx}', './src/components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        machina: {
          bg: '#0b0e14',
          panel: '#131826',
          border: '#232a3d',
          text: '#e6e9f0',
          muted: '#8b93a7',
          accent: '#6ee7b7',
          warn: '#fbbf24',
          bad: '#f87171',
        },
      },
    },
  },
  plugins: [],
};

export default config;
