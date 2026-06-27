import path from 'node:path';
import { defineConfig } from 'vite';

const rootDir = path.resolve(process.cwd(), 'web');
const isWatchBuild = process.argv.includes('--watch');

export default defineConfig({
  root: rootDir,
  publicDir: path.resolve(process.cwd(), 'build/web-public'),
  build: {
    outDir: path.resolve(process.cwd(), 'build/dist'),
    // Preserve existing build outputs while watching to keep iterative rebuilds stable.
    emptyOutDir: !isWatchBuild,
    watch: isWatchBuild ? {} : null,
    minify: isWatchBuild ? false : 'esbuild',
    rollupOptions: {
      input: {
        main: path.resolve(rootDir, 'index.html'),
        collections: path.resolve(rootDir, 'collections.html'),
        playlist: path.resolve(rootDir, 'playlist.html'),
        player: path.resolve(rootDir, 'player.html'),
      },
    },
  },
  server: {
    port: 8137,
    strictPort: true,
  },
});
