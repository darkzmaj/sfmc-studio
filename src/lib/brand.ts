export const APP = {
  name: 'SFM Character Studio',
  shortName: 'SFMC Studio',
  version: '1.0.0',
  url: 'https://sfmc-studio.kori.my',
  repo: 'https://github.com/darkzmaj/sfmc-studio',
  author: 'Maj Kovačič',
  authorUrl: 'https://darkzmaj.eu',
  network: 'KORI Network',
} as const;

export const copyrightYear = () => Math.max(2026, new Date().getFullYear());
