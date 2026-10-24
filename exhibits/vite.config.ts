import { withNoindexMeta } from '../shared/indexing.ts';
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { cpSync, mkdirSync, readdirSync } from 'node:fs';

const root = fileURLToPath(new URL('.', import.meta.url));
const names = ['sand-pedestal', 'nyc-diorama', 'library-diorama', 'dino-diorama', 'electric-town-diorama', 'library-20m'];

export default defineConfig({
  root,
  base: '/exhibits/',
  publicDir: false,
  plugins: [{
    name: 'exhibit-licenses',
    transformIndexHtml: html => withNoindexMeta(html),
    closeBundle() {
      const directory = resolve(root, '../public/exhibits/licenses');
      mkdirSync(directory, { recursive: true });
      cpSync(resolve(root, '../node_modules/three/LICENSE'), resolve(directory, 'THREE-LICENSE.txt'));
      const fonts = resolve(root, 'electric-town-diorama/fonts');
      for (const file of readdirSync(fonts).filter(file => file.endsWith('.txt'))) {
        cpSync(resolve(fonts, file), resolve(directory, file));
      }
    },
  }],
  build: {
    outDir: resolve(root, '../public/exhibits'),
    emptyOutDir: true,
    rolldownOptions: {
      input: Object.fromEntries(names.map(name => [name, resolve(root, name, 'index.html')])),
    },
  },
});
