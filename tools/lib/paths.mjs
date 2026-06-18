import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_SAMPLE_DIR = 'sample-files';

function normalizeRequestName(name) {
	return String(name).replace(/\\/g, '/').replace(/^\/+/, '');
}

export function resolvePaths({ argv, cwd, scriptUrl }) {
	const scriptDir = path.dirname(fileURLToPath(scriptUrl));
	const scriptRootDir = path.resolve(scriptDir, '..');

	const sampleDirArg = argv[2];
	const sampleDirName = sampleDirArg && sampleDirArg.trim() ? sampleDirArg.trim() : DEFAULT_SAMPLE_DIR;
	const sampleDir = path.resolve(cwd, sampleDirName);

	const sampleVirtualPrefix = normalizeRequestName(sampleDirName).replace(/^\/+|\/+$/g, '') || DEFAULT_SAMPLE_DIR;
	const sampleVirtualRoot = `/${sampleVirtualPrefix}`;

	return {
		scriptDir,
		scriptRootDir,
		sampleDirName,
		sampleDir,
		sampleVirtualPrefix,
		sampleVirtualRoot,
		indexPath: path.join(sampleDir, 'index.json'),
		gamesPath: path.join(sampleDir, 'games.json'),
		wasmDir: path.join(scriptRootDir, 'build', 'wasm'),
		vgmIniPath: path.join(scriptRootDir, 'submodules', 'vgmplay-0.40.9', 'src', 'VGMPlay.ini'),
	};
}
