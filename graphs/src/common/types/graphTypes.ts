/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

export type NodeKind = 'folder' | 'file' | 'function' | 'component' | 'service' | 'module';

export type EdgeKind = 'import' | 'export' | 'reference' | 'contains' | 'dependency';

/** Edge provenance strength for Code Graph answers (optional; backward compatible). */
export type EdgeConfidence = 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS';

export interface GraphNode {
	id: string;
	kind: NodeKind;
	label: string;
	path?: string;
	parentId?: string;
	isEntry?: boolean;
	depth?: number;
	meta?: {
		exports?: string[];
		imports?: string[];
		isComponent?: boolean;
		language?: string;
		functionCount?: number;
		componentCount?: number;
		architectureLayer?: string;
		importance?: number;
		isMetadata?: boolean;
		communityId?: number;
		communityLabel?: string;
		degree?: number;
		inDegree?: number;
		outDegree?: number;
	};
}

export interface GraphEdge {
	id: string;
	source: string;
	target: string;
	kind: EdgeKind;
	meta?: {
		importSource?: string;
		specifiers?: string[];
		isDefault?: boolean;
		isDynamic?: boolean;
		/** @deprecated Prefer sourceLine; kept for older snapshots. */
		line?: number;
		confidence?: EdgeConfidence;
		sourceFile?: string;
		/** 1-based call-site / import line when known. */
		sourceLine?: number;
		reason?: string;
	};
}

export interface LayoutPosition {
	x: number;
	y: number;
}

export interface LayoutPosition3D {
	x: number;
	y: number;
	z: number;
}

export interface GraphSnapshot {
	nodes: GraphNode[];
	edges: GraphEdge[];
	positions: Record<string, LayoutPosition>;
	/** Canonical 3D base positions for the Code Graph canvas (never overwrite with projected coords). */
	positions3d?: Record<string, LayoutPosition3D>;
	networkLayoutMode?: string;
	/** Optional schema marker; Code Graph enrichment uses 2. */
	schemaVersion?: number;
	projectPath: string;
	projectName: string;
	entryNodeId: string | null;
	scannedAt: number;
}

export interface IncrementalUpdate {
	addedNodes: GraphNode[];
	removedNodeIds: string[];
	addedEdges: GraphEdge[];
	removedEdgeIds: string[];
	updatedNodes: GraphNode[];
	positions?: Record<string, LayoutPosition>;
}

export interface ParseResult {
	filePath: string;
	relativePath: string;
	imports: ImportRef[];
	exports: ExportRef[];
	functions: string[];
	components: string[];
	isComponentFile: boolean;
	/** JVM package declaration (Java/Kotlin), when present. */
	packageName?: string;
	/** 1-based line for symbol name (functions/components/exports) when known. */
	symbolLines?: Record<string, number>;
}

export interface ImportRef {
	source: string;
	specifiers: string[];
	isDefault?: boolean;
	/** True for `import()` / similar runtime loads (not static ImportDeclaration). */
	isDynamic?: boolean;
	line?: number;
}

export interface ExportRef {
	name: string;
	isDefault?: boolean;
	isType?: boolean;
	/** 1-based source line when available from the parser. */
	line?: number;
}

export interface ScannedFile {
	absolutePath: string;
	relativePath: string;
	extension: string;
}

export type LayoutMode = 'hierarchy' | 'pyramid' | 'scattered';
