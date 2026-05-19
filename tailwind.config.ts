import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    // G_C-26 W4-1: pre-emptively scan src/** so subsequent waves (G_C-30..G_C-34)
    // can move files into src/ without a parallel tailwind config edit. Tailwind
    // 4 tree-shakes by class usage; a glob with zero matching files is inert.
    './src/**/*.{ts,tsx}',
  ],
};

export default config;
