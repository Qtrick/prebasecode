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
		process: globalThis.process || process,
	};
}
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
