/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
	ModelCapabilityFlags,
	ModelReleaseChannel,
	ModelTier,
	ModelVisibility,
	ModelWorkload,
	NormalizedAIModel,
} from './aiTypes';

export interface IModelPolicy {
	readonly providerId: string;

	classify(model: NormalizedAIModel): NormalizedAIModel;

	curateConsumerCatalog(models: readonly NormalizedAIModel[]): NormalizedAIModel[];

	resolveAuto(catalog: readonly NormalizedAIModel[], workload?: ModelWorkload): string;

	resolveWorkloadModel(catalog: readonly NormalizedAIModel[], workload: ModelWorkload): string;

	isMigrationRequired(modelId: string, consumerCatalog: readonly NormalizedAIModel[]): boolean;

	migrateSavedModel(modelId: string, consumerCatalog: readonly NormalizedAIModel[]): string;

	formatDiagnostics(rawCatalog: readonly NormalizedAIModel[]): Record<string, unknown>;
}

/**
 * Policy for Google Gemini models.
 * Enforces consumer curation: hides preview, experimental, flash-lite, aliases, and specialized models.
 * Exposes Auto + small curated set of stable Flash & Pro models.
 */
export class GeminiModelPolicy implements IModelPolicy {
	readonly providerId = 'gemini';

	private static readonly SPECIALIZED_PATTERNS = [
		'embedding',
		'aqa',
		'imagen',
		'veo',
		'tts',
		'live',
		'robotics',
		'bison',
		'gemma',
		'computer-use',
		'deep-research',
		'antigravity',
		'custom-tools',
		'audio',
		'image',
	];

