import { SAMPLE_RATE } from './constants.mjs';
import { DEFAULT_SAMPLE_DIR } from './paths.mjs';

export function createIndexer({ logger, wasmDir, sampleVirtualPrefix, files }) {
	const ctx = {
		logger,
		wasmDir,
		sampleVirtualPrefix,
		defaultSampleDir: DEFAULT_SAMPLE_DIR,
		sampleVirtualRoot: `/${sampleVirtualPrefix}`,
		sampleRate: SAMPLE_RATE,
		files,
		currentTrackRel: '',
		_module: null,
	};

	ctx.getModule = () => ctx._module;
	ctx.setModule = (module) => {
		ctx._module = module;
	};

	return ctx;
}
