/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface TauriTestingFileChange {
	path: string;
	kind: 'create' | 'update';
	preview: string;
	reason: string;
}

export interface TauriTestingSetupPreview {
	appRoot: string;
	productionSafe: true;
	changes: TauriTestingFileChange[];
	removeInstructions: string;
}

export interface TauriTestingWrite<Resource> {
	resource: Resource;
	before?: string;
	after: string;
}

export type TauriTestingTransactionResult =
	| { ok: true }
	| { ok: false; reason: string; rollbackErrors: string[] };

export interface TauriTestingSetupState {
	dependencyPresent: boolean;
	featurePresent: boolean;
	featureIncludesDriver: boolean;
	pluginRegistered: boolean;
	permissionPresent: boolean;
	ready: boolean;
}

export function inspectTauriTestingSetup(input: {
	cargoToml?: string;
	rustEntry?: string;
	capabilitiesJson?: string;
}): TauriTestingSetupState {
	const cargo = input.cargoToml ?? '';
	const rust = input.rustEntry ?? '';
	const capabilities = input.capabilitiesJson ?? '';
	const dependencyPresent = /(?:^|\n)\s*tauri-plugin-wdio-webdriver\s*[=\{]/m.test(cargo);
	const featurePresent = /(?:^|\n)\s*prebase-testing\s*=/m.test(cargo);
	const featureMembers = cargo.match(/(?:^|\n)\s*prebase-testing\s*=\s*\[([^\]]*)\]/m)?.[1] ?? '';
	const featureIncludesDriver = featureMembers.includes('tauri-plugin-wdio-webdriver');
	const pluginRegistered = rust.includes('tauri_plugin_wdio_webdriver');
	const permissionPresent = capabilities.includes('wdio-webdriver:default');
	return {
		dependencyPresent,
		featurePresent,
		featureIncludesDriver,
		pluginRegistered,
		permissionPresent,
		ready: dependencyPresent && featurePresent && featureIncludesDriver && pluginRegistered && permissionPresent,
	};
}

export async function applyTauriTestingTransaction<Resource>(
	writes: readonly TauriTestingWrite<Resource>[],
	io: { write(resource: Resource, value: string): Promise<void>; remove(resource: Resource): Promise<void> },
): Promise<TauriTestingTransactionResult> {
	const completed: TauriTestingWrite<Resource>[] = [];
	try {
		for (const write of writes) {
			await io.write(write.resource, write.after);
			completed.push(write);
		}
		return { ok: true };
	} catch (error) {
		const rollbackErrors: string[] = [];
		for (const write of completed.reverse()) {
			try {
				if (write.before === undefined) {
					await io.remove(write.resource);
				} else {
					await io.write(write.resource, write.before);
				}
			} catch (rollbackError) {
				rollbackErrors.push(rollbackError instanceof Error ? rollbackError.message : String(rollbackError));
			}
		}
		return {
			ok: false,
			reason: error instanceof Error ? error.message : String(error),
			rollbackErrors,
		};
	}
}

const CARGO_DEP = `tauri-plugin-wdio-webdriver = { version = "1", optional = true }
`;

const CARGO_FEATURE = `prebase-testing = ["dep:tauri-plugin-wdio-webdriver"]
`;

const RUST_PLUGIN = `#[cfg(all(debug_assertions, feature = "prebase-testing"))]
{
	builder = builder.plugin(tauri_plugin_wdio_webdriver::init());
}
`;

const CAPABILITIES_JSON = {
	identifier: 'prebase-testing',
	description: 'Debug-only embedded WebDriver access for PreBase desktop testing.',
	windows: ['main'],
	permissions: ['wdio-webdriver:default'],
};

