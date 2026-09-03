/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { ThemeIcon } from '../../../../../../base/common/themables.js';
import { URI } from '../../../../../../base/common/uri.js';
import { localize } from '../../../../../../nls.js';
import { EditorInputCapabilities, type IUntypedEditorInput } from '../../../../../common/editor.js';
import { EditorInput } from '../../../../../common/editor/editorInput.js';
import { prebaseNetworkEditorIcon } from '../../../browser/prebaseIcons.js';
import type { PreBaseGraphType } from './prebaseGraphService.js';

export const PREBASE_GRAPH_SCHEME = 'prebase-graph';

export class PreBaseGraphEditorInput extends EditorInput {
	static readonly TypeID = 'workbench.input.prebaseGraph';

	static create(graphType: PreBaseGraphType = 'network'): PreBaseGraphEditorInput {
		return new PreBaseGraphEditorInput(graphType === 'temporal' ? 'temporal' : 'network');
	}

	private _resource: URI;
	override get resource(): URI { return this._resource; }
	private _graphType: PreBaseGraphType;
	get graphType(): PreBaseGraphType { return this._graphType; }

	constructor(graphType: PreBaseGraphType) {
		super();
		this._graphType = graphType === 'temporal' ? 'temporal' : 'network';
		this._resource = URI.from({ scheme: PREBASE_GRAPH_SCHEME, path: `/${this._graphType}` });
	}

	setGraphType(graphType: PreBaseGraphType): void {
		const normalized: PreBaseGraphType = graphType === 'temporal' ? 'temporal' : 'network';
		if (this._graphType !== normalized) {
			this._graphType = normalized;
			this._resource = URI.from({ scheme: PREBASE_GRAPH_SCHEME, path: `/${normalized}` });
			this._onDidChangeLabel.fire();
		}
	}

	override get typeId(): string {
		return PreBaseGraphEditorInput.TypeID;
	}

	override get capabilities(): EditorInputCapabilities {
		return EditorInputCapabilities.Readonly | EditorInputCapabilities.Singleton;
	}

	override getName(): string {
		if (this.graphType === 'temporal') {
			return localize('prebase.graph.temporalTitle', "Temporal Graph");
		}
		return localize('prebase.graph.networkTitle', "Code Graph");
	}

	override getIcon(): ThemeIcon {
		if (this.graphType === 'temporal') {
			return ThemeIcon.fromId('history');
		}
		return prebaseNetworkEditorIcon;
	}

	override matches(other: EditorInput | IUntypedEditorInput): boolean {
		// One Code Graph editor pane: switching Network ↔ Temporal must reuse the
		// same webview instead of stacking editors that leak Chromium renderers.
		return other instanceof PreBaseGraphEditorInput;
	}
}
