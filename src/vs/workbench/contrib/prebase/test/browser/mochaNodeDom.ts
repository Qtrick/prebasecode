/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

if (typeof (globalThis as { MouseEvent?: unknown }).MouseEvent === 'undefined') {
	(globalThis as { MouseEvent: unknown }).MouseEvent = class MouseEvent extends Event {
		constructor(type: string, init?: EventInit) {
			super(type, init);
		}
	};
}
