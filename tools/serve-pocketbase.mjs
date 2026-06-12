#!/usr/bin/env node

import { spawnSync } from 'child_process';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const isWindows = process.platform === 'win32';
const ext = isWindows ? '.exe' : '';
const pocketbasePath = join(__dirname, '..', 'bin', `pocketbase${ext}`);

const result = spawnSync(pocketbasePath, ['serve', '--publicDir', './build/dist', '--dir', './pb_data'], {
  stdio: 'inherit',
  cwd: join(__dirname, '..')
});

process.exit(result.status ?? 1);
