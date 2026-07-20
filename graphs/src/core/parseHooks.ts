/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Ported from PreBase core for VS Code workbench.
 *--------------------------------------------------------------------------------------------*/

import type { ParseResult, ScannedFile } from './types.js'

export type NativeParseBatchHook = (
	projectRoot: string,
	files: ScannedFile[]
) => Promise<ParseResult[] | null>

let nativeParseHook: NativeParseBatchHook | null = null

export function setNativeParseBatchHook(hook: NativeParseBatchHook | null): void {
	nativeParseHook = hook
}

export async function runNativeParseBatch(
	projectRoot: string,
	files: ScannedFile[]
): Promise<ParseResult[] | null> {
	if (!nativeParseHook) {
		return null
	}
	try {
		return await nativeParseHook(projectRoot, files)
	} catch (err) {
		console.warn('[ParseHooks] Native parse batch failed:', err)
		return null
	}
}
