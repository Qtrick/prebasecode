import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createCanonicalScaleFixture,
	createLargeFixture,
	expectedRepositoryHeadFileCount,
} from './temporal-fixtures.mjs';

function assertHeadContract(fixture, { moduleCount, scale }) {
	assert.equal(fixture.moduleCount, moduleCount);
	assert.equal(fixture.expectedModuleFilesRemaining, moduleCount - 1);
	assert.equal(fixture.expectedHeadFileCount, expectedRepositoryHeadFileCount(moduleCount));
	assert.equal(fixture.files.length, fixture.expectedHeadFileCount);
	assert.ok(fixture.files.includes('package.json'), 'HEAD must retain package.json after module deletion');
	assert.equal(fixture.files.length, moduleCount, 'HEAD file count must match module seed count contract');
	assert.ok(fixture.commits >= 50, 'fixture must include >= 50 commits for scrubber acceptance');
	assert.equal(fixture.scale, scale);
	assert.ok(fixture.head && fixture.head.length >= 40, 'HEAD sha must be recorded');
	assert.ok(fixture.firstParentSummary.includes(fixture.head), 'first-parent summary must reference HEAD');
	assert.ok(fixture.expectedModifiedPath, 'latest commit must modify at least one path');
}

test('canonical-scale fixture HEAD file count includes package.json after one module deletion', () => {
	const fixture = createCanonicalScaleFixture();
	assertHeadContract(fixture, { moduleCount: 9680, scale: 'canonical-scale' });
	assert.equal(fixture.communityCount, 55);
	assert.equal(fixture.perCommunity, 176);
	assert.equal(fixture.communityCount * fixture.perCommunity, 9680);
	assert.ok(fixture.files.every(path => path === 'package.json' || path.startsWith('src/module_')),
		'canonical fixture paths must stay under seeded module layout');
});

test('large fixture HEAD file count includes package.json after one module deletion', () => {
	const fixture = createLargeFixture();
	assertHeadContract(fixture, { moduleCount: 336, scale: 'large' });
	assert.equal(fixture.layerCount, 12);
	assert.equal(fixture.perLayer, 28);
	assert.equal(fixture.layerCount * fixture.perLayer, 336);
	assert.ok(fixture.files.every(path => path === 'package.json' || path.startsWith('src/')),
		'large fixture paths must stay under src/ tree');
});

test('expectedRepositoryHeadFileCount is the single module-count contract helper', () => {
	assert.equal(expectedRepositoryHeadFileCount(9680), 9680);
	assert.equal(expectedRepositoryHeadFileCount(336), 336);
});
