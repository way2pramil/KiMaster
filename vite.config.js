import { defineConfig } from 'vite';
import Icons from 'unplugin-icons/vite';

/**
 * Build-time transform for every Lucide icon imported via `~icons/lucide/*?raw`.
 * Strips the outer <svg> wrapper (so paths can be merged into KmIcon's ICONS map)
 * and normalizes stroke-width to 1.5 to match the hand-rolled KiCad set.
 */
function lucideTransform(svg) {
  return svg
    .replace(/<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')
    .replace(/stroke-width="2"/g, 'stroke-width="1.5"')
    .replace(/stroke="(?!currentColor|none)([^"]*)"/g, 'stroke="currentColor"');
}

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  clearScreen: false,
  plugins: [
    Icons({
      compiler: 'vanilla',
      scale: 1,
      transform: lucideTransform,
    }),
  ],
  optimizeDeps: {
    include: ['pixi.js', 'pixi-viewport', 'fuse.js'],
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  build: {
    target:
      process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
    minify: !process.env.TAURI_ENV_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    rollupOptions: {
      input: 'index.html',
    },
  },
});
