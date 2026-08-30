/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ProjectGuidanceService } from './projectGuidanceService';

let activeService: ProjectGuidanceService | undefined;

export function setProjectGuidanceService(service: ProjectGuidanceService | undefined): void {
	activeService = service;
}

export function getProjectGuidanceService(): ProjectGuidanceService | undefined {
	return activeService;
}
