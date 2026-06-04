import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const wasmDir = path.join(root, 'build', 'wasm');
const publicDir = path.join(root, 'build', 'web-public');
const publicWasmDir = path.join(publicDir, 'wasm');
const sourceSamplesDir = path.join(root, 'sample-files');
const publicSamplesDir = path.join(publicDir, 'sample-files');

const requiredRuntimeFiles = [
  'scriptprocessor_player.js',
  'backend_psx.js',
  'backend_snes.js',
  'backend_nez.js',
  'psx.wasm',
  'snes.wasm',
  'nez.wasm',
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
}

async function copySampleFiles() {
  await fs.cp(sourceSamplesDir, publicSamplesDir, { recursive: true });
}

async function main() {
  await ensureRuntimeArtifacts();
  await cleanPublicDir();
  await copyRuntimeArtifacts();
  await copySampleFiles();

  process.stdout.write(
    `Prepared runtime assets in ${publicDir}\\n`
  );
}

main().catch((error) => {
  process.stderr.write(String(error.stack || error) + '\\n');
  process.exitCode = 1;
});
