/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type {
	ExportRef,
	ImportRef,
	ParseResult,
	ScannedFile,
} from '../../common/types/graphTypes.js';

/**
 * A path-independent parse artifact capturing content-level AST facts.
 * Safe to reuse across renames, copies, and multiple historical commits.
 */
export interface BlobParseArtifact {
	readonly imports: readonly ImportRef[];
	readonly exports: readonly ExportRef[];
	readonly functions: readonly string[];
	readonly components: readonly string[];
	readonly isComponentFile: boolean;
	readonly packageName?: string;
	readonly language?: string;
	readonly functionCount?: number;
	readonly componentCount?: number;
	readonly analyzedAt?: number;
}

export interface ICanonicalParseArtifactCache {
	get(blobOid: string, extension: string): Promise<BlobParseArtifact | undefined> | BlobParseArtifact | undefined;
	set(blobOid: string, extension: string, artifact: BlobParseArtifact): Promise<void> | void;
}

export function extractBlobParseArtifact(result: ParseResult, language?: string): BlobParseArtifact {
	return {
		imports: [...result.imports],
		exports: [...result.exports],
		functions: [...result.functions],
		components: [...result.components],
		isComponentFile: Boolean(result.isComponentFile),
		packageName: result.packageName,
		language,
		functionCount: result.functions?.length ?? 0,
		componentCount: result.components?.length ?? 0,
		analyzedAt: Date.now(),
	};
}

export function materializeParseResult(file: ScannedFile, artifact: BlobParseArtifact): ParseResult {
	return {
		filePath: file.absolutePath,
		relativePath: file.relativePath,
		imports: [...artifact.imports],
		exports: [...artifact.exports],
		functions: [...artifact.functions],
		components: [...artifact.components],
		isComponentFile: artifact.isComponentFile,
		packageName: artifact.packageName,
	};
}
