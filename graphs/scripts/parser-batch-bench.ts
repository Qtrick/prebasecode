/**
 * Measures CanonicalGraphAnalyzer outer parseBatchSize candidates.
 * Outer window is Promise.all over N files — not N parser-utility processes.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { CanonicalGraphAnalyzer } from '../src/core/canonical/canonicalGraphAnalyzer.js';
import { NodeCanonicalParseService } from '../src/node/canonicalParseService.js';
import type { IRepositoryContentSource, CancellationTokenLike, ScannedFileInventory } from '../src/core/canonical/contentSource.js';
import type { ScannedFile } from '../src/common/types/graphTypes.js';

class FixtureSource implements IRepositoryContentSource {
	readonly kind = 'working-tree';
	readonly identity = 'parser-batch-bench';
	readonly rootPath = '/bench';
	readonly projectName = 'bench';
	private readonly _files: Map<string, string>;

	constructor(fileCount: number) {
		this._files = new Map();
		for (let i = 0; i < fileCount; i++) {
			const imports = i > 0 ? `import { f${i - 1} } from './f${i - 1}';\n` : '';
			this._files.set(`src/f${i}.ts`, `${imports}export const f${i} = ${i};\nexport function use${i}(x: number) { return x + ${i}; }\n`);
		}
	}

	async listFiles(token?: CancellationTokenLike): Promise<ScannedFileInventory> {
		const files: ScannedFile[] = [];
		for (const relativePath of this._files.keys()) {
			if (token?.isCancellationRequested) {
				break;
			}
			files.push({
				absolutePath: `${this.rootPath}/${relativePath}`,
				relativePath,
				extension: '.ts',
			});
		}
		return { files, isTruncated: false, discoveredCount: files.length, eligibleCount: files.length };
	}

	async readFile(relativePath: string): Promise<string | undefined> {
		return this._files.get(relativePath);
	}
}

function eventLoopLagSample(): Promise<number> {
	const start = Date.now();
	return new Promise(resolve => {
		setImmediate(() => resolve(Date.now() - start));
	});
}

const sizes = [8, 16, 32, 64];
const source = new FixtureSource(240);
const rows = [];

for (const parseBatchSize of sizes) {
	global.gc?.();
	const beforeMem = process.memoryUsage();
	const lags: number[] = [];
	const lagTimer = setInterval(() => {
		void eventLoopLagSample().then(ms => lags.push(ms));
	}, 50);
	const started = Date.now();
	const analyzer = new CanonicalGraphAnalyzer({ parseService: new NodeCanonicalParseService(), parseBatchSize });
	const snapshot = await analyzer.analyze(source);
	const wallMs = Date.now() - started;
	clearInterval(lagTimer);
	const afterMem = process.memoryUsage();
	rows.push({
		parseBatchSize,
		wallMs,
		nodes: snapshot?.nodes.length ?? 0,
		digest: snapshot?.digest ?? '',
		heapDeltaMb: Number(((afterMem.heapUsed - beforeMem.heapUsed) / 1024 / 1024).toFixed(2)),
		rssMb: Number((afterMem.rss / 1024 / 1024).toFixed(1)),
		eventLoopLagP50Ms: lags.length ? [...lags].sort((a, b) => a - b)[Math.floor(lags.length / 2)] : 0,
		note: 'Outer Promise.all window only; one Node parse service, not N parser utility processes.',
	});
}

const outDir = join(process.cwd(), 'reports/graph-acceptance/phase-3.17/parser');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'batch.json'), JSON.stringify({ measuredAt: new Date().toISOString(), rows }, null, 2));
console.log(JSON.stringify({ ok: true, rows }, null, 2));
