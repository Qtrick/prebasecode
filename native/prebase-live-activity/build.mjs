import { execSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
if (process.platform !== 'darwin') {
	console.log('[live-activity] skip native compile on', process.platform);
	process.exit(0);
}

function findNodeGyp() {
	try {
		const npmRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
		const candidate = join(npmRoot, 'npm/node_modules/node-gyp/bin/node-gyp.js');
		if (existsSync(candidate)) {
			return candidate;
		}
	} catch {
		/* fallback */
	}
	return 'node-gyp';
}

const electronVersion = '42.8.0';
const nodeGyp = findNodeGyp();
const pythonBin = existsSync('/usr/bin/python3') ? '/usr/bin/python3' : (existsSync('/Applications/Xcode.app/Contents/Developer/usr/bin/python3') ? '/Applications/Xcode.app/Contents/Developer/usr/bin/python3' : 'python3');

const isJs = nodeGyp.endsWith('.js');
const command = isJs ? process.execPath : (nodeGyp === 'node-gyp' ? 'npx' : nodeGyp);
const args = isJs ? [nodeGyp] : (command === 'npx' ? ['--no-install', 'node-gyp'] : []);
args.push(
	'rebuild',
	'--directory', here,
	`--target=${electronVersion}`,
	'--arch=arm64',
	'--dist-url=https://electronjs.org/headers',
	'--runtime=electron',
	`--python=${pythonBin}`,
);

const result = spawnSync(command, args, { cwd: here, stdio: 'inherit', env: { ...process.env, npm_config_runtime: 'electron', npm_config_target: electronVersion, PYTHON: pythonBin } });
if (result.status !== 0) {
	process.exit(result.status ?? 1);
}
const addon = join(here, 'build/Release/prebase_live_activity.node');
if (!existsSync(addon)) {
	console.error('[live-activity] missing', addon);
	process.exit(1);
}
console.log('[live-activity] compiled', addon);

