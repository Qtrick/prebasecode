/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { ThemeIcon } from '../../../../../../base/common/themables.js';
import { URI } from '../../../../../../base/common/uri.js';
import { localize } from '../../../../../../nls.js';
import { EditorInputCapabilities, IUntypedEditorInput } from '../../../../../common/editor.js';
import { EditorInput } from '../../../../../common/editor/editorInput.js';
import { prebaseNetworkEditorIcon } from '../../../browser/prebaseIcons.js';
import type { PreBaseGraphType } from './prebaseGraphService.js';

export const PREBASE_GRAPH_SCHEME = 'prebase-graph';

export class PreBaseGraphEditorInput extends EditorInput {
	static readonly TypeID = 'workbench.input.prebaseGraph';

	static create(_graphType?: PreBaseGraphType): PreBaseGraphEditorInput {
		return new PreBaseGraphEditorInput('network');
	}

	readonly resource: URI;

	constructor(readonly graphType: PreBaseGraphType) {
		super();
		this.resource = URI.from({ scheme: PREBASE_GRAPH_SCHEME, path: `/${graphType}` });
	}

	override get typeId(): string {
		return PreBaseGraphEditorInput.TypeID;
	}

	override get capabilities(): EditorInputCapabilities {
		return EditorInputCapabilities.Readonly | EditorInputCapabilities.Singleton;
	}

	override getName(): string {
		return localize('prebase.graph.networkTitle', "Code Graph");
	}

	override getIcon(): ThemeIcon {
		return prebaseNetworkEditorIcon;
	}

	override matches(other: EditorInput | IUntypedEditorInput): boolean {
		if (other instanceof PreBaseGraphEditorInput) {
			return other.graphType === this.graphType;
		}
		return false;
	}
}
