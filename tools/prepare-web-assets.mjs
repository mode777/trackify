import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const wasmDir = path.join(root, 'build', 'wasm');
const publicDir = path.join(root, 'build', 'web-public');
const publicWasmDir = path.join(publicDir, 'wasm');
const xaBackendSourceFile = path.join(root, 'web', 'backend_xa.js');
const genhBackendSourceFile = path.join(root, 'web', 'backend_genh.js');
const mp3BackendSourceFile = path.join(root, 'web', 'backend_mp3.js');

const requiredRuntimeFiles = [
  'scriptprocessor_player.js',
  'backend_psx.js',
  'backend_snes.js',
  'backend_nez.js',
  'backend_n64.js',
  'backend_vgm.js',
  'psx.wasm',
  'snes.wasm',
  'nez.wasm',
  'n64.wasm',
  'vgm.wasm',
];

async function ensureRuntimeArtifacts() {
  const missing = [];
  for (const fileName of requiredRuntimeFiles) {
    const fullPath = path.join(wasmDir, fileName);
    try {
      await fs.access(fullPath);
    } catch {
      missing.push(fullPath);
    }
  }

  if (missing.length) {
    throw new Error(
      'Missing CMake runtime artifacts. Run "npm run wasm" first.\\n' +
        missing.join('\\n')
    );
  }
}

async function cleanPublicDir() {
  await fs.rm(publicDir, { recursive: true, force: true });
  await fs.mkdir(publicWasmDir, { recursive: true });
}

async function copyRuntimeArtifacts() {
  for (const fileName of requiredRuntimeFiles) {
    await fs.copyFile(
      path.join(wasmDir, fileName),
      path.join(publicWasmDir, fileName)
    );
  }

  await fs.copyFile(
    xaBackendSourceFile,
    path.join(publicWasmDir, 'backend_xa.js')
  );

  await fs.copyFile(
    genhBackendSourceFile,
    path.join(publicWasmDir, 'backend_genh.js')
  );

  await fs.copyFile(
    mp3BackendSourceFile,
    path.join(publicWasmDir, 'backend_mp3.js')
  );
}

async function main() {
  await ensureRuntimeArtifacts();
  await cleanPublicDir();
  await copyRuntimeArtifacts();

  process.stdout.write(
    `Prepared runtime assets in ${publicDir}\\n`
  );
}

main().catch((error) => {
  process.stderr.write(String(error.stack || error) + '\\n');
  process.exitCode = 1;
});
