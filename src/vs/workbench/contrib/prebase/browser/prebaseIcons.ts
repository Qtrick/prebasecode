/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { localize } from '../../../../nls.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';

export const prebaseMapsViewIcon = registerIcon(
	'prebase-maps-view-icon',
	Codicon.typeHierarchySub,
	localize('prebaseMapsViewIcon', "View icon of PreBase Maps.")
);

export const prebaseRuntimeViewIcon = registerIcon(
	'prebase-runtime-view-icon',
	Codicon.openPreview,
	localize('prebaseRuntimeViewIcon', "View icon of PreBase Runtime Preview.")
);

export const prebaseArchitectureEditorIcon = registerIcon(
	'prebase-architecture-editor-icon',
	Codicon.symbolNamespace,
	localize('prebaseArchitectureEditorIcon', "Icon of the Architecture Graph editor.")
);

export const prebaseNetworkEditorIcon = registerIcon(
	'prebase-network-editor-icon',
	Codicon.typeHierarchy,
	localize('prebaseNetworkEditorIcon', "Icon of the Network Graph editor.")
);

export const prebaseRuntimeEditorIcon = registerIcon(
	'prebase-runtime-editor-icon',
	Codicon.browser,
	localize('prebaseRuntimeEditorIcon', "Icon of the Runtime Preview editor.")
);
