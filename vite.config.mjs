import path from 'node:path';
import { defineConfig } from 'vite';

const rootDir = path.resolve(process.cwd(), 'web');

export default defineConfig({
  root: rootDir,
  publicDir: path.resolve(process.cwd(), 'build/web-public'),
  build: {
    outDir: path.resolve(process.cwd(), 'build/dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.resolve(rootDir, 'index.html'),
        games: path.resolve(rootDir, 'games.html'),
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
