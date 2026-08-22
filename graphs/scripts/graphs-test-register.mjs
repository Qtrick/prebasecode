import { register } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

if (typeof globalThis.window === 'undefined') {
	globalThis.window = {
		location: { href: 'http://localhost/' },
		addEventListener() {},
		removeEventListener() {},
		dispatchEvent() { return true; },
		matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
	};
}
if (typeof globalThis.document === 'undefined') {
	globalThis.document = {
		createElement() { return {}; },
		addEventListener() {},
		removeEventListener() {},
	};
}
if (typeof globalThis.vscode === 'undefined') {
	globalThis.vscode = {
		ipcRenderer: {
			send() {},
			on() {},
			once() {},
			removeListener() {},
			invoke: async () => ({}),
		},
		webFrame: {},
		process: {},
	};
}

register(pathToFileURL(path.join(__dirname, 'graphs-test-loader.mjs')).href, import.meta.url);
