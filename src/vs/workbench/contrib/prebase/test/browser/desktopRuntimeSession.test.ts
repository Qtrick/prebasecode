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
	rootPath?: string;
} = {}): ProjectProbe {
	const files = { ...(overrides.files ?? {}) };
	return {
		exists: path => overrides.exists?.(path) ?? (Object.prototype.hasOwnProperty.call(files, path) || path in files),
		readText: path => files[path],
		packageJson: overrides.packageJson,
		rootLabel: 'app',
		rootPath: overrides.rootPath,
	};
}

function requestContext(statusCode: number): IRequestContext {
	return { res: { headers: {}, statusCode }, stream: newWriteableBufferStream() };
}

const TAURI_READY = {
	files: {
		'src-tauri/tauri.conf.json': '{"build":{"devUrl":"http://localhost:1420"}}',
		'src-tauri/Cargo.toml': '[package]\nname="demo"\n[features]\nprebase-testing=["dep:tauri-plugin-wdio-webdriver"]\n[dependencies]\ntauri="2"\ntauri-plugin-wdio-webdriver={version="1",optional=true}\n',
		'src-tauri/src/lib.rs': 'fn run() { let mut builder = tauri::Builder::default();\n#[cfg(all(debug_assertions, feature = "prebase-testing"))]\n{ builder = builder.plugin(tauri_plugin_wdio_webdriver::init()); }\n}\n',
		'src-tauri/capabilities/default.json': '{"permissions":["wdio-webdriver:default"]}',
	},
};
const TAURI_PLAIN = {
	files: {
		'src-tauri/tauri.conf.json': '{"build":{"devUrl":"http://localhost:1420"}}',
		'src-tauri/Cargo.toml': '[package]\nname="demo"\n[dependencies]\ntauri="2"\n',
	},
};
const TAURI_RUST_ONLY = {
	files: {
		'src-tauri/tauri.conf.json': '{"build":{"frontendDist":"../dist"},"identifier":"com.demo.rust"}',
		'src-tauri/Cargo.toml': '[package]\nname="demo"\n[dependencies]\ntauri={version="2"}\n',
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
			return { status: 200, text: async () => JSON.stringify({ value: { ready: true, message: 'ok' } }) } as Response;
		}
		if (url.endsWith('/session') && (init?.method ?? 'GET') === 'POST') {
			return { status: 200, text: async () => JSON.stringify({ value: { sessionId: 'wd-1' } }) } as Response;
		}
		if (url.includes('/execute/sync')) {
			const body = String(init?.body ?? '');
			if (body.includes('__prebaseDesktopTest') && body.includes('run')) {
				return { status: 200, text: async () => JSON.stringify({ value: { ok: true, native: 'pointer', point: { x: 16, y: 24 }, clickCount: 1, match: { name: 'Save', visible: true, enabled: true } } }) } as Response;
			}
			return { status: 200, text: async () => JSON.stringify({ value: true }) } as Response;
		}
		if (url.includes('/actions') && (init?.method ?? 'GET') === 'POST') {
			return { status: 200, text: async () => JSON.stringify({ value: null }) } as Response;
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
		evaluate?: (expression: string) => unknown | Promise<unknown>;
		onSpawn?: () => void;
	} = {}) {
		const killed: number[] = [];
		const closed: string[] = [];
		const dialogs: string[] = [];
		const spawns: Array<{ command: unknown; cwd: unknown; extras: unknown }> = [];
		const managed: unknown[] = [];
		const pointers: unknown[] = [];
		const channel: IChannel = {
			call: async <T>(command: string, arg?: unknown): Promise<T> => {
				const args = Array.isArray(arg) ? arg : [];
				if (command === 'spawnExternal') {
					spawns.push({ command: args[0], cwd: args[1], extras: args[4] });
					options.onSpawn?.();
					return (options.spawn ?? { pid: 42, webDriverPort: 4445, debugPort: 9222 }) as T;
				}
				if (command === 'killOwnedProcess') {
					killed.push(args[0] as number);
					return undefined as T;
				}
				if (command === 'openManagedWindow') {
					const request = args[0] as { sessionId: string; rendererUrl: string; title: string };
					managed.push(request);
					return { sessionId: request.sessionId, windowId: 7, rendererUrl: request.rendererUrl, title: request.title } as T;
				}
				if (command === 'restartManagedWindow') {
					const request = args[1] as { sessionId: string; rendererUrl: string; title: string };
					return { sessionId: request.sessionId, windowId: 8, rendererUrl: request.rendererUrl, title: request.title } as T;
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
						return { ok: true, native: 'pointer', point: { x: 12, y: 20 }, clickCount: 1, match: { name: 'Save', visible: true, enabled: true } } as T;
					}
					return true as T;
				}
				if (command === 'listOwnedCdpTargets') {
					const debugPort = Number(args[0]);
					return [{
						id: 'page-1',
						type: 'page',
						title: 'Fixture',
						url: 'file:///app/index.html',
						webSocketDebuggerUrl: `ws://127.0.0.1:${debugPort}/devtools/page/1`,
					}] as T;
				}
				if (command === 'getOwnedProcessOutput') {
					return { entries: [], droppedCount: 0, truncated: false } as T;
				}
				if (command === 'requestOwnedLoopbackJson') {
					const url = String(args[0] ?? '');
					const init = (args[1] ?? {}) as { method?: string; body?: string };
					const method = (init.method ?? 'GET').toUpperCase();
					if (url.endsWith('/status')) {
						return { status: 200, json: true, body: { value: { ready: true, message: 'ok' } } } as T;
					}
					if (url.endsWith('/session') && method === 'POST') {
						return { status: 200, json: true, body: { value: { sessionId: 'wd-1' } } } as T;
					}
					if (url.includes('/execute/sync')) {
						const body = String(init.body ?? '');
						if (body.includes('__prebaseDesktopTest') && body.includes('run')) {
							return { status: 200, json: true, body: { value: { ok: true, native: 'pointer', point: { x: 16, y: 24 }, clickCount: 1, match: { name: 'Save', visible: true, enabled: true } } } } as T;
						}
						return { status: 200, json: true, body: { value: true } } as T;
					}
					if (url.includes('/actions') && method === 'POST') {
						return { status: 200, json: true, body: { value: null } } as T;
					}
					if (method === 'DELETE') {
						return { status: 200, json: true, body: {} } as T;
					}
					return { status: 404, json: false, body: undefined } as T;
				}
				if (command === 'dispatchOwnedPointer' || command === 'dispatchOwnedKey' || command === 'dispatchOwnedInsertText') {
					pointers.push({ command, args });
					return undefined as T;
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
		return { service, killed, closed, dialogs, spawns, managed, pointers };
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

	test('does not open a PreBase managed window for rust-only Tauri even with an invented renderer URL', async () => {
		const { service, managed, dialogs } = createService();
		const profile = service.detect(probe(TAURI_RUST_ONLY));
		assert.ok(profile.framework === 'tauri' && profile.isRustOnly);
		assert.strictEqual(profile.capabilities.supportsManagedLaunch, false);
		assert.strictEqual(profile.rendererUrlHint, undefined);

		const session = await service.start({ launchMode: 'managed', rendererUrl: `http://127.0.0.1:${profile.likelyDevPort}` });
		assert.strictEqual(session?.state, 'error');
		assert.ok(dialogs.some(title => /unavailable/i.test(title)));
		assert.deepStrictEqual(managed, []);

		const magnus = await service.startForMagnus({ framework: 'tauri', mode: 'renderer', rendererUrl: 'http://127.0.0.1:1420' });
		assert.strictEqual(magnus.ok, false);
		assert.strictEqual(magnus.state, 'error');
		assert.strictEqual(magnus.mode, 'renderer');
		assert.deepStrictEqual(managed, []);
	});

	test('Electron session summaries do not claim main-process access', async () => {
		const { service } = createService({
			config: { [PreBaseConfigKeys.RuntimeEnableDesktopAutomation]: true },
		});
		service.detect(probe(ELECTRON_VITE));
		const session = await service.start({ launchMode: 'managed', rendererUrl: 'http://127.0.0.1:5173', purpose: 'test' });
		const summary = service.getSessionSummaryForMagnus(session?.id);
		assert.strictEqual(summary.ok, true);
		assert.ok(!('supportsMainProcessAccess' in summary));
		assert.ok((summary.limitations as string[]).some(item => item.includes('main-process code and preload are not executed')));
		const inspect = await service.inspectForMagnus(session?.id);
		assert.ok((inspect.unsupported as string[]).includes('native window controls'));
		assert.ok((inspect.limitations as string[]).every(item => !/main process (is|are) controllable/i.test(item)));
	});

	test('setup-required launch clears stale test evidence from the previous session', async () => {
		const { service } = createService();
		service.detect(probe(ELECTRON_VITE));
		const previous = await service.startForMagnus({ framework: 'electron', mode: 'renderer', rendererUrl: 'http://127.0.0.1:5173' });
		assert.ok((previous.test as { id?: string } | undefined)?.id);
		await service.stop();

		service.detect(probe(TAURI_PLAIN));
		const setupRequired = await service.start({ launchMode: 'external', purpose: 'test' });
		assert.deepStrictEqual({
			state: setupRequired?.state,
			testRunId: setupRequired?.testRunId,
			summaryTest: setupRequired && service.getSessionSummaryForMagnus(setupRequired.id).test,
		}, {
			state: 'setupRequired',
			testRunId: undefined,
			summaryTest: undefined,
		});
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

	test('launches the detected Tauri app with its owning package manager at the app root', async () => {
		const { service, spawns } = createService({ spawn: { pid: 45 } });
		service.detect(probe({
			...TAURI_PLAIN,
			files: { ...TAURI_PLAIN.files, 'bun.lock': '' },
			packageJson: {
				devDependencies: { '@tauri-apps/cli': '^2.0.0' },
				scripts: { 'tauri:dev': 'tauri dev' },
			},
		}));

		const session = await service.start({ launchMode: 'external', purpose: 'preview' });
		assert.strictEqual(session?.state, 'running');
		assert.deepStrictEqual(spawns[0], {
			command: { command: 'bun', args: ['run', 'tauri:dev', '--'] },
			cwd: '/app',
			extras: { purpose: 'preview', electronCdp: false, webDriver: false },
		});
	});

	test('profile app root controls the session root and package-manager spawn cwd', async () => {
		const { service, spawns } = createService({ spawn: { pid: 46 } });
		const profile = service.detect(probe({
			...TAURI_PLAIN,
			rootPath: '/repo/apps/desktop',
			files: { ...TAURI_PLAIN.files, 'pnpm-lock.yaml': '' },
			packageJson: {
				devDependencies: { '@tauri-apps/cli': '^2.0.0' },
				scripts: { 'tauri:dev': 'tauri dev' },
			},
		}));
		assert.strictEqual(profile.appRoot, '/repo/apps/desktop');

		const session = await service.start({ launchMode: 'external', purpose: 'preview' });
		assert.deepStrictEqual({
			sessionRoot: session?.workspaceRoot,
			command: spawns[0]?.command,
			cwd: spawns[0]?.cwd,
		}, {
			sessionRoot: '/repo/apps/desktop',
			command: { command: 'pnpm', args: ['run', 'tauri:dev', '--'] },
			cwd: '/repo/apps/desktop',
		});
	});

	test('passes `dev` when the package script is the Tauri CLI shim', async () => {
		const { service, spawns } = createService({ spawn: { pid: 47, webDriverPort: 4444 } });
		service.detect(probe({
			...TAURI_READY,
			packageJson: {
				devDependencies: { '@tauri-apps/cli': '^2.0.0' },
				scripts: { tauri: 'tauri' },
			},
		}));
		const session = await service.start({ launchMode: 'external', purpose: 'test' });
		assert.strictEqual(session?.state, 'testing');
		assert.deepStrictEqual(spawns[0]?.command, {
			command: 'npm',
			args: ['run', 'tauri', '--', 'dev', '--features', 'prebase-testing'],
		});
		assert.strictEqual(spawns[0]?.cwd, '/app');
		assert.notStrictEqual(spawns[0]?.cwd, '/app/src-tauri');
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
		assert.strictEqual(spawns[0]?.cwd, '/app/src-tauri');
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

	test('cancelling a Tauri launch stops the wait and cleans up the owned process', async () => {
		const restore = installReadyWebDriverFetch();
		try {
			let cancel: (() => void) | undefined;
			const { service, killed } = createService({
				spawn: { pid: 89, webDriverPort: 4445 },
				onSpawn: () => queueMicrotask(() => cancel?.()),
			});
			cancel = () => service.cancelActiveAction();
			service.detect(probe(TAURI_READY));

			const session = await service.start({ launchMode: 'external', purpose: 'test' });
			assert.deepStrictEqual({
				state: session?.state,
				pid: session?.pid,
				webDriverPort: session?.webDriverPort,
				killed,
			}, {
				state: 'stopped',
				pid: undefined,
				webDriverPort: undefined,
				killed: [89],
			});
		} finally {
			restore();
		}
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

	test('does not kill a preview external session on dispose when stopExternalAppsOnExit is false', async () => {
		const { service, killed } = createService({
			spawn: { pid: 55 },
			config: { [PreBaseConfigKeys.RuntimeStopExternalAppsOnExit]: false },
		});
		service.detect(probe(TAURI_PLAIN));
		const session = await service.start({ launchMode: 'external', purpose: 'preview' });
		assert.strictEqual(session?.state, 'running');
		assert.strictEqual(session.pid, 55);
		service.dispose();
		assert.deepStrictEqual(killed, []);
	});

	test('closes a test-owned managed window on dispose even when stopManagedAppsOnExit is false', async () => {
		const { service, closed } = createService({
			config: { [PreBaseConfigKeys.RuntimeStopManagedAppsOnExit]: false },
		});
		service.detect(probe(ELECTRON_VITE));
		const session = await service.start({ launchMode: 'managed', rendererUrl: 'http://127.0.0.1:5173', purpose: 'test' });
		assert.strictEqual(session?.state, 'testing');
		service.dispose();
		assert.deepStrictEqual(closed, [session?.id]);
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
			assert.strictEqual(clicked.backend, 'webdriver');
		} finally {
			restore();
		}
	});

	test('managed renderer click goes through owned pointer input rather than a synthetic page click', async () => {
		const { service, pointers } = createService({
			config: { [PreBaseConfigKeys.RuntimeEnableDesktopAutomation]: true },
		});
		service.detect(probe(ELECTRON_VITE));
		const session = await service.start({ launchMode: 'managed', rendererUrl: 'http://127.0.0.1:5173', purpose: 'test' });
		assert.strictEqual(session?.state, 'testing');
		const clicked = await service.interactForMagnus({ action: 'click', locator: { by: 'role', role: 'button', name: 'Save' } });
		assert.strictEqual(clicked.ok, true);
		assert.deepStrictEqual(pointers.map(item => (item as { command: string }).command), ['dispatchOwnedPointer']);
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

	test('failed assertions return bounded renderer console evidence with secrets redacted', async () => {
		const rendererConsole = Array.from({ length: 20 }, (_, index) => ({
			level: index === 19 ? 'error' : 'warn',
			text: index === 0
				? 'token=secret-token'
				: index === 1
					? 'password=hunter2'
					: index === 2
						? 'Authorization: Bearer abc123'
						: `ordinary message ${index}`,
			at: index,
		}));
		const { service } = createService({
			evaluate: expression => expression.includes('__prebaseDesktopTest') && expression.includes('run')
				? {
					ok: true,
					match: { name: 'Loading', visible: true, enabled: true },
					title: 'Loading app',
					url: 'http://127.0.0.1:5173/loading',
					console: rendererConsole,
				}
				: true,
		});
		service.detect(probe(ELECTRON_VITE));
		await service.startForMagnus({ framework: 'electron', mode: 'renderer', rendererUrl: 'http://127.0.0.1:5173' });

		const failed = await service.assertForMagnus({
			condition: 'text',
			locator: { by: 'role', role: 'heading', name: 'Dashboard' },
			expected: 'Dashboard',
			timeoutMs: 1,
		});
		const evidence = failed.console as Array<{ level: string; text: string; at: number }>;
		assert.deepStrictEqual({
			ok: failed.ok,
			title: failed.title,
			url: failed.url,
			count: evidence.length,
			first: evidence.slice(0, 3).map(entry => entry.text),
			last: evidence.at(-1),
		}, {
			ok: false,
			title: 'Loading app',
			url: 'http://127.0.0.1:5173/loading',
			count: 20,
			first: ['token=[redacted]', 'password=[redacted]', 'Authorization=[redacted]'],
			last: { level: 'error', text: 'ordinary message 19', at: 19 },
		});
	});

	test('managed test restart keeps the test identity and prior evidence', async () => {
		const { service } = createService();
		service.detect(probe(ELECTRON_VITE));
		const started = await service.startForMagnus({ framework: 'electron', mode: 'renderer', rendererUrl: 'http://127.0.0.1:5173' });
		assert.strictEqual(started.ok, true);
		const originalSessionId = String(started.sessionId);
		const originalTest = started.test as { id?: string; passedSteps?: number } | undefined;
		assert.ok(originalTest?.id);

		const interacted = await service.interactForMagnus({ action: 'fill', locator: { by: 'role', role: 'textbox', name: 'Name' }, value: 'Ada' });
		assert.strictEqual(interacted.ok, true);
		await service.restart();

		const restarted = service.getSessionSummaryForMagnus(originalSessionId);
		const restartedTest = restarted.test as { id?: string; passedSteps?: number; failedSteps?: number; cleanup?: string } | undefined;
		assert.deepStrictEqual({
			ok: restarted.ok,
			sessionId: restarted.sessionId,
			state: restarted.state,
			test: {
				id: restartedTest?.id,
				passedSteps: restartedTest?.passedSteps,
				failedSteps: restartedTest?.failedSteps,
				cleanup: restartedTest?.cleanup,
			},
		}, {
			ok: true,
			sessionId: originalSessionId,
			state: 'testing',
			test: {
				id: originalTest.id,
				passedSteps: 2,
				failedSteps: 0,
				cleanup: 'pending',
			},
		});
	});

	test('records the actual managed inspect duration in test evidence', async () => {
		const { service } = createService({
			evaluate: async expression => {
				if (expression.includes('__prebaseDesktopTest') && expression.includes('run')) {
					await new Promise(resolve => setTimeout(resolve, 20));
					return { ok: true, title: 'Fixture', url: 'http://127.0.0.1:5173', interactive: [] };
				}
				return true;
			},
		});
		service.detect(probe(ELECTRON_VITE));
		await service.startForMagnus({ framework: 'electron', mode: 'renderer', rendererUrl: 'http://127.0.0.1:5173' });

		const inspected = await service.inspectForMagnus();
		const run = Reflect.get(service, '_testRun') as {
			steps: Array<{ index: number; kind: string; action?: string; startedAt: number; durationMs: number; ok: boolean; failure?: string }>;
		};
		assert.deepStrictEqual({
			ok: inspected.ok,
			step: run.steps.at(-1),
		}, {
			ok: true,
			step: {
				index: 0,
				kind: 'inspect',
				action: 'snapshot',
				startedAt: run.steps.at(-1)?.startedAt,
				durationMs: run.steps.at(-1)?.durationMs,
				ok: true,
				failure: undefined,
			},
		});
		assert.ok(run.steps.at(-1)!.durationMs >= 20);
	});

	test('external test restart reconnects automation without replacing the test run', async () => {
		const restore = installReadyWebDriverFetch();
		try {
			const { service, killed, spawns } = createService({ spawn: { pid: 91, webDriverPort: 4445 } });
			service.detect(probe(TAURI_READY));
			const started = await service.startForMagnus({ framework: 'tauri', mode: 'fullApp' });
			assert.strictEqual(started.ok, true);
			const originalSessionId = String(started.sessionId);
			const originalTestId = (started.test as { id?: string } | undefined)?.id;
			assert.ok(originalTestId);
			assert.strictEqual((await service.interactForMagnus({ action: 'click', locator: { by: 'role', role: 'button', name: 'Save' } })).ok, true);

			await service.restart();
			const restarted = service.getSessionSummaryForMagnus();
			assert.notStrictEqual(restarted.sessionId, originalSessionId);
			assert.deepStrictEqual({
				state: restarted.state,
				test: restarted.test,
				killed,
				spawnCount: spawns.length,
				cwds: spawns.map(spawn => spawn.cwd),
			}, {
				state: 'testing',
				test: {
					id: originalTestId,
					framework: 'tauri',
					mode: 'fullApp',
					backend: 'webdriver',
					passedSteps: 2,
					failedSteps: 0,
					duration: (restarted.test as { duration: number }).duration,
					screenshotCount: 0,
					cleanup: 'pending',
					lastFailure: undefined,
				},
				killed: [91],
				spawnCount: 2,
				cwds: ['/app/src-tauri', '/app/src-tauri'],
			});
		} finally {
			restore();
		}
	});

	test('starting a preview after a completed test clears stale test-run evidence', async () => {
		const { service } = createService();
		service.detect(probe(ELECTRON_VITE));
		const tested = await service.startForMagnus({ framework: 'electron', mode: 'renderer', rendererUrl: 'http://127.0.0.1:5173' });
		assert.ok(tested.test);
		await service.stop();

		const preview = await service.start({ launchMode: 'managed', rendererUrl: 'http://127.0.0.1:5173', purpose: 'preview' });
		assert.strictEqual(preview?.state, 'running');
		assert.deepStrictEqual(service.getSessionSummaryForMagnus(preview?.id), {
			ok: true,
			sessionId: preview?.id,
			framework: 'electron',
			mode: 'renderer',
			state: 'running',
			purpose: 'preview',
			backend: 'cdp',
			ownedByPreBase: true,
			setupRequired: false,
			pid: undefined,
			debugPort: undefined,
			webDriverPort: undefined,
			rendererUrl: 'http://127.0.0.1:5173',
			limitations: preview?.profile.capabilities.limitations,
			errorMessage: undefined,
			test: undefined,
		});
	});

	test('a new test session after stop does not reuse the previous test-run identity or steps', async () => {
		const { service } = createService();
		service.detect(probe(ELECTRON_VITE));
		const first = await service.startForMagnus({ framework: 'electron', mode: 'renderer', rendererUrl: 'http://127.0.0.1:5173' });
		const firstId = (first.test as { id?: string } | undefined)?.id;
		assert.ok(firstId);
		assert.strictEqual((await service.interactForMagnus({ action: 'fill', locator: { by: 'role', role: 'textbox', name: 'Name' }, value: 'Ada' })).ok, true);
		await service.stop();

		const second = await service.startForMagnus({ framework: 'electron', mode: 'renderer', rendererUrl: 'http://127.0.0.1:5173' });
		const secondTest = second.test as { id?: string; passedSteps?: number; failedSteps?: number } | undefined;
		assert.notStrictEqual(secondTest?.id, firstId);
		assert.deepStrictEqual({
			passedSteps: secondTest?.passedSteps,
			failedSteps: secondTest?.failedSteps,
		}, {
			passedSteps: 0,
			failedSteps: 0,
		});
	});
});
