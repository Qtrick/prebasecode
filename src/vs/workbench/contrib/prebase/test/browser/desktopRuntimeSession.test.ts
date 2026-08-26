/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { newWriteableBufferStream } from '../../../../../base/common/buffer.js';
import { Event } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import type { IChannel } from '../../../../../base/parts/ipc/common/ipc.js';
import type { IRequestContext } from '../../../../../base/parts/request/common/request.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { upcastPartial } from '../../../../../base/test/common/mock.js';
import type { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import type { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import type { IMainProcessService } from '../../../../../platform/ipc/common/mainProcessService.js';
import type { IRequestService } from '../../../../../platform/request/common/request.js';
import type { IWorkspace, IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import type { IWorkspaceTrustManagementService } from '../../../../../platform/workspace/common/workspaceTrust.js';
import { PreBaseConfigKeys } from '../../common/prebaseConfiguration.js';
import { PreBaseDesktopRuntimeService } from '../../browser/prebaseDesktopRuntimeService.js';
import type { PackageJsonShape, ProjectProbe } from '../../common/runtime/types.js';
import type { IPreBaseDesktopSpawnResult } from '../../../../../platform/prebaseDesktop/common/prebaseDesktop.js';

function probe(overrides: {
	exists?: (path: string) => boolean;
	files?: Record<string, string>;
	packageJson?: PackageJsonShape;
} = {}): ProjectProbe {
	const files = { ...(overrides.files ?? {}) };
	return {
		exists: path => overrides.exists?.(path) ?? (Object.prototype.hasOwnProperty.call(files, path) || path in files),
		readText: path => files[path],
		packageJson: overrides.packageJson,
		rootLabel: 'app',
	};
}

function requestContext(statusCode: number): IRequestContext {
	return { res: { headers: {}, statusCode }, stream: newWriteableBufferStream() };
}

const TAURI_READY = {
	files: {
		'src-tauri/tauri.conf.json': '{"build":{"devUrl":"http://localhost:1420"}}',
		'src-tauri/Cargo.toml': '[package]\nname="demo"\n[features]\nprebase-testing=["dep:tauri-plugin-wdio-webdriver"]\n[dependencies]\ntauri="2"\ntauri-plugin-wdio-webdriver={version="1",optional=true}\n',
	},
};
const TAURI_PLAIN = {
	files: {
		'src-tauri/tauri.conf.json': '{"build":{"devUrl":"http://localhost:1420"}}',
		'src-tauri/Cargo.toml': '[package]\nname="demo"\n[dependencies]\ntauri="2"\n',
	},
};
const ELECTRON_VITE = {
	packageJson: {
		devDependencies: { electron: '^30.0.0', vite: '^5.0.0' },
		main: 'electron/main.js',
		scripts: { dev: 'electron-vite dev' },
	},
	files: { 'electron/main.js': '', 'vite.config.ts': '' },
};

function installReadyWebDriverFetch(): () => void {
	const original = globalThis.fetch;
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		if (url.endsWith('/status')) {
			return { status: 200, text: async () => '{}' } as Response;
		}
		if (url.endsWith('/session') && (init?.method ?? 'GET') === 'POST') {
			return { status: 200, text: async () => JSON.stringify({ value: { sessionId: 'wd-1' } }) } as Response;
		}
		if (url.includes('/execute/sync')) {
			const body = String(init?.body ?? '');
			if (body.includes('__prebaseDesktopTest') && body.includes('run')) {
				return { status: 200, text: async () => JSON.stringify({ value: { ok: true, match: { name: 'Save', visible: true, enabled: true } } }) } as Response;
			}
			return { status: 200, text: async () => JSON.stringify({ value: true }) } as Response;
		}
		if ((init?.method ?? 'GET') === 'DELETE') {
			return { status: 200, text: async () => '{}' } as Response;
		}
		return { status: 404, text: async () => '' } as Response;
	}) as typeof fetch;
	return () => { globalThis.fetch = original; };
}

suite('PreBase desktop session lifecycle', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	function createService(options: {
		trusted?: boolean;
		config?: Record<string, unknown>;
		spawn?: IPreBaseDesktopSpawnResult;
		evaluate?: (expression: string) => unknown;
	} = {}) {
		const killed: number[] = [];
		const closed: string[] = [];
		const dialogs: string[] = [];
		const spawns: Array<{ command: unknown; extras: unknown }> = [];
		const channel: IChannel = {
			call: async <T>(command: string, arg?: unknown): Promise<T> => {
				const args = Array.isArray(arg) ? arg : [];
				if (command === 'spawnExternal') {
					spawns.push({ command: args[0], extras: args[4] });
					return (options.spawn ?? { pid: 42, webDriverPort: 4445, debugPort: 9222 }) as T;
				}
				if (command === 'killOwnedProcess') {
					killed.push(args[0] as number);
					return undefined as T;
				}
				if (command === 'openManagedWindow') {
					const request = args[0] as { sessionId: string; rendererUrl: string; title: string };
					return { sessionId: request.sessionId, windowId: 7, rendererUrl: request.rendererUrl, title: request.title } as T;
				}
				if (command === 'closeManagedWindow') {
					closed.push(args[0] as string);
					return undefined as T;
				}
				if (command === 'evaluateInManagedWindow') {
					const expression = String(args[1] ?? '');
					if (options.evaluate) {
						return options.evaluate(expression) as T;
					}
					if (expression.includes('__prebaseDesktopTest') && expression.includes('run')) {
						return { ok: true, match: { name: 'Save', visible: true, enabled: true } } as T;
					}
					return true as T;
				}
				return undefined as T;
			},
			listen: () => Event.None,
		};

		const service = disposables.add(new PreBaseDesktopRuntimeService(
			upcastPartial<IMainProcessService>({ getChannel: () => channel }),
			upcastPartial<IConfigurationService>({
				getValue: <T>(...args: unknown[]): T => {
					const key = typeof args[0] === 'string' ? args[0] : '';
					return options.config?.[key] as T;
				},
				onDidChangeConfiguration: Event.None,
			}),
			upcastPartial<IWorkspaceContextService>({
				getWorkspace: () => upcastPartial<IWorkspace>({
					id: 'app',
					folders: [{ uri: URI.file('/app'), name: 'app', index: 0, toResource: (path: string) => URI.joinPath(URI.file('/app'), path) }],
				}),
			}),
			upcastPartial<IRequestService>({
				request: async () => requestContext(200),
			}),
			upcastPartial<IDialogService>({
				info: async (message: string) => { dialogs.push(message); },
			}),
			upcastPartial<IWorkspaceTrustManagementService>({
				isWorkspaceTrusted: () => options.trusted !== false,
			}),
		));
		return { service, killed, closed, dialogs, spawns };
	}

	test('refuses to launch project code when the workspace is Restricted', async () => {
		const { service, dialogs, spawns } = createService({ trusted: false });
		service.detect(probe(ELECTRON_VITE));
		const session = await service.start({ launchMode: 'managed', rendererUrl: 'http://127.0.0.1:5173' });
		assert.strictEqual(session, undefined);
		assert.ok(dialogs.some(title => /restricted/i.test(title)));
		assert.deepStrictEqual(spawns, []);
		assert.deepStrictEqual(await service.startForMagnus({ mode: 'renderer' }), {
			ok: false,
			reason: 'Desktop testing executes project code and is unavailable in Restricted Mode.',
			workspaceTrust: false,
		});
	});

	test('does not spawn Tauri full-app when WebDriver setup is still required', async () => {
		const { service, spawns } = createService();
		service.detect(probe(TAURI_PLAIN));
		const session = await service.start({ launchMode: 'external', purpose: 'test' });
		assert.strictEqual(session?.state, 'setupRequired');
		assert.strictEqual(session.automationBackend, 'none');
		assert.deepStrictEqual(spawns, []);
		const inspect = await service.inspectForMagnus(session.id);
		assert.strictEqual(inspect.setupRequired, true);
		assert.strictEqual(inspect.ok, false);
		assert.strictEqual(inspect.rendererAvailable, true);
	});

	test('preview-launches Tauri full-app without WebDriver or testing features', async () => {
		const { service, spawns } = createService({ spawn: { pid: 44 } });
		service.detect(probe(TAURI_PLAIN));
		const session = await service.start({ launchMode: 'external', purpose: 'preview' });
		assert.strictEqual(session?.state, 'running');
		assert.strictEqual(session.automationBackend, 'none');
		assert.strictEqual(session.pid, 44);
		assert.deepStrictEqual((spawns[0]?.command as { args?: string[] }).args, ['tauri', 'dev']);
		assert.deepStrictEqual(spawns[0]?.extras, { purpose: 'preview', electronCdp: false, webDriver: false });
		const inspect = await service.inspectForMagnus(session.id);
		assert.strictEqual(inspect.ok, false);
		assert.strictEqual(inspect.setupRequired, true);
	});

	test('kills the Tauri process when the driver port is missing after spawn', async () => {
		const { service, killed, spawns } = createService({ spawn: { pid: 77 } });
		service.detect(probe(TAURI_READY));
		const session = await service.start({ launchMode: 'external', purpose: 'test' });
		assert.strictEqual(session?.state, 'error');
		assert.match(String(session.errorMessage), /WebDriver port/);
		assert.deepStrictEqual(killed, [77]);
		assert.strictEqual((spawns[0]?.command as { command?: string }).command, 'cargo');
		assert.deepStrictEqual((spawns[0]?.command as { args?: string[] }).args, ['tauri', 'dev', '--features', 'prebase-testing']);
		assert.deepStrictEqual(spawns[0]?.extras, { purpose: 'test', electronCdp: false, webDriver: true });
	});

	test('kills the Electron process when the CDP port is missing after spawn', async () => {
		const { service, killed } = createService({ spawn: { pid: 88 } });
		service.detect(probe(ELECTRON_VITE));
		const session = await service.start({ launchMode: 'external', purpose: 'test' });
		assert.strictEqual(session?.state, 'error');
		assert.match(String(session.errorMessage), /debugging port/);
		assert.deepStrictEqual(killed, [88]);
	});

	test('stops test-owned sessions on dispose even when preview externals are kept', async () => {
		const restore = installReadyWebDriverFetch();
		try {
			const { service, killed } = createService({
				spawn: { pid: 91, webDriverPort: 4445 },
				config: {
					[PreBaseConfigKeys.RuntimeStopExternalAppsOnExit]: false,
					[PreBaseConfigKeys.RuntimeStopManagedAppsOnExit]: false,
				},
			});
			service.detect(probe(TAURI_READY));
			const session = await service.start({ launchMode: 'external', purpose: 'test' });
			assert.strictEqual(session?.state, 'testing');
			assert.strictEqual(session.pid, 91);
			service.dispose();
			assert.deepStrictEqual(killed, [91]);
		} finally {
			restore();
		}
	});

	test('blocks arbitrary JavaScript on Tauri WebDriver and still allows test interact without the preview setting', async () => {
		const restore = installReadyWebDriverFetch();
		try {
			const { service } = createService({
				spawn: { pid: 5, webDriverPort: 4445 },
				config: { [PreBaseConfigKeys.RuntimeEnableDesktopAutomation]: false },
			});
			service.detect(probe(TAURI_READY));
			const started = await service.startForMagnus({ framework: 'tauri', mode: 'fullApp', testing: false });
			assert.strictEqual(started.ok, true);
			assert.strictEqual(started.purpose, 'test');
			assert.strictEqual(started.backend, 'webdriver');
			const evalBlocked = await service.evaluateForMagnus(String(started.sessionId), '1+1');
			assert.strictEqual(evalBlocked.ok, false);
			assert.match(String(evalBlocked.reason), /interact or assert/i);
			const clicked = await service.interactForMagnus({ action: 'click', locator: { by: 'role', role: 'button', name: 'Save' } });
			assert.strictEqual(clicked.ok, true);
		} finally {
			restore();
		}
	});

	test('keeps preview interact gated on the automation setting', async () => {
		const { service, closed } = createService({
			config: { [PreBaseConfigKeys.RuntimeEnableDesktopAutomation]: false },
		});
		service.detect(probe(ELECTRON_VITE));
		const session = await service.start({ launchMode: 'managed', rendererUrl: 'http://127.0.0.1:5173' });
		assert.strictEqual(session?.purpose, 'preview');
		assert.strictEqual(session.state, 'running');
		const blocked = await service.interactForMagnus({ action: 'click', locator: { by: 'role', role: 'button', name: 'Save' } });
		assert.strictEqual(blocked.ok, false);
		assert.match(String(blocked.reason), /disabled in settings/);
		assert.deepStrictEqual(closed, []);
	});
});
