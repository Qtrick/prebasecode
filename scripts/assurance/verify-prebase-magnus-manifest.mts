/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

interface ProductManifest {
	extensionEnabledApiProposals?: Record<string, string[]>;
}

interface ExtensionManifest {
	enabledApiProposals?: string[];
	contributes?: {
		configuration?: {
			properties?: {
				'prebase.magnus.defaultModel'?: {
					enum?: string[];
					enumDescriptions?: string[];
				};
			};
		};
	};
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PRODUCT_PATH = path.join(ROOT, 'product.json');
const MAGNUS_MANIFEST_PATH = path.join(ROOT, 'extensions/prebase-magnus/package.json');
const MAGNUS_EXTENSION_ID = 'prebase.magnus';
const REQUIRED_PROPOSAL = 'findTextInFiles';

const product = JSON.parse(fs.readFileSync(PRODUCT_PATH, 'utf8')) as ProductManifest;
const magnusManifest = JSON.parse(fs.readFileSync(MAGNUS_MANIFEST_PATH, 'utf8')) as ExtensionManifest;
const productProposals = product.extensionEnabledApiProposals?.[MAGNUS_EXTENSION_ID];
const extensionProposals = magnusManifest.enabledApiProposals;

if (!Array.isArray(productProposals)) {
	throw new Error(`verify:prebase-magnus-manifest: product proposal allowlist missing for ${MAGNUS_EXTENSION_ID}`);
}
if (!Array.isArray(extensionProposals)) {
	throw new Error('verify:prebase-magnus-manifest: Magnus enabledApiProposals missing');
}
if (!extensionProposals.includes(REQUIRED_PROPOSAL)) {
	throw new Error(`verify:prebase-magnus-manifest: Magnus must declare ${REQUIRED_PROPOSAL}`);
}

const productSet = new Set(productProposals);
const extensionSet = new Set(extensionProposals);
const missingFromProduct = extensionProposals.filter(proposal => !productSet.has(proposal));
const missingFromExtension = productProposals.filter(proposal => !extensionSet.has(proposal));

if (missingFromProduct.length || missingFromExtension.length) {
	throw new Error(`verify:prebase-magnus-manifest: proposal allowlists differ (missing from product: ${missingFromProduct.join(', ') || 'none'}; missing from extension: ${missingFromExtension.join(', ') || 'none'})`);
}

// Verify active models enum
const modelEnum = magnusManifest.contributes?.configuration?.properties?.['prebase.magnus.defaultModel']?.enum;
if (!Array.isArray(modelEnum) || !modelEnum.includes('auto') || !modelEnum.includes('gemini-2.5-pro') || !modelEnum.includes('gemini-2.5-flash')) {
	throw new Error('verify:prebase-magnus-manifest: prebase.magnus.defaultModel enum must contain auto, gemini-2.5-pro, and gemini-2.5-flash');
}
if (modelEnum.some(m => m.includes('1.5') || m.includes('2.0'))) {
	throw new Error('verify:prebase-magnus-manifest: prebase.magnus.defaultModel enum must not contain retired 1.5 or 2.0 models');
}

console.log(`verify:prebase-magnus-manifest: PASS (${extensionProposals.length} synchronized proposals, active models validated)`);

