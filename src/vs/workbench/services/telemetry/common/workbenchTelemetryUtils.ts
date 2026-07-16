/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { IWorkbenchEnvironmentService } from '../../environment/common/environmentService.js';

/**
 * Determines if experiment properties will be set on telemetry events.
 * When true, TelemetryService should buffer events until setExperimentProperty is called.
 */
export function experimentsEnabled(
	configurationService: IConfigurationService,
	productService: IProductService,
	environmentService: IWorkbenchEnvironmentService
): boolean {
	// PreBase is intentionally a non-experimenting build. Keep this source-level
	// boundary independent of product configuration and user settings so no
	// experiment-assignment client can initialize or make a network request.
	void configurationService;
	void productService;
	void environmentService;
	return false;
}
