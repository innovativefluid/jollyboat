import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

const { version } = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { version: string };

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    define: { __APP_VERSION__: JSON.stringify(version) },
    build: { rollupOptions: { input: { index: resolve('src/main/index.ts') } } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve('src/preload/index.ts') },
        output: { format: 'cjs', entryFileNames: '[name].cjs' }
      }
    }
  },
  renderer: {
    build: {
      rollupOptions: {
        input: {
          launcher: resolve('src/renderer/launcher/index.html'),
          picker: resolve('src/renderer/picker/index.html'),
          prompt: resolve('src/renderer/prompt/index.html'),
          bar: resolve('src/renderer/bar/index.html'),
          overlay: resolve('src/renderer/overlay/index.html')
        }
      }
    }
  }
});
