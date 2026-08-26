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

const CARGO_DEP = `tauri-plugin-wdio = { version = "1", optional = true }
tauri-plugin-wdio-webdriver = { version = "1", optional = true }
`;

const CARGO_FEATURE = `prebase-testing = ["dep:tauri-plugin-wdio", "dep:tauri-plugin-wdio-webdriver"]
`;

const RUST_PLUGIN = `#[cfg(all(debug_assertions, feature = "prebase-testing"))]
{
	builder = builder
		.plugin(tauri_plugin_wdio::init())
		.plugin(tauri_plugin_wdio_webdriver::init());
}
`;

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
			reason: 'Add optional WebDriver plugins behind the prebase-testing Cargo feature. Do not pass that feature to release builds. Cargo does not honor cfg(debug_assertions) in [dependencies].',
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
	if (capabilities && !capabilities.includes('wdio-webdriver:default')) {
		changes.push({
			path: input.capabilitiesPath,
			kind: 'update',
			preview: '"wdio:default", "wdio-webdriver:default"',
			reason: 'Grant the debug WebDriver ACL so the embedded server can load.',
		});
	}

	return {
		appRoot: input.appRoot,
		productionSafe: true,
		changes,
		removeInstructions: 'Remove the optional tauri-plugin-wdio* dependencies, the prebase-testing feature, the cfg plugin registration, and the wdio-webdriver:default permission. Never pass --features prebase-testing to tauri build or cargo --release.',
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

export function applyCapabilitiesTestingPermission(jsonText: string): string | { error: string } {
	let parsed: { permissions?: string[] };
	try {
		parsed = JSON.parse(jsonText) as { permissions?: string[] };
	} catch {
		return { error: 'capabilities JSON is not valid.' };
	}
	const permissions = Array.isArray(parsed.permissions) ? [...parsed.permissions] : [];
	for (const permission of ['wdio:default', 'wdio-webdriver:default']) {
		if (!permissions.includes(permission)) {
			permissions.push(permission);
		}
	}
	parsed.permissions = permissions;
	return `${JSON.stringify(parsed, null, 2)}\n`;
}
