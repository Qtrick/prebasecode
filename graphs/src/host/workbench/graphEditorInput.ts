/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ThemeIcon } from '../../../../../../base/common/themables.js';
import { URI } from '../../../../../../base/common/uri.js';
import { localize } from '../../../../../../nls.js';
import { EditorInputCapabilities, IUntypedEditorInput } from '../../../../../common/editor.js';
import { EditorInput } from '../../../../../common/editor/editorInput.js';
import { prebaseArchitectureEditorIcon, prebaseNetworkEditorIcon } from '../../../browser/prebaseIcons.js';
import type { PreBaseGraphType } from './prebaseGraphService.js';

export const PREBASE_GRAPH_SCHEME = 'prebase-graph';

export class PreBaseGraphEditorInput extends EditorInput {
	static readonly TypeID = 'workbench.input.prebaseGraph';

	static create(graphType: PreBaseGraphType): PreBaseGraphEditorInput {
		return new PreBaseGraphEditorInput(graphType);
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
		return this.graphType === 'architecture'
			? localize('prebase.graph.architectureTitle', "Architecture Graph")
			: localize('prebase.graph.networkTitle', "Network Graph");
	}

	override getIcon(): ThemeIcon {
		return this.graphType === 'architecture' ? prebaseArchitectureEditorIcon : prebaseNetworkEditorIcon;
	}

	override matches(other: EditorInput | IUntypedEditorInput): boolean {
		if (other instanceof PreBaseGraphEditorInput) {
			return other.graphType === this.graphType;
		}
		return false;
	}
}
