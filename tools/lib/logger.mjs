export function createLogger({ debug = false, sink = process.stdout, prefix = '[trackify-index]' } = {}) {
	function info(message) {
		sink.write(`${prefix} ${message}\n`);
	}
	function warn(message) {
		process.stderr.write(`${prefix} ${message}\n`);
	}
	function debugLog(message) {
		if (debug) process.stderr.write(`${prefix} [debug] ${message}\n`);
	}
	return { info, warn, debug: debugLog };
}
