/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { EditorInputCapabilities, IUntypedEditorInput } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';

export const PREBASE_HOME_SCHEME = 'prebase-home';

export const prebaseHomeEditorIcon = registerIcon(
	'prebase-home-editor-icon',
	Codicon.home,
	localize('prebaseHomeEditorIcon', "Icon of the PreBase Home editor.")
);

export class PreBaseHomeEditorInput extends EditorInput {
	static readonly TypeID = 'workbench.input.prebaseHome';
	static readonly RESOURCE = URI.from({ scheme: PREBASE_HOME_SCHEME, path: '/home' });

	readonly resource = PreBaseHomeEditorInput.RESOURCE;

	override get typeId(): string {
		return PreBaseHomeEditorInput.TypeID;
	}

	override get capabilities(): EditorInputCapabilities {
		return EditorInputCapabilities.Readonly | EditorInputCapabilities.Singleton;
	}

	override getName(): string {
		return localize('prebase.home.editorTitle', "PreBase Home");
	}

	override getIcon(): ThemeIcon {
		return prebaseHomeEditorIcon;
	}

	override matches(other: EditorInput | IUntypedEditorInput): boolean {
		return other instanceof PreBaseHomeEditorInput;
	}
}
