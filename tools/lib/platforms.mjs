// Extension -> platform classification now lives in the shared module
// (shared/catalog-identifiers.mjs) so the browser admin page and the CLI
// cannot drift. This shim keeps existing `from './platforms.mjs'` imports
// working.
export {
	EXT_PLATFORM,
	getExtension,
	getPlatform,
} from '../../shared/catalog-identifiers.mjs';
