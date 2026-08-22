#!/usr/bin/env node
/**
 * Graph unit tests without full IDE transpile.
 * Runs Mocha on graph-owned sources via Node strip-types + graphs-test-loader (.js → .ts).
 */
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const MOCHA = path.join(REPO_ROOT, 'node_modules/mocha/bin/mocha.js');
const REGISTER = path.join(__dirname, 'graphs-test-register.mjs');
const SETUP = path.join(__dirname, 'graphs-test-setup.mjs');

function runMochaOnSource(testRelPath) {
	const testAbs = path.join(REPO_ROOT, testRelPath);
	return spawnSync(
		process.execPath,
		['--experimental-strip-types', `--import=${SETUP}`, `--import=${REGISTER}`, MOCHA, testAbs, '--ui', 'tdd', '--timeout', '5000'],
		{ cwd: REPO_ROOT, stdio: 'inherit' }
	).status ?? 1;
}

const tests = [
	'graphs/src/tests/unit/architecturePick.test.ts',
	'graphs/src/tests/unit/dependencyDepth.test.ts',
	'graphs/src/tests/unit/graphEditor3dInteraction.test.ts',
	'graphs/src/tests/unit/layoutOrganization.test.ts',
	'graphs/src/tests/unit/networkLayout.test.ts',
	'graphs/src/tests/unit/graphOwnershipBoundary.test.ts',
	'graphs/src/tests/unit/graphIgnoreScanning.test.ts',
	'graphs/src/tests/unit/graphDescriptionService.test.ts',
	'graphs/src/tests/unit/pureSha256.test.ts',
	'graphs/src/tests/unit/canonicalGraphAnalyzer.test.ts',
	'graphs/src/tests/unit/canonicalParserWorkerService.test.ts',
	'graphs/src/tests/unit/canonicalProjection.test.ts',
	'graphs/src/tests/unit/canonicalGraphDiff.test.ts',
	'graphs/src/tests/unit/canonicalQueryIndex.test.ts',
	'graphs/src/tests/unit/gitHistoryService.test.ts',
	'graphs/src/tests/unit/workbenchGitHistoryService.test.ts',
	'graphs/src/tests/unit/productionGitBridgeContract.test.ts',
	'graphs/src/tests/unit/gitTreeHistoricalAnalysis.test.ts',
	'graphs/src/tests/unit/gitBridgeE2E.test.ts',
	'graphs/src/tests/unit/temporalLineage.test.ts',
	'graphs/src/tests/unit/temporalDelta.test.ts',
	'graphs/src/tests/unit/temporalRepositoryRuntime.test.ts',
	'graphs/src/tests/unit/incrementalAnalysis.test.ts',
	'graphs/src/tests/unit/sqliteTemporalStore.test.ts',
	'graphs/src/tests/unit/temporalSparsePersistence.test.ts',
	'graphs/src/tests/unit/temporalBoundedIngestion.test.ts',
	'graphs/src/tests/unit/temporalIngestionE2E.test.ts',
	'graphs/src/tests/unit/temporalStructuralDiff.test.ts',
	'graphs/src/tests/unit/temporalLayoutEngine.test.ts',
	'graphs/src/tests/unit/workbenchTemporalViewService.test.ts',
];

for (const test of tests) {
	const code = runMochaOnSource(test);
	if (code !== 0) {
		process.exit(code);
	}
}

process.exit(0);
