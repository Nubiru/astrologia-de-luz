import { Cinzel, Cormorant_Garamond, Jost } from 'next/font/google';

export const cinzel = Cinzel({
  subsets: ['latin'],
  display: 'swap',
  weight: ['400', '500', '600'],
  variable: '--font-cinzel',
});

export const cormorantGaramond = Cormorant_Garamond({
  subsets: ['latin'],
  display: 'swap',
  weight: ['300', '400', '500', '600'],
  style: ['normal', 'italic'],
  variable: '--font-cormorant',
});

export const jost = Jost({
  subsets: ['latin'],
  display: 'swap',
  weight: ['200', '300', '400', '500'],
  variable: '--font-jost',
});

export const brandFontVariables = [cinzel.variable, cormorantGaramond.variable, jost.variable].join(
  ' ',
);
