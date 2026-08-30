#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
if (process.platform !== 'darwin') {
	console.log('[live-activity] skip native compile on', process.platform);
	process.exit(0);
}

const electronVersion = '42.8.0';
const args = [
	'node-gyp',
	'rebuild',
	'--directory', here,
	`--target=${electronVersion}`,
	'--arch=arm64',
	'--dist-url=https://electronjs.org/headers',
	'--runtime=electron',
];
const result = spawnSync('npx', args, { cwd: here, stdio: 'inherit', env: { ...process.env, npm_config_runtime: 'electron', npm_config_target: electronVersion } });
if (result.status !== 0) {
	process.exit(result.status ?? 1);
}
const addon = join(here, 'build/Release/prebase_live_activity.node');
if (!existsSync(addon)) {
	console.error('[live-activity] missing', addon);
	process.exit(1);
}
console.log('[live-activity] compiled', addon);
