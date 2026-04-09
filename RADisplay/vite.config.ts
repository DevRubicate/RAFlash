import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'path';

export default defineConfig({
  plugins: [vue()],
  base: './',
  root: resolve(__dirname, 'src/html'),
  build: {
    sourcemap: false,
    outDir: resolve(__dirname, '..', '.build', 'internals', 'assets'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        'asset-editor': resolve(__dirname, 'src/html/asset-editor.html'),
        'asset-list': resolve(__dirname, 'src/html/asset-list.html'),
        'rich-presence-editor': resolve(__dirname, 'src/html/rich-presence-editor.html'),
        'memory-explorer': resolve(__dirname, 'src/html/memory-explorer.html'),
        'memory-search': resolve(__dirname, 'src/html/memory-search.html'),
        'memory-watch': resolve(__dirname, 'src/html/memory-watch.html'),
        'code-notes': resolve(__dirname, 'src/html/code-notes.html'),
        'menu': resolve(__dirname, 'src/html/menu.html'),
        'file-picker': resolve(__dirname, 'src/html/file-picker.html'),
        'game-behavior': resolve(__dirname, 'src/html/game-behavior.html'),
        'documentation': resolve(__dirname, 'src/html/documentation.html'),
        'event-log': resolve(__dirname, 'src/html/event-log.html'),
        'settings': resolve(__dirname, 'src/html/settings.html'),
      },
    },
  },
});