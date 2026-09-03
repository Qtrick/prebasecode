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

	readonly resource: URI;
	readonly graphType: PreBaseGraphType;

	constructor(graphType: PreBaseGraphType) {
		super();
		this.graphType = graphType;
		this.resource = URI.from({ scheme: PREBASE_GRAPH_SCHEME, path: `/${graphType}` });
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
