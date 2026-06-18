import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import { BACKEND_READY_TIMEOUT_MS } from './constants.mjs';
import { installPlayerShims } from './player-shims.mjs';

const require = createRequire(import.meta.url);

export async function loadBackend({ platform, wasmDir, ctx }) {
	if (ctx._moduleCache?.has(platform)) {
		return ctx._moduleCache.get(platform);
	}

	const backendFile = path.join(wasmDir, `backend_${platform}.js`);
	try {
		await fs.access(backendFile);
	} catch {
		throw new Error(`Missing backend runtime: ${backendFile}. Run "npm run wasm" first.`);
	}

	installPlayerShims(ctx);
	const module = require(backendFile);
	await waitForBackendReady(module, platform);

	if (!module.Pointer_stringify) {
		module.Pointer_stringify = (ptr) => module.UTF8ToString(ptr);
	}

	if (!ctx._moduleCache) ctx._moduleCache = new Map();
	ctx._moduleCache.set(platform, module);
	return module;
}

export function waitForBackendReady(module, backendName) {
	if (!module.notReady) return Promise.resolve();

	return new Promise((resolve, reject) => {
		const timeoutId = setTimeout(() => {
			reject(new Error(`Timed out waiting for backend ${backendName} runtime initialization.`));
		}, BACKEND_READY_TIMEOUT_MS);

		const previousAdapterCallback = module.adapterCallback;
		module.adapterCallback = () => {
			if (typeof previousAdapterCallback === 'function') {
				try {
					previousAdapterCallback();
				} catch {
					// Ignore callback errors from previous hook.
				}
			}
			clearTimeout(timeoutId);
			resolve();
		};
	});
}
