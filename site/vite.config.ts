import { defineConfig, type Plugin } from 'vite';
import { cpSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Os dados gerados pelo pipeline ficam em /site/data e são copiados para dist/data no build.
function copyData(): Plugin {
  return {
    name: 'copy-data',
    apply: 'build',
    closeBundle() {
      const src = resolve(__dirname, 'data');
      if (existsSync(src)) cpSync(src, resolve(__dirname, 'dist/data'), { recursive: true });
    },
  };
}

export default defineConfig({
  base: './',
  publicDir: false,
  plugins: [copyData()],
  build: { target: 'es2020', chunkSizeWarningLimit: 800 },
});
