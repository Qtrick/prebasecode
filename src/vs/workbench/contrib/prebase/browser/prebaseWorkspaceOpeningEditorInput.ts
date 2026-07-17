/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { EditorInputCapabilities, IUntypedEditorInput } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import type { PreBaseWorkspaceOpenPhase } from './prebaseWorkspaceOpening.js';

export const PREBASE_WORKSPACE_OPENING_SCHEME = 'prebase-workspace-opening';

export const prebaseWorkspaceOpeningIcon = registerIcon(
	'prebase-workspace-opening-editor-icon',
	Codicon.loading,
	localize('prebaseWorkspaceOpeningIcon', "Icon of the PreBase workspace opening editor.")
);

export class PreBaseWorkspaceOpeningEditorInput extends EditorInput {
	static readonly TypeID = 'workbench.input.prebase.workspaceOpening';
	static readonly EditorID = 'workbench.editor.prebase.workspaceOpening';
	static readonly RESOURCE = URI.from({ scheme: PREBASE_WORKSPACE_OPENING_SCHEME, path: '/opening' });

	readonly resource = PreBaseWorkspaceOpeningEditorInput.RESOURCE;

	override get typeId(): string {
		return PreBaseWorkspaceOpeningEditorInput.TypeID;
	}

	override get editorId(): string {
		return PreBaseWorkspaceOpeningEditorInput.EditorID;
	}

	override get capabilities(): EditorInputCapabilities {
		return EditorInputCapabilities.Readonly | EditorInputCapabilities.Singleton;
	}

	constructor(
		readonly projectLabel: string,
		readonly resourceUri: URI | undefined,
		readonly phase: PreBaseWorkspaceOpenPhase,
	) {
		super();
	}

	override getName(): string {
		return localize('prebase.workspace.openingTab', "Opening {0}", this.projectLabel || 'project');
	}

	override getIcon(): ThemeIcon {
		return prebaseWorkspaceOpeningIcon;
	}

	override matches(other: EditorInput | IUntypedEditorInput): boolean {
		return other instanceof PreBaseWorkspaceOpeningEditorInput;
	}
}
