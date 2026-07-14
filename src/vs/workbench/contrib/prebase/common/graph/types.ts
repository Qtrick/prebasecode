/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Ported from PreBase core for VS Code workbench.
 *--------------------------------------------------------------------------------------------*/

export type NodeKind = 'folder' | 'file' | 'function' | 'component' | 'service' | 'module'

export type EdgeKind = 'import' | 'export' | 'reference' | 'contains' | 'dependency'

export interface GraphNode {
	id: string
	kind: NodeKind
	label: string
	path?: string
	parentId?: string
	isEntry?: boolean
	depth?: number
	meta?: {
		exports?: string[]
		imports?: string[]
		isComponent?: boolean
		language?: string
		functionCount?: number
		componentCount?: number
		architectureLayer?: string
		importance?: number
		isMetadata?: boolean
	}
}

export interface GraphEdge {
	id: string
	source: string
	target: string
	kind: EdgeKind
	meta?: {
		importSource?: string
		specifiers?: string[]
		isDefault?: boolean
		isDynamic?: boolean
		line?: number
	}
}

export interface LayoutPosition {
	x: number
	y: number
}

export interface LayoutPosition3D {
	x: number
	y: number
	z: number
}

export interface GraphSnapshot {
	nodes: GraphNode[]
	edges: GraphEdge[]
	positions: Record<string, LayoutPosition>
	/** Canonical 3D base positions for Network Graph (never overwrite with projected coords). */
	positions3d?: Record<string, LayoutPosition3D>
	networkLayoutMode?: string
	projectPath: string
	projectName: string
	entryNodeId: string | null
	scannedAt: number
}

export interface IncrementalUpdate {
	addedNodes: GraphNode[]
	removedNodeIds: string[]
	addedEdges: GraphEdge[]
	removedEdgeIds: string[]
	updatedNodes: GraphNode[]
	positions?: Record<string, LayoutPosition>
}

export interface ParseResult {
	filePath: string
	relativePath: string
	imports: ImportRef[]
	exports: ExportRef[]
	functions: string[]
	components: string[]
	isComponentFile: boolean
	/** JVM package declaration (Java/Kotlin), when present. */
	packageName?: string
	/** 1-based line for symbol name (functions/components/exports) when known. */
	symbolLines?: Record<string, number>
}

export interface ImportRef {
	source: string
	specifiers: string[]
	isDefault?: boolean
	line?: number
}

export interface ExportRef {
	name: string
	isDefault?: boolean
	isType?: boolean
	/** 1-based source line when available from the parser. */
	line?: number
}

export interface ScannedFile {
	absolutePath: string
	relativePath: string
	extension: string
}

export type LayoutMode = 'hierarchy' | 'pyramid' | 'scattered'
