import { toPosixPath } from './identifiers.mjs';
import { ensureFileInVirtualFs, resolveSampleDependency } from './wasm-vfs.mjs';

let shimsInstalled = false;
let currentLogger = null;

export function createBackendStubs() {
	class EmsHEAP16BackendAdapter {}

	class SimpleFileMapper {
		mapCacheFileName(name) {
			return name;
		}

		mapUrl(filename) {
			return filename;
		}

		registerFileData(pathFilenameArray) {
			return pathFilenameArray;
		}
	}

	return { EmsHEAP16BackendAdapter, SimpleFileMapper };
}

export function installPlayerShims(ctx) {
	if (shimsInstalled) return;
	shimsInstalled = true;
	currentLogger = ctx.logger;

	globalThis.window = globalThis;
	globalThis.window.WASM_SEARCH_PATH = `${toPosixPath(ctx.wasmDir)}/`;

	const { EmsHEAP16BackendAdapter, SimpleFileMapper } = createBackendStubs();
	globalThis.EmsHEAP16BackendAdapter = EmsHEAP16BackendAdapter;
	globalThis.SimpleFileMapper = SimpleFileMapper;

	globalThis.ScriptNodePlayer = {
		getInstance() {
			return {
				isReady() {
					return true;
				},

				_fileRequestCallback(namePtr) {
					const module = ctx.getModule();
					if (!module) return 0;

					const requested = module.UTF8ToString(namePtr);
					const resolved = resolveSampleDependency(ctx, requested);
					if (!resolved) {
						ctx.logger.debug(
							`Missing dependency request: ${requested} (from ${ctx.currentTrackRel})`
						);
						return 0;
					}

					ctx.logger.debug(
						`Resolved dependency: ${requested} -> ${resolved.relPath}`
					);

					ensureFileInVirtualFs(module, ctx.sampleVirtualRoot, resolved.relPath, resolved.data);
					return 1;
				},

				_fileDataRequestCallback(namePtr) {
					const module = ctx.getModule();
					if (!module) return new Uint8Array(0);

					const requested = module.UTF8ToString(namePtr);
					const resolved = resolveSampleDependency(ctx, requested);
					if (!resolved) {
						ctx.logger.debug(
							`Missing dependency data: ${requested} (from ${ctx.currentTrackRel})`
						);
					}
					return resolved ? new Uint8Array(resolved.data) : new Uint8Array(0);
				},
			};
		},

		getWebAudioSampleRate() {
			return ctx.sampleRate;
		},
	};
}

export function areShimsInstalled() {
	return shimsInstalled;
}

export function _resetShimsForTests() {
	shimsInstalled = false;
	currentLogger = null;
}
