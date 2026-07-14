/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ThemeIcon } from '../../../../base/common/themables.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { EditorInputCapabilities, IUntypedEditorInput } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';

export const PREBASE_SETTINGS_SCHEME = 'prebase-settings';

export const prebaseSettingsEditorIcon = registerIcon(
	'prebase-settings-editor-icon',
	Codicon.settingsGear,
	localize('prebaseSettingsEditorIcon', "Icon of the PreBase Settings editor.")
);

export class PreBaseSettingsEditorInput extends EditorInput {
	static readonly TypeID = 'workbench.input.prebaseSettings';
	static readonly RESOURCE = URI.from({ scheme: PREBASE_SETTINGS_SCHEME, path: '/settings' });

	readonly resource = PreBaseSettingsEditorInput.RESOURCE;

	override get typeId(): string {
		return PreBaseSettingsEditorInput.TypeID;
	}

	override get capabilities(): EditorInputCapabilities {
		return EditorInputCapabilities.Readonly | EditorInputCapabilities.Singleton;
	}

	override getName(): string {
		return localize('prebase.settings.editorTitle', "PreBase Settings");
	}

	override getIcon(): ThemeIcon {
		return prebaseSettingsEditorIcon;
	}

	override matches(other: EditorInput | IUntypedEditorInput): boolean {
		return other instanceof PreBaseSettingsEditorInput;
	}
}
