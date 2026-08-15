/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IPreBaseAIProviderAdapter } from './aiTypes';
import { GeminiProviderAdapter } from './geminiAdapter';

export class AIProviderRegistry {
	private readonly adapters = new Map<string, IPreBaseAIProviderAdapter>();

	constructor(defaultAdapters: IPreBaseAIProviderAdapter[] = [new GeminiProviderAdapter()]) {
		for (const adapter of defaultAdapters) {
			this.registerAdapter(adapter);
		}
	}

	registerAdapter(adapter: IPreBaseAIProviderAdapter): void {
		const normId = adapter.id.toLowerCase().replace(/-api$/, '');
		this.adapters.set(normId, adapter);
	}

	getAdapter(id: string): IPreBaseAIProviderAdapter | undefined {
		const normId = id.toLowerCase().replace(/-api$/, '');
		return this.adapters.get(normId);
	}

	listAdapters(): readonly IPreBaseAIProviderAdapter[] {
		return Array.from(this.adapters.values());
	}

	listActiveProviderIds(): readonly string[] {
		return Array.from(this.adapters.keys());
	}

	hasAdapter(id: string): boolean {
		const normId = id.toLowerCase().replace(/-api$/, '');
		return this.adapters.has(normId);
	}
}

export const globalAIProviderRegistry = new AIProviderRegistry();
