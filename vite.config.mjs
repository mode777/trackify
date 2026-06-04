import path from 'node:path';
import { defineConfig } from 'vite';

const rootDir = path.resolve(process.cwd(), 'web');

export default defineConfig({
  root: rootDir,
  publicDir: path.resolve(process.cwd(), 'build/web-public'),
  build: {
    outDir: path.resolve(process.cwd(), 'build/dist'),
    emptyOutDir: true,
  },
  server: {
    port: 8137,
    strictPort: true,
  },
});