	classify(model: NormalizedAIModel): NormalizedAIModel {
		const rawId = model.id.toLowerCase().replace(/^models\//, '');
		const displayName = model.displayName || model.id;

		// Determine release channel
		let releaseChannel: ModelReleaseChannel = 'stable';
		if (/-(1\.0|1\.5)/i.test(rawId) || /deprecated/i.test(rawId)) {
			releaseChannel = 'stable'; // legacy stable version
		} else if (rawId.endsWith('-latest')) {
			releaseChannel = 'latest-alias';
		} else if (/-(exp\d*|experimental)/i.test(rawId) || /experimental/i.test(displayName)) {
			releaseChannel = 'experimental';
		} else if (/-(preview(-\d{4})?|_preview)/i.test(rawId) || /preview/i.test(displayName)) {
			releaseChannel = 'preview';
		} else if (/eap|early-access/i.test(rawId) || /eap/i.test(displayName)) {
			releaseChannel = 'early-access';
		}

		// Check for specialized patterns
		const isSpecialized = GeminiModelPolicy.SPECIALIZED_PATTERNS.some(p => rawId.includes(p) || displayName.toLowerCase().includes(p));
		const isFlashLite = rawId.includes('flash-lite') || displayName.toLowerCase().includes('flash-lite') || rawId.includes('flash_lite');
		const isFlash = !isFlashLite && (rawId.includes('flash') || displayName.toLowerCase().includes('flash'));
		const isPro = rawId.includes('pro') || displayName.toLowerCase().includes('pro');
		const isDeprecated = /-(1\.0|1\.5)/i.test(rawId);

		// Determine tier
		let tier: ModelTier = 'custom';
		if (isFlashLite) {
			tier = 'lite';
		} else if (isFlash) {
			tier = 'flash';
		} else if (isPro) {
			tier = 'pro';
		}

		// Workloads
		const workloads: ModelWorkload[] = [];
		if (isSpecialized) {
			if (rawId.includes('tts') || rawId.includes('live') || rawId.includes('audio')) {
				workloads.push('audio', 'media');
			} else if (rawId.includes('imagen') || rawId.includes('veo') || rawId.includes('image')) {
				workloads.push('media');
			} else if (rawId.includes('embedding') || rawId.includes('aqa')) {
				workloads.push('embedding');
			} else if (rawId.includes('deep-research') || rawId.includes('research')) {
				workloads.push('research');
			} else if (rawId.includes('computer-use')) {
				workloads.push('computer-use');
			} else {
				workloads.push('specialized');
			}
		} else {
			if (isFlashLite) {
				workloads.push('fast-agent', 'description');
			} else if (isFlash) {
				workloads.push('general-agent', 'fast-agent', 'description');
			} else if (isPro) {
				workloads.push('general-agent', 'deep-reasoning');
			} else {
				workloads.push('general-agent');
			}
		}

		// Capabilities
		const supportsGeneration = model.capabilities?.textGeneration ?? true;
		const capabilities: ModelCapabilityFlags = {
			textGeneration: supportsGeneration,
			streaming: model.capabilities?.streaming ?? true,
			functionCalling: supportsGeneration && !isSpecialized && !isDeprecated,
			multimodalInput: !rawId.includes('text-only'),
			structuredOutput: supportsGeneration && !isSpecialized && !isDeprecated,
			thinkingProtocol: rawId.includes('thinking') || rawId.includes('reasoning'),
			agentCompatible: supportsGeneration && !isSpecialized && !isDeprecated && releaseChannel === 'stable' && (isFlash || isPro),
			descriptionCompatible: supportsGeneration && !isSpecialized && !isDeprecated && releaseChannel === 'stable',
		};

		// Consumer visibility & selectable determination
		let visibility: ModelVisibility = 'hidden';
		let hiddenReason: string | undefined;

		if (isDeprecated) {
			visibility = 'hidden';
			hiddenReason = 'Deprecated legacy generation';
		} else if (isSpecialized) {
			visibility = 'hidden';
			hiddenReason = 'Specialized / non-general workload';
		} else if (releaseChannel === 'preview') {
			visibility = 'hidden';
			hiddenReason = 'Preview model (hidden from consumer catalog)';
		} else if (releaseChannel === 'experimental' || releaseChannel === 'early-access') {
			visibility = 'hidden';
			hiddenReason = 'Experimental / EAP release';
		} else if (releaseChannel === 'latest-alias') {
			visibility = 'hidden';
			hiddenReason = 'Dynamic latest alias (pinned version required)';
		} else if (isFlashLite) {
			visibility = 'internal';
			hiddenReason = 'Internal auxiliary model (Flash-Lite hidden from consumer reasoning selector)';
		} else if (releaseChannel === 'stable' && (isFlash || isPro)) {
			// Determine if recommended
			const isFlagship = /gemini-(3\.7-flash|2\.5-pro|2\.5-flash|3\.6-flash)/i.test(rawId);
			visibility = isFlagship ? 'recommended' : 'consumer';
		}

		const consumerSelectable = visibility === 'recommended' || visibility === 'consumer';
		const autoEligible = consumerSelectable && capabilities.agentCompatible && releaseChannel === 'stable';
		const descriptionEligible = capabilities.descriptionCompatible && releaseChannel === 'stable' && (isFlash || isFlashLite);

		return {
			...model,
			id: rawId,
			providerId: this.providerId,
			family: 'gemini',
			releaseChannel,
			workloads,
			visibility,
			tier,
			consumerSelectable,
			autoEligible,
			descriptionEligible,
			deprecated: isDeprecated,
			hiddenReason,
			capabilities,
		};
	}

	curateConsumerCatalog(models: readonly NormalizedAIModel[]): NormalizedAIModel[] {
		const classified = models.map(m => this.classify(m));
		const consumerModels = classified.filter(m => m.consumerSelectable);

		// Deduplicate by ID
		const seen = new Set<string>();
		const unique: NormalizedAIModel[] = [];
		for (const m of consumerModels) {
			if (!seen.has(m.id)) {
				seen.add(m.id);
				unique.push(m);
			}
		}

		// Sort models in a curated intentional order:
		// 1. Highest version stable Flash models (e.g. gemini-3.7-flash, gemini-3.6-flash, gemini-3.5-flash)
		// 2. Stable Pro models (e.g. gemini-3.1-pro if stable, gemini-2.5-pro)
		// 3. Proven fallback Flash models (e.g. gemini-2.5-flash)
		unique.sort((a, b) => {
			const score = (m: NormalizedAIModel) => {
				let s = 0;
				if (m.visibility === 'recommended') {s += 100;}
				if (m.id.startsWith('gemini-3.7-flash')) {s += 90;}
				else if (m.id.startsWith('gemini-3.6-flash')) {s += 80;}
				else if (m.id.startsWith('gemini-3.5-flash')) {s += 70;}
				else if (m.id.startsWith('gemini-2.5-pro')) {s += 60;}
				else if (m.id.startsWith('gemini-2.5-flash')) {s += 50;}
				else if (m.tier === 'flash') {s += 30;}
				else if (m.tier === 'pro') {s += 20;}
				return s;
			};
			return score(b) - score(a);
		});

		// Limit curated list to top recommended models (Auto + 2-4 models)
		const topCurated = unique.slice(0, 4);

		// Resolve auto target to generate clean label
		const autoTargetId = this.resolveAuto(topCurated);
		const autoTargetModel = topCurated.find(m => m.id === autoTargetId) || topCurated[0];
		const autoTargetName = autoTargetModel?.displayName || autoTargetId;

		const autoModel: NormalizedAIModel = {
			id: 'auto',
			name: 'Auto',
			displayName: 'Auto',
			description: `Recommended default (currently ${autoTargetName}).`,
			inputTokenLimit: autoTargetModel?.inputTokenLimit || 1_000_000,
			outputTokenLimit: autoTargetModel?.outputTokenLimit || 65_536,
			capabilities: {
				textGeneration: true,
				streaming: true,
				functionCalling: true,
				multimodalInput: true,
				structuredOutput: true,
				thinkingProtocol: false,
				agentCompatible: true,
				descriptionCompatible: true,
			},
			providerId: this.providerId,
			family: 'gemini',
			releaseChannel: 'stable',
			workloads: ['general-agent', 'fast-agent'],
			visibility: 'recommended',
			tier: 'flash',
			consumerSelectable: true,
			autoEligible: true,
			descriptionEligible: true,
			isAuto: true,
		};

		return [autoModel, ...topCurated];
	}

	resolveAuto(catalog: readonly NormalizedAIModel[], workload?: ModelWorkload): string {
		if (workload && workload !== 'general-agent' && workload !== 'fast-agent') {
			return this.resolveWorkloadModel(catalog, workload);
		}

		const classified = catalog.map(m => m.releaseChannel ? m : this.classify(m));
		const eligible = classified.filter(m => m.id !== 'auto' && m.autoEligible && m.consumerSelectable);

		if (eligible.length === 0) {
			return 'gemini-2.5-flash';
		}

		// Flash hierarchy: 3.7-flash > 3.6-flash > 3.5-flash > 2.5-flash > 2.5-pro > first eligible
		const flash37 = eligible.find(m => m.id === 'gemini-3.7-flash' || m.id.startsWith('gemini-3.7-flash'));
		if (flash37) {return flash37.id;}

		const flash36 = eligible.find(m => m.id === 'gemini-3.6-flash' || m.id.startsWith('gemini-3.6-flash'));
		if (flash36) {return flash36.id;}

		const flash35 = eligible.find(m => m.id === 'gemini-3.5-flash' || m.id.startsWith('gemini-3.5-flash'));
		if (flash35) {return flash35.id;}

		const flash25 = eligible.find(m => m.id === 'gemini-2.5-flash');
		if (flash25) {return flash25.id;}

		const pro25 = eligible.find(m => m.id === 'gemini-2.5-pro');
		if (pro25) {return pro25.id;}

		return eligible[0].id;
	}

	resolveWorkloadModel(catalog: readonly NormalizedAIModel[], workload: ModelWorkload): string {
		const classified = catalog.map(m => m.releaseChannel ? m : this.classify(m));

		switch (workload) {
			case 'description': {
				// Fast stable description-compatible model (Flash / Flash-Lite stable only)
				const eligible = classified.filter(m => m.id !== 'auto' && m.descriptionEligible && m.releaseChannel === 'stable');
				// Prefer 3.7-flash > 3.6-flash > 3.5-flash > 2.5-flash
				const flash37 = eligible.find(m => m.id === 'gemini-3.7-flash');
				if (flash37) {return flash37.id;}
				const flash36 = eligible.find(m => m.id === 'gemini-3.6-flash');
				if (flash36) {return flash36.id;}
				const flash25 = eligible.find(m => m.id === 'gemini-2.5-flash');
				if (flash25) {return flash25.id;}
				return eligible[0]?.id || 'gemini-2.5-flash';
			}

			case 'deep-reasoning': {
				// Highest quality stable Pro model
				const proModels = classified.filter(m => m.id !== 'auto' && m.tier === 'pro' && m.releaseChannel === 'stable');
				const pro31 = proModels.find(m => m.id === 'gemini-3.1-pro');
				if (pro31) {return pro31.id;}
				const pro25 = proModels.find(m => m.id === 'gemini-2.5-pro');
				if (pro25) {return pro25.id;}
				return proModels[0]?.id || this.resolveAuto(catalog);
			}

			case 'fast-agent':
			case 'general-agent':
			default:
				return this.resolveAuto(catalog, workload);
		}
	}

	isMigrationRequired(modelId: string, consumerCatalog: readonly NormalizedAIModel[]): boolean {
		if (!modelId || modelId === 'auto') {
			return false;
		}
		const norm = modelId.toLowerCase().replace(/^models\//, '');
		const exists = consumerCatalog.some(m => m.id === norm && (m.consumerSelectable ?? true));
		return !exists;
	}

	migrateSavedModel(modelId: string, consumerCatalog: readonly NormalizedAIModel[]): string {
		if (!this.isMigrationRequired(modelId, consumerCatalog)) {
			return modelId;
		}
		// If saved model was a preview pro, try to map to stable pro if available
		const norm = modelId.toLowerCase().replace(/^models\//, '');
		if (norm.includes('pro')) {
			const stablePro = consumerCatalog.find(m => m.id.includes('pro') && m.consumerSelectable);
			if (stablePro) {
				return stablePro.id;
			}
		}
		// Default safe migration
		return 'auto';
	}

	formatDiagnostics(rawCatalog: readonly NormalizedAIModel[]): Record<string, unknown> {
		const classified = rawCatalog.map(m => this.classify(m));
		const consumer = this.curateConsumerCatalog(rawCatalog);
		const autoTarget = this.resolveAuto(classified);
		const descriptionTarget = this.resolveWorkloadModel(classified, 'description');

		const byVisibility = {
			recommended: classified.filter(m => m.visibility === 'recommended').map(m => m.id),
			consumer: classified.filter(m => m.visibility === 'consumer').map(m => m.id),
			internal: classified.filter(m => m.visibility === 'internal').map(m => ({ id: m.id, reason: m.hiddenReason })),
			hidden: classified.filter(m => m.visibility === 'hidden').map(m => ({ id: m.id, reason: m.hiddenReason })),
		};

		return {
			providerId: this.providerId,
			rawModelCount: rawCatalog.length,
			consumerModelCount: consumer.length,
			autoResolvedModel: autoTarget,
			descriptionResolvedModel: descriptionTarget,
			consumerCatalog: consumer.map(m => ({
				id: m.id,
				displayName: m.displayName,
				tier: m.tier,
				releaseChannel: m.releaseChannel,
				isAuto: m.isAuto,
			})),
			classificationSummary: {
				recommendedCount: byVisibility.recommended.length,
				consumerCount: byVisibility.consumer.length,
				internalCount: byVisibility.internal.length,
				hiddenCount: byVisibility.hidden.length,
			},
			details: byVisibility,
		};
	}
}

export const defaultGeminiModelPolicy = new GeminiModelPolicy();
