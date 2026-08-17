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

interface LanguageModelToolContribution {
	name: string;
	displayName?: string;
	modelDescription?: string;
	userDescription?: string;
	inputSchema?: Record<string, unknown>;
}

interface CommandContribution {
	command: string;
	title: string;
	category?: string;
}

interface ChatParticipantContribution {
	id: string;
	name: string;
	fullName?: string;
	description?: string;
	isDefault?: boolean;
	modes?: string[];
	when?: string;
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
		chatParticipants?: ChatParticipantContribution[];
		languageModelTools?: LanguageModelToolContribution[];
		commands?: CommandContribution[];
	};
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PRODUCT_PATH = path.join(ROOT, 'product.json');
const MAGNUS_MANIFEST_PATH = path.join(ROOT, 'extensions/prebase-magnus/package.json');
const MAGNUS_SRC_DIR = path.join(ROOT, 'extensions/prebase-magnus/src');
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

// 1. Verify active models enum
const modelEnum = magnusManifest.contributes?.configuration?.properties?.['prebase.magnus.defaultModel']?.enum;
if (!Array.isArray(modelEnum) || !modelEnum.includes('auto') || !modelEnum.includes('gemini-2.5-pro') || !modelEnum.includes('gemini-2.5-flash')) {
	throw new Error('verify:prebase-magnus-manifest: prebase.magnus.defaultModel enum must contain auto, gemini-2.5-pro, and gemini-2.5-flash');
}
if (modelEnum.some(m => m.includes('1.5') || m.includes('2.0'))) {
	throw new Error('verify:prebase-magnus-manifest: prebase.magnus.defaultModel enum must not contain retired 1.5 or 2.0 models');
}

// 2. Verify Chat Participants Default Routing
const participants = magnusManifest.contributes?.chatParticipants;
if (!Array.isArray(participants) || participants.length === 0) {
	throw new Error('verify:prebase-magnus-manifest: chatParticipants must be contributed');
}
const defaultParticipants = participants.filter(p => p.isDefault === true);
if (defaultParticipants.length === 0) {
	throw new Error('verify:prebase-magnus-manifest: at least one chatParticipant must be declared with isDefault: true');
}
const supportedModes = new Set(defaultParticipants.flatMap(p => p.modes || []));
if (!supportedModes.has('ask') || !supportedModes.has('edit')) {
	throw new Error('verify:prebase-magnus-manifest: default chatParticipants must cover at least "ask" and "edit" modes');
}

// 3. Verify Language Model Tools Parity
function extractRegisteredTools(srcDir: string): Set<string> {
	const registeredTools = new Set<string>();
	const files = fs.readdirSync(srcDir, { recursive: true }) as string[];
	const toolRegex = /vscode\.lm\.registerTool\(\s*['"]([^'"]+)['"]/g;

	for (const file of files) {
		if (typeof file === 'string' && file.endsWith('.ts') && !file.endsWith('.d.ts') && !file.endsWith('.test.ts')) {
			const content = fs.readFileSync(path.join(srcDir, file), 'utf8');
			let match: RegExpExecArray | null;
			while ((match = toolRegex.exec(content)) !== null) {
				registeredTools.add(match[1]);
			}
		}
	}
	return registeredTools;
}

const manifestTools = new Set((magnusManifest.contributes?.languageModelTools ?? []).map(t => t.name));
const runtimeTools = extractRegisteredTools(MAGNUS_SRC_DIR);

const missingFromManifest = Array.from(runtimeTools).filter(t => !manifestTools.has(t));
const missingFromRuntime = Array.from(manifestTools).filter(t => !runtimeTools.has(t));

if (missingFromManifest.length > 0) {
	throw new Error(`verify:prebase-magnus-manifest: Runtime tool registered but missing from package.json contributes.languageModelTools: ${missingFromManifest.join(', ')}`);
}
if (missingFromRuntime.length > 0) {
	throw new Error(`verify:prebase-magnus-manifest: Tool contributed in package.json but not registered at runtime: ${missingFromRuntime.join(', ')}`);
}

// 3. Verify Commands Parity
function extractRegisteredCommands(srcDir: string): Set<string> {
	const registeredCommands = new Set<string>();
	const files = fs.readdirSync(srcDir, { recursive: true }) as string[];
	const cmdRegex = /vscode\.commands\.registerCommand\(\s*['"]([^'"]+)['"]/g;

	for (const file of files) {
		if (typeof file === 'string' && file.endsWith('.ts') && !file.endsWith('.d.ts') && !file.endsWith('.test.ts')) {
			const content = fs.readFileSync(path.join(srcDir, file), 'utf8');
			let match: RegExpExecArray | null;
			while ((match = cmdRegex.exec(content)) !== null) {
				registeredCommands.add(match[1]);
			}
		}
	}
	return registeredCommands;
}

const manifestCommands = (magnusManifest.contributes?.commands ?? []).map(c => c.command);
const runtimeCommands = extractRegisteredCommands(MAGNUS_SRC_DIR);

const missingCommandHandlers = manifestCommands.filter(cmd => !runtimeCommands.has(cmd));
if (missingCommandHandlers.length > 0) {
	throw new Error(`verify:prebase-magnus-manifest: Contributed command missing runtime registration handler: ${missingCommandHandlers.join(', ')}`);
}

console.log(`verify:prebase-magnus-manifest: PASS (${extensionProposals.length} proposals, ${runtimeTools.size} tools in exact parity, ${manifestCommands.length} contributed commands verified)`);
