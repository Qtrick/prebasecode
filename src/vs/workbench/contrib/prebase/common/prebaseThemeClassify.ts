/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type ThemeGroup = 'prebase' | 'builtin' | 'extension';

const PREBASE_THEME_SETTINGS_IDS = new Set(['PreBase Dark', 'PreBase Light']);

export type ColorThemeClassifyInput = {
	settingsId: string;
	extensionData?: { extensionIsBuiltin: boolean; extensionName: string };
};

/**
 * Classify a discovered color theme for PreBase Settings grouping.
 * Test/fixture/colorize extensions are skipped so they never appear in the picker.
 */
export function classifyColorTheme(theme: ColorThemeClassifyInput): ThemeGroup | 'skip' {
	const name = theme.extensionData?.extensionName ?? '';
	if (/test|colorize|fixture/i.test(name)) {
		return 'skip';
	}
	if (PREBASE_THEME_SETTINGS_IDS.has(theme.settingsId)) {
		return 'prebase';
	}
	if (theme.extensionData?.extensionIsBuiltin) {
		return 'builtin';
	}
	return 'extension';
}