export function previewTauriTestingSetup(input: {
	appRoot: string;
	cargoToml: string;
	rustEntry: string;
	capabilitiesJson?: string;
	rustEntryPath: string;
	cargoPath: string;
	capabilitiesPath: string;
}): TauriTestingSetupPreview | { error: string } {
	if (!input.cargoToml.includes('[package]')) {
		return { error: 'Cargo.toml does not look like a Tauri package manifest.' };
	}
	if (!/tauri\s*=/.test(input.cargoToml) && !/tauri\s*\{/.test(input.cargoToml)) {
		return { error: 'Cargo.toml has no tauri crate; refusing to add testing plugins.' };
	}
	if (!/tauri::Builder/.test(input.rustEntry) && !/Builder::default\(\)/.test(input.rustEntry)) {
		return { error: 'Rust entry does not contain a Tauri Builder; refusing unsafe source edits.' };
	}

	const changes: TauriTestingFileChange[] = [];
	if (!input.cargoToml.includes('tauri-plugin-wdio-webdriver')) {
		changes.push({
			path: input.cargoPath,
			kind: 'update',
			preview: `${CARGO_DEP}\n[features]\n${CARGO_FEATURE}`,
			reason: 'Add the optional embedded WebDriver behind the prebase-testing Cargo feature. Do not pass that feature to release builds. Cargo does not honor cfg(debug_assertions) in [dependencies].',
		});
	}
	if (!input.rustEntry.includes('tauri_plugin_wdio_webdriver')) {
		changes.push({
			path: input.rustEntryPath,
			kind: 'update',
			preview: RUST_PLUGIN,
			reason: 'Register plugins only when debug_assertions and feature prebase-testing are both enabled.',
		});
	}
	const capabilities = input.capabilitiesJson ?? '';
	if (!capabilities) {
		changes.push({
			path: input.capabilitiesPath,
			kind: 'create',
			preview: JSON.stringify(CAPABILITIES_JSON, null, 2),
			reason: 'Create the minimal desktop capability required by the embedded WebDriver plugin.',
		});
	} else if (!capabilities.includes('wdio-webdriver:default')) {
		changes.push({
			path: input.capabilitiesPath,
			kind: 'update',
			preview: '"wdio-webdriver:default"',
			reason: 'Grant the debug WebDriver ACL so the embedded server can load.',
		});
	}

	return {
		appRoot: input.appRoot,
		productionSafe: true,
		changes,
		removeInstructions: 'Remove the optional tauri-plugin-wdio-webdriver dependency, the prebase-testing feature, the cfg plugin registration, and the wdio-webdriver:default permission. Never pass --features prebase-testing to a release build.',
	};
}

export function tauriTestingCandidatePaths(cargoTomlPath: string): { rustEntries: string[]; capabilities: string[] } {
	const dir = cargoTomlPath.includes('/') ? cargoTomlPath.slice(0, cargoTomlPath.lastIndexOf('/')) : '';
	const prefix = dir ? `${dir}/` : '';
	return {
		rustEntries: [`${prefix}src/lib.rs`, `${prefix}src/main.rs`],
		capabilities: [`${prefix}capabilities/default.json`, `${prefix}capabilities/desktop.json`],
	};
}

const CARGO_DEPENDENCIES_HEADER = /(?:^|\n)\[dependencies\][^\n]*\n/;
const CARGO_FEATURES_HEADER = /(?:^|\n)\[features\][^\n]*\n/;

export function applyCargoTestingDependencies(cargoToml: string): string {
	if (cargoToml.includes('tauri-plugin-wdio-webdriver')) {
		return cargoToml;
	}
	let next = cargoToml.endsWith('\n') ? cargoToml : `${cargoToml}\n`;
	if (!CARGO_DEPENDENCIES_HEADER.test(next)) {
		next += `\n[dependencies]\n`;
	}
	next = next.replace(CARGO_DEPENDENCIES_HEADER, match => `${match}${CARGO_DEP}`);
	if (!CARGO_FEATURES_HEADER.test(next)) {
		next += `\n[features]\n`;
	}
	if (!next.includes('prebase-testing')) {
		next = next.replace(CARGO_FEATURES_HEADER, match => `${match}${CARGO_FEATURE}`);
	}
	return next.endsWith('\n') ? next : `${next}\n`;
}

export function applyRustTestingPlugins(rustSource: string): string | { error: string } {
	if (rustSource.includes('tauri_plugin_wdio_webdriver')) {
		return rustSource;
	}
	let source = rustSource;
	if (/let\s+builder\s*=\s*tauri::Builder::default\(\)/.test(source) && !/let\s+mut\s+builder\s*=/.test(source)) {
		source = source.replace(/let\s+builder\s*=\s*tauri::Builder::default\(\)/, 'let mut builder = tauri::Builder::default()');
	}
	if (!/let\s+mut\s+builder\s*=\s*tauri::Builder::default\(\)/.test(source)) {
		const replaced = source.replace(
			/tauri::Builder::default\(\)/,
			`{
	let mut builder = tauri::Builder::default();
	${RUST_PLUGIN}
	builder
}`,
		);
		if (replaced === source) {
			return { error: 'Could not find a safe Tauri Builder insertion point.' };
		}
		return replaced;
	}
	return source.replace(
		/(let\s+mut\s+builder\s*=\s*tauri::Builder::default\(\);)/,
		`$1\n\t${RUST_PLUGIN}`,
	);
}

export function applyCapabilitiesTestingPermission(jsonText?: string): string | { error: string } {
	if (!jsonText) {
		return `${JSON.stringify(CAPABILITIES_JSON, null, 2)}\n`;
	}
	let parsed: { permissions?: string[] };
	try {
		parsed = JSON.parse(jsonText) as { permissions?: string[] };
	} catch {
		return { error: 'capabilities JSON is not valid.' };
	}
	const permissions = Array.isArray(parsed.permissions) ? [...parsed.permissions] : [];
	for (const permission of ['wdio-webdriver:default']) {
		if (!permissions.includes(permission)) {
			permissions.push(permission);
		}
	}
	parsed.permissions = permissions;
	return `${JSON.stringify(parsed, null, 2)}\n`;
}
