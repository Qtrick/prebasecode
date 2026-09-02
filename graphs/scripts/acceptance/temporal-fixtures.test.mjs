import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createCanonicalScaleFixture,
	createLargeFixture,
	expectedRepositoryHeadFileCount,
} from './temporal-fixtures.mjs';

test('canonical-scale fixture HEAD file count includes package.json after one module deletion', () => {
	const fixture = createCanonicalScaleFixture();
	assert.equal(fixture.moduleCount, 9680);
	assert.equal(fixture.expectedModuleFilesRemaining, 9679);
	assert.equal(fixture.expectedHeadFileCount, expectedRepositoryHeadFileCount(9680));
	assert.equal(fixture.files.length, fixture.expectedHeadFileCount);
	assert.ok(fixture.files.includes('package.json'));
	assert.equal(fixture.files.length, 9680);
	assert.ok(fixture.commits >= 50);
});

test('large fixture HEAD file count includes package.json after one module deletion', () => {
	const fixture = createLargeFixture();
	assert.equal(fixture.moduleCount, 336);
	assert.equal(fixture.expectedModuleFilesRemaining, 335);
	assert.equal(fixture.expectedHeadFileCount, expectedRepositoryHeadFileCount(336));
	assert.equal(fixture.files.length, fixture.expectedHeadFileCount);
	assert.ok(fixture.files.includes('package.json'));
	assert.equal(fixture.files.length, 336);
	assert.ok(fixture.commits >= 50);
});
