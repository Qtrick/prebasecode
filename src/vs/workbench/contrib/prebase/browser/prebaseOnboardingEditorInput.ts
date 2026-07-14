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

export const PREBASE_ONBOARDING_SCHEME = 'prebase-onboarding';

export const prebaseOnboardingEditorIcon = registerIcon(
	'prebase-onboarding-editor-icon',
	Codicon.rocket,
	localize('prebaseOnboardingEditorIcon', "Icon of the PreBase Onboarding editor.")
);

export class PreBaseOnboardingEditorInput extends EditorInput {
	static readonly TypeID = 'workbench.input.prebaseOnboarding';
	static readonly RESOURCE = URI.from({ scheme: PREBASE_ONBOARDING_SCHEME, path: '/onboarding' });

	readonly resource = PreBaseOnboardingEditorInput.RESOURCE;

	override get typeId(): string {
		return PreBaseOnboardingEditorInput.TypeID;
	}

	override get capabilities(): EditorInputCapabilities {
		return EditorInputCapabilities.Readonly | EditorInputCapabilities.Singleton;
	}

	override getName(): string {
		return localize('prebase.onboarding.editorTitle', "Welcome to PreBase");
	}

	override getIcon(): ThemeIcon {
		return prebaseOnboardingEditorIcon;
	}

	override matches(other: EditorInput | IUntypedEditorInput): boolean {
		return other instanceof PreBaseOnboardingEditorInput;
	}
}
