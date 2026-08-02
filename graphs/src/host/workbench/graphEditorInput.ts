/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { ThemeIcon } from '../../../../../../base/common/themables.js';
import { URI } from '../../../../../../base/common/uri.js';
import { localize } from '../../../../../../nls.js';
import { EditorInputCapabilities, IUntypedEditorInput } from '../../../../../common/editor.js';
import { EditorInput } from '../../../../../common/editor/editorInput.js';
import { prebaseNetworkEditorIcon } from '../../../browser/prebaseIcons.js';
import { normalizeToCodeGraphType, type PreBaseGraphType } from '../../common/types/graphProduct.js';

export const PREBASE_GRAPH_SCHEME = 'prebase-graph';

export class PreBaseGraphEditorInput extends EditorInput {
	static readonly TypeID = 'workbench.input.prebaseGraph';

	/** Opens Code Graph. Legacy architecture/network args coerce to `'code'`. */
	static create(graphType: PreBaseGraphType = 'code'): PreBaseGraphEditorInput {
		return new PreBaseGraphEditorInput(normalizeToCodeGraphType(graphType));
	}

	readonly resource: URI;
	readonly graphType: PreBaseGraphType;

	constructor(graphType: PreBaseGraphType = 'code') {
		super();
		// Always store `'code'` so setInput / ownership guards never see stale Arch/Net.
		this.graphType = normalizeToCodeGraphType(graphType);
		this.resource = URI.from({ scheme: PREBASE_GRAPH_SCHEME, path: `/${this.graphType}` });
	}

	override get typeId(): string {
		return PreBaseGraphEditorInput.TypeID;
	}

	override get capabilities(): EditorInputCapabilities {
		return EditorInputCapabilities.Readonly | EditorInputCapabilities.Singleton;
	}

	override getName(): string {
		return localize('prebase.graph.codeTitle', "Code Graph");
	}

	override getIcon(): ThemeIcon {
		// Theme Codicon only — not Dock/application icons.
		return prebaseNetworkEditorIcon;
	}

	override matches(other: EditorInput | IUntypedEditorInput): boolean {
		// One singleton Code Graph tab (legacy Arch/Net inputs also match).
		return other instanceof PreBaseGraphEditorInput;
	}
}
