#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Ensures product.json (and optional web workbench embeds) use Open VSX — never the
 * copyrighted Visual Studio Marketplace endpoints.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FORBIDDEN = [
	'marketplace.visualstudio.com',
	'marketplace.vsallin.net',
	'vscode.blob.core.windows.net/gallery',
	'gallerycdn.vsassets.io',
	'az764295.vo.msecnd.net/extensions',
];

function assertNoForbidden(label, text) {
	for (const needle of FORBIDDEN) {
		if (text.includes(needle)) {
			console.error(`FAIL ${label}: contains forbidden gallery host "${needle}"`);
			process.exitCode = 1;
		}
	}
}

const productPath = path.join(root, 'product.json');
const product = JSON.parse(fs.readFileSync(productPath, 'utf8'));
const gallery = product.extensionsGallery || {};
assertNoForbidden('product.json', JSON.stringify(gallery));

if (!/open-vsx\.org/i.test(gallery.serviceUrl || '')) {
	console.error('FAIL product.json: extensionsGallery.serviceUrl must be Open VSX');
	process.exitCode = 1;
}
if (!/open-vsx\.org/i.test(gallery.itemUrl || '')) {
	console.error('FAIL product.json: extensionsGallery.itemUrl must be Open VSX');
	process.exitCode = 1;
}
if (!/open-vsx\.org/i.test(gallery.extensionUrlTemplate || '')) {
	console.error('FAIL product.json: extensionsGallery.extensionUrlTemplate must be Open VSX');
	process.exitCode = 1;
}

const trusted = product.linkProtectionTrustedDomains || [];
if (!trusted.some(d => /open-vsx\.org/i.test(d))) {
	console.error('FAIL product.json: linkProtectionTrustedDomains must include open-vsx.org');
	process.exitCode = 1;
}

for (const rel of ['build/vite/workbench-vite.html', 'build/rspack/workbench-rspack.html']) {
	const p = path.join(root, rel);
	if (!fs.existsSync(p)) {
		continue;
	}
	const html = fs.readFileSync(p, 'utf8');
	assertNoForbidden(rel, html);
	if (!/open-vsx\.org/i.test(html)) {
		console.error(`FAIL ${rel}: expected Open VSX gallery embed`);
		process.exitCode = 1;
	}
}

if (process.exitCode) {
	process.exit(process.exitCode);
}
console.log('OK: extension gallery is Open VSX (no Microsoft Marketplace URLs)');
