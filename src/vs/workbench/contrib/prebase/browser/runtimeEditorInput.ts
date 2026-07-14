/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ThemeIcon } from '../../../../base/common/themables.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { EditorInputCapabilities, IUntypedEditorInput } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { prebaseRuntimeEditorIcon } from './prebaseIcons.js';

export const PREBASE_RUNTIME_SCHEME = 'prebase-runtime';

export class PreBaseRuntimeEditorInput extends EditorInput {
	static readonly TypeID = 'workbench.input.prebaseRuntime';
	static readonly RESOURCE = URI.from({ scheme: PREBASE_RUNTIME_SCHEME, path: '/preview' });

	readonly resource = PreBaseRuntimeEditorInput.RESOURCE;

	override get typeId(): string {
		return PreBaseRuntimeEditorInput.TypeID;
	}

	override get capabilities(): EditorInputCapabilities {
		return EditorInputCapabilities.Readonly | EditorInputCapabilities.Singleton;
	}

	override getName(): string {
		return localize('prebase.runtime.editorTitle', "Runtime Preview");
	}

	override getIcon(): ThemeIcon {
		return prebaseRuntimeEditorIcon;
	}

	override matches(other: EditorInput | IUntypedEditorInput): boolean {
		return other instanceof PreBaseRuntimeEditorInput;
	}
}
