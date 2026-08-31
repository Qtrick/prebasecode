/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IPreBaseDesktopRuntimeService, PreBaseDesktopRuntimeService } from '../browser/prebaseDesktopRuntimeService.js';

registerSingleton(IPreBaseDesktopRuntimeService, PreBaseDesktopRuntimeService, InstantiationType.Delayed);
