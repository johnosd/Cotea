import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./', import.meta.url)) },
  },
  // Páginas e componentes do Next usam JSX em arquivos .js (SWC do Next aceita); o Vite só
  // aceitaria em .jsx. Escopo restrito para os testes importarem getServerSideProps de pages/.
  oxc: {
    include: [/\.(m?ts|[jt]sx)$/, /[\\/](pages|components)[\\/].*\.js$/],
    exclude: [/node_modules/],
    lang: 'jsx',
    jsx: { runtime: 'automatic' },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{js,mjs}'],
  },
});
