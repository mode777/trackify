import fs from 'node:fs/promises';
import path from 'node:path';

const distDir = path.join(process.cwd(), 'build', 'dist');

const required = [
  'index.html',
  'sample-files/index.json',
  'wasm/scriptprocessor_player.js',
  'wasm/backend_psx.js',
  'wasm/backend_snes.js',
  'wasm/backend_nez.js',
  'wasm/backend_n64.js',
  'wasm/backend_vgm.js',
  'wasm/psx.wasm',
  'wasm/snes.wasm',
  'wasm/nez.wasm',
  'wasm/n64.wasm',
  'wasm/vgm.wasm',
];

async function main() {
  const missing = [];

  for (const relativePath of required) {
    try {
      await fs.access(path.join(distDir, relativePath));
    } catch {
      missing.push(relativePath);
    }
  }

  if (missing.length) {
    throw new Error(
      'Missing expected dist artifacts:\\n' + missing.join('\\n')
    );
  }

  process.stdout.write('Dist output verification passed.\\n');
}

main().catch((error) => {
  process.stderr.write(String(error.stack || error) + '\\n');
  process.exitCode = 1;
});
