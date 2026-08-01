/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { refineServiceDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Event } from '../../../../base/common/event.js';
import { Color } from '../../../../base/common/color.js';
import { IColorTheme, IThemeService, IFileIconTheme, IProductIconTheme } from '../../../../platform/theme/common/themeService.js';
import { ConfigurationTarget } from '../../../../platform/configuration/common/configuration.js';
import { isBoolean, isString } from '../../../../base/common/types.js';
import { IconContribution, IconDefinition } from '../../../../platform/theme/common/iconRegistry.js';
import { ColorScheme, ThemeTypeSelector } from '../../../../platform/theme/common/theme.js';

export const IWorkbenchThemeService = refineServiceDecorator<IThemeService, IWorkbenchThemeService>(IThemeService);

export const THEME_SCOPE_OPEN_PAREN = '[';
export const THEME_SCOPE_CLOSE_PAREN = ']';
export const THEME_SCOPE_WILDCARD = '*';

export const themeScopeRegex = /\[(.+?)\]/g;

export enum ThemeSettings {
	COLOR_THEME = 'workbench.colorTheme',
	FILE_ICON_THEME = 'workbench.iconTheme',
	PRODUCT_ICON_THEME = 'workbench.productIconTheme',
	COLOR_CUSTOMIZATIONS = 'workbench.colorCustomizations',
	TOKEN_COLOR_CUSTOMIZATIONS = 'editor.tokenColorCustomizations',
	SEMANTIC_TOKEN_COLOR_CUSTOMIZATIONS = 'editor.semanticTokenColorCustomizations',

	PREFERRED_DARK_THEME = 'workbench.preferredDarkColorTheme',
	PREFERRED_LIGHT_THEME = 'workbench.preferredLightColorTheme',
	PREFERRED_HC_DARK_THEME = 'workbench.preferredHighContrastColorTheme', /* id kept for compatibility reasons */
	PREFERRED_HC_LIGHT_THEME = 'workbench.preferredHighContrastLightColorTheme',
	DETECT_COLOR_SCHEME = 'window.autoDetectColorScheme',
	DETECT_HC = 'window.autoDetectHighContrast',

	SYSTEM_COLOR_THEME = 'window.systemColorTheme'
}

export namespace ThemeSettingDefaults {
	export const COLOR_THEME_DARK = 'PreBase Dark';
	export const COLOR_THEME_LIGHT = 'PreBase Light';
	export const COLOR_THEME_HC_DARK = 'Default High Contrast';
	export const COLOR_THEME_HC_LIGHT = 'Default High Contrast Light';

	export const FILE_ICON_THEME = 'vs-seti';
	export const PRODUCT_ICON_THEME = 'Default';
}

/**
 * Migrates legacy theme settings IDs to their current equivalents.
 * Theme IDs were simplified: "Default" prefix was removed from built-in themes,
 * and "Experimental" prefix was replaced when VS Code themes became GA.
 */
export function migrateThemeSettingsId(settingsId: string): string {
	switch (settingsId) {
		case 'Default Dark Modern': return 'Dark Modern';
		case 'Default Light Modern': return 'Light Modern';
		case 'Default Dark+': return 'Dark+';
		case 'Default Light+': return 'Light+';
		case 'Experimental Dark':
		case 'VS Code Dark':
			return ThemeSettingDefaults.COLOR_THEME_DARK;
		case 'Experimental Light':
		case 'VS Code Light':
			return ThemeSettingDefaults.COLOR_THEME_LIGHT;
	}
	return settingsId;
}

export const COLOR_THEME_DARK_INITIAL_COLORS = {
	'actionBar.toggledBackground': '#303030',
	'activityBar.activeBorder': '#5eead4',
	'activityBar.background': '#1F1F1F',
	'activityBar.border': '#ffffff14',
	'activityBar.foreground': '#f4f4f5',
	'activityBar.inactiveForeground': '#8b8b93',
	'activityBarBadge.background': '#2dd4bf',
	'activityBarBadge.foreground': '#1B1C1E',
	'badge.background': '#2B2B2B',
	'badge.foreground': '#f4f4f5',
	'button.background': '#2dd4bf',
	'button.border': '#ffffff1a',
	'button.foreground': '#1B1C1E',
	'button.hoverBackground': '#5eead4',
	'button.secondaryBackground': '#2B2B2B',
	'button.secondaryForeground': '#f4f4f5',
	'button.secondaryHoverBackground': '#303030',
	'chat.slashCommandBackground': '#134e4a66',
	'chat.slashCommandForeground': '#5eead4',
	'chat.editedFileForeground': '#E2C08D',
	'checkbox.background': '#1B1C1E',
	'checkbox.border': '#ffffff2e',
	'debugToolBar.background': '#303030',
	'descriptionForeground': '#a1a1aa',
	'dropdown.background': '#2B2B2B',
	'dropdown.border': '#ffffff2e',
	'dropdown.foreground': '#f4f4f5',
	'dropdown.listBackground': '#303030',
	'editor.background': '#1B1C1E',
	'editor.findMatchBackground': '#9E6A03',
	'editor.foreground': '#f4f4f5',
	'editor.inactiveSelectionBackground': '#3A3D41',
	'editor.selectionHighlightBackground': '#ADD6FF26',
	'editorGroup.border': '#ffffff14',
	'editorGroupHeader.tabsBackground': '#1F1F1F',
	'editorGroupHeader.tabsBorder': '#ffffff14',
	'editorGutter.addedBackground': '#2EA043',
	'editorGutter.deletedBackground': '#F85149',
	'editorGutter.modifiedBackground': '#22d3ee',
	'editorIndentGuide.activeBackground1': '#707070',
	'editorIndentGuide.background1': '#404040',
	'editorLineNumber.activeForeground': '#f4f4f5',
	'editorLineNumber.foreground': '#8b8b93',
	'editorOverviewRuler.border': '#ffffff14',
	'editorWidget.background': '#2B2B2B',
	'errorForeground': '#ff7b72',
	'focusBorder': '#2dd4bf',
	'foreground': '#f4f4f5',
	'icon.foreground': '#a1a1aa',
	'input.background': '#1B1C1E',
	'input.border': '#ffffff2e',
	'input.foreground': '#f4f4f5',
	'input.placeholderForeground': '#8b8b93',
	'inputOption.activeBackground': '#2dd4bf82',
	'inputOption.activeBorder': '#2dd4bf',
	'keybindingLabel.foreground': '#f4f4f5',
	'list.activeSelectionIconForeground': '#f4f4f5',
	'list.dropBackground': '#303030',
	'menu.background': '#303030',
	'menu.border': '#ffffff2e',
	'menu.foreground': '#f4f4f5',
	'menu.selectionBackground': '#2dd4bf',
	'menu.separatorBackground': '#ffffff2e',
	'notificationCenterHeader.background': '#2B2B2B',
	'notificationCenterHeader.foreground': '#f4f4f5',
	'notifications.background': '#2B2B2B',
	'notifications.border': '#ffffff2e',
	'notifications.foreground': '#f4f4f5',
	'panel.background': '#1F1F1F',
	'panel.border': '#ffffff14',
	'panelInput.border': '#ffffff2e',
	'panelTitle.activeBorder': '#5eead4',
	'panelTitle.activeForeground': '#f4f4f5',
	'panelTitle.inactiveForeground': '#a1a1aa',
	'peekViewEditor.background': '#1B1C1E',
	'peekViewEditor.matchHighlightBackground': '#BB800966',
	'peekViewResult.background': '#1F1F1F',
	'peekViewResult.matchHighlightBackground': '#BB800966',
	'pickerGroup.border': '#ffffff14',
	'ports.iconRunningProcessForeground': '#369432',
	'progressBar.background': '#2dd4bf',
	'quickInput.background': '#2B2B2B',
	'quickInput.foreground': '#f4f4f5',
	'settings.dropdownBackground': '#2B2B2B',
	'settings.dropdownBorder': '#ffffff2e',
	'settings.headerForeground': '#f4f4f5',
	'settings.modifiedItemIndicator': '#BB800966',
	'sideBar.background': '#1F1F1F',
	'sideBar.border': '#ffffff14',
	'sideBar.foreground': '#f4f4f5',
	'sideBarSectionHeader.background': '#1F1F1F',
	'sideBarSectionHeader.border': '#ffffff14',
	'sideBarSectionHeader.foreground': '#f4f4f5',
	'sideBarTitle.foreground': '#f4f4f5',
	'statusBar.background': '#1F1F1F',
	'statusBar.border': '#ffffff14',
	'statusBar.debuggingBackground': '#2dd4bf',
	'statusBar.debuggingForeground': '#1B1C1E',
	'statusBar.focusBorder': '#2dd4bf',
	'statusBar.foreground': '#a1a1aa',
	'statusBar.noFolderBackground': '#1F1F1F',
	'statusBarItem.focusBorder': '#2dd4bf',
	'statusBarItem.prominentBackground': '#303030',
	'statusBarItem.remoteBackground': '#2dd4bf',
	'statusBarItem.remoteForeground': '#1B1C1E',
	'tab.activeBackground': '#1B1C1E',
	'tab.activeBorder': '#1B1C1E',
	'tab.activeBorderTop': '#5eead4',
	'tab.activeForeground': '#f4f4f5',
	'tab.border': '#ffffff14',
	'tab.hoverBackground': '#2B2B2B',
	'tab.inactiveBackground': '#1F1F1F',
	'tab.inactiveForeground': '#a1a1aa',
	'tab.lastPinnedBorder': '#ccc3',
	'tab.selectedBackground': '#2B2B2B',
	'tab.selectedBorderTop': '#22d3ee',
	'tab.selectedForeground': '#f4f4f5',
	'tab.unfocusedActiveBorder': '#1B1C1E',
	'tab.unfocusedActiveBorderTop': '#ffffff2e',
	'tab.unfocusedHoverBackground': '#2B2B2B',
	'terminal.foreground': '#f4f4f5',
	'terminal.inactiveSelectionBackground': '#3A3D41',
	'terminal.tab.activeBorder': '#5eead4',
	'textBlockQuote.background': '#1B1C1E',
	'textBlockQuote.border': '#ffffff2e',
	'textCodeBlock.background': '#1B1C1E',
	'textLink.activeForeground': '#5eead4',
	'textLink.foreground': '#22d3ee',
	'textPreformat.background': '#2B2B2B',
	'textPreformat.foreground': '#f4f4f5',
	'textSeparator.foreground': '#ffffff2e',
	'titleBar.activeBackground': '#1F1F1F',
	'titleBar.activeForeground': '#f4f4f5',
	'titleBar.border': '#ffffff14',
	'titleBar.inactiveBackground': '#1F1F1F',
	'titleBar.inactiveForeground': '#a1a1aa',
	'welcomePage.progress.foreground': '#2dd4bf',
	'welcomePage.tileBackground': '#2B2B2B',
	'widget.border': '#ffffff2e'
};

export const COLOR_THEME_LIGHT_INITIAL_COLORS = {
	'actionBar.toggledBackground': '#dddddd',
	'activityBar.activeBorder': '#0d9488',
	'activityBar.background': '#fafafa',
	'activityBar.border': '#e4e4e7',
	'activityBar.foreground': '#18181b',
	'activityBar.inactiveForeground': '#71717a',
	'activityBarBadge.background': '#0d9488',
	'activityBarBadge.foreground': '#FFFFFF',
	'badge.background': '#e4e4e7',
	'badge.foreground': '#3f3f46',
	'button.background': '#0d9488',
	'button.border': '#0000001a',
	'button.foreground': '#FFFFFF',
	'button.hoverBackground': '#0f766e',
	'button.secondaryBackground': '#e4e4e7',
	'button.secondaryForeground': '#3f3f46',
	'button.secondaryHoverBackground': '#d4d4d8',
	'chat.slashCommandBackground': '#99f6e47A',
	'chat.slashCommandForeground': '#0f766e',
	'chat.editedFileForeground': '#895503',
	'checkbox.background': '#fafafa',
	'checkbox.border': '#d4d4d8',
	'descriptionForeground': '#52525b',
	'diffEditor.unchangedRegionBackground': '#f8f8f8',
	'dropdown.background': '#FFFFFF',
	'dropdown.border': '#d4d4d8',
	'dropdown.foreground': '#3f3f46',
	'dropdown.listBackground': '#FFFFFF',
	'editor.background': '#FFFFFF',
	'editor.foreground': '#18181b',
	'editor.inactiveSelectionBackground': '#ccfbf1',
	'editor.selectionHighlightBackground': '#99f6e480',
	'editorGroup.border': '#e4e4e7',
	'editorGroupHeader.tabsBackground': '#fafafa',
	'editorGroupHeader.tabsBorder': '#e4e4e7',
	'editorGutter.addedBackground': '#2EA043',
	'editorGutter.deletedBackground': '#F85149',
	'editorGutter.modifiedBackground': '#0891b2',
	'editorIndentGuide.activeBackground1': '#939393',
	'editorIndentGuide.background1': '#d4d4d8',
	'editorLineNumber.activeForeground': '#0f766e',
	'editorLineNumber.foreground': '#a1a1aa',
	'editorOverviewRuler.border': '#e4e4e7',
	'editorSuggestWidget.background': '#fafafa',
	'editorWidget.background': '#fafafa',
	'errorForeground': '#F85149',
	'focusBorder': '#0d9488',
	'foreground': '#3f3f46',
	'icon.foreground': '#3f3f46',
	'input.background': '#FFFFFF',
	'input.border': '#d4d4d8',
	'input.foreground': '#18181b',
	'input.placeholderForeground': '#71717a',
	'inputOption.activeBackground': '#99f6e4',
	'inputOption.activeBorder': '#0d9488',
	'inputOption.activeForeground': '#000000',
	'keybindingLabel.foreground': '#3f3f46',
	'list.activeSelectionBackground': '#e4e4e7',
	'list.activeSelectionForeground': '#18181b',
	'list.activeSelectionIconForeground': '#18181b',
	'list.focusAndSelectionOutline': '#0d9488',
	'list.hoverBackground': '#f4f4f5',
	'menu.border': '#d4d4d8',
	'menu.selectionBackground': '#0d9488',
	'menu.selectionForeground': '#ffffff',
	'notebook.cellBorderColor': '#e4e4e7',
	'notebook.selectedCellBackground': '#ccfbf150',
	'notificationCenterHeader.background': '#FFFFFF',
	'notificationCenterHeader.foreground': '#3f3f46',
	'notifications.background': '#FFFFFF',
	'notifications.border': '#e4e4e7',
	'notifications.foreground': '#3f3f46',
	'panel.background': '#fafafa',
	'panel.border': '#e4e4e7',
	'panelInput.border': '#e4e4e7',
	'panelTitle.activeBorder': '#0d9488',
	'panelTitle.activeForeground': '#18181b',
	'panelTitle.inactiveForeground': '#71717a',
	'peekViewEditor.matchHighlightBackground': '#BB800966',
	'peekViewResult.background': '#FFFFFF',
	'peekViewResult.matchHighlightBackground': '#BB800966',
	'pickerGroup.border': '#e4e4e7',
	'pickerGroup.foreground': '#71717a',
	'ports.iconRunningProcessForeground': '#369432',
	'progressBar.background': '#0d9488',
	'quickInput.background': '#fafafa',
	'quickInput.foreground': '#3f3f46',
	'searchEditor.textInputBorder': '#d4d4d8',
	'settings.dropdownBackground': '#FFFFFF',
	'settings.dropdownBorder': '#d4d4d8',
	'settings.headerForeground': '#18181b',
	'settings.modifiedItemIndicator': '#BB800966',
	'settings.numberInputBorder': '#d4d4d8',
	'settings.textInputBorder': '#d4d4d8',
	'sideBar.background': '#fafafa',
	'sideBar.border': '#e4e4e7',
	'sideBar.foreground': '#3f3f46',
	'sideBarSectionHeader.background': '#fafafa',
	'sideBarSectionHeader.border': '#e4e4e7',
	'sideBarSectionHeader.foreground': '#3f3f46',
	'sideBarTitle.foreground': '#3f3f46',
	'statusBar.background': '#fafafa',
	'statusBar.border': '#e4e4e7',
	'statusBar.debuggingBackground': '#FD716C',
	'statusBar.debuggingForeground': '#000000',
	'statusBar.focusBorder': '#0d9488',
	'statusBar.foreground': '#3f3f46',
	'statusBar.noFolderBackground': '#fafafa',
	'statusBarItem.compactHoverBackground': '#d4d4d8',
	'statusBarItem.errorBackground': '#C72E0F',
	'statusBarItem.focusBorder': '#0d9488',
	'statusBarItem.hoverBackground': '#18181b11',
	'statusBarItem.prominentBackground': '#a1a1aa66',
	'statusBarItem.remoteBackground': '#0d9488',
	'statusBarItem.remoteForeground': '#FFFFFF',
	'tab.activeBackground': '#FFFFFF',
	'tab.activeBorder': '#fafafa',
	'tab.activeBorderTop': '#0d9488',
	'tab.activeForeground': '#18181b',
	'tab.border': '#e4e4e7',
	'tab.hoverBackground': '#FFFFFF',
	'tab.inactiveBackground': '#fafafa',
	'tab.inactiveForeground': '#71717a',
	'tab.lastPinnedBorder': '#d4d4d8',
	'tab.selectedBackground': '#ffffffa5',
	'tab.selectedBorderTop': '#22d3ee',
	'tab.selectedForeground': '#333333b3',
	'tab.unfocusedActiveBorder': '#fafafa',
	'tab.unfocusedActiveBorderTop': '#e4e4e7',
	'tab.unfocusedHoverBackground': '#fafafa',
	'terminal.foreground': '#3f3f46',
	'terminal.inactiveSelectionBackground': '#ccfbf1',
	'terminal.tab.activeBorder': '#0d9488',
	'terminalCursor.foreground': '#0d9488',
	'textBlockQuote.background': '#fafafa',
	'textBlockQuote.border': '#e4e4e7',
	'textCodeBlock.background': '#f4f4f5',
	'textLink.activeForeground': '#0d9488',
	'textLink.foreground': '#0891b2',
	'textPreformat.background': '#0000001F',
	'textPreformat.foreground': '#3f3f46',
	'textSeparator.foreground': '#a1a1aa',
	'titleBar.activeBackground': '#fafafa',
	'titleBar.activeForeground': '#18181b',
	'titleBar.border': '#e4e4e7',
	'titleBar.inactiveBackground': '#fafafa',
	'titleBar.inactiveForeground': '#71717a',
	'welcomePage.tileBackground': '#f4f4f5',
	'widget.border': '#e4e4e7'
};

export interface IWorkbenchTheme {
	readonly id: string;
	readonly label: string;
	readonly extensionData?: ExtensionData;
	readonly description?: string;
	readonly settingsId: string | null;
}

export interface IWorkbenchColorTheme extends IWorkbenchTheme, IColorTheme {
	readonly settingsId: string;
	readonly tokenColors: ITextMateThemingRule[];
}

export interface IColorMap {
	[id: string]: Color;
}

export interface IWorkbenchFileIconTheme extends IWorkbenchTheme, IFileIconTheme {
}

export interface IWorkbenchProductIconTheme extends IWorkbenchTheme, IProductIconTheme {
	readonly settingsId: string;

	getIcon(icon: IconContribution): IconDefinition | undefined;
}

export type ThemeSettingTarget = ConfigurationTarget | undefined | 'auto' | 'preview';


export interface IWorkbenchThemeService extends IThemeService {
	readonly _serviceBrand: undefined;
	setColorTheme(themeId: string | undefined | IWorkbenchColorTheme, settingsTarget: ThemeSettingTarget): Promise<IWorkbenchColorTheme | null>;
	getColorTheme(): IWorkbenchColorTheme;
	getColorThemes(): Promise<IWorkbenchColorTheme[]>;
	getMarketplaceColorThemes(publisher: string, name: string, version: string): Promise<IWorkbenchColorTheme[]>;
	readonly onDidColorThemeChange: Event<IWorkbenchColorTheme>;

	getPreferredColorScheme(): ColorScheme | undefined;

	setFileIconTheme(iconThemeId: string | undefined | IWorkbenchFileIconTheme, settingsTarget: ThemeSettingTarget): Promise<IWorkbenchFileIconTheme>;
	getFileIconTheme(): IWorkbenchFileIconTheme;
	getFileIconThemes(): Promise<IWorkbenchFileIconTheme[]>;
	getMarketplaceFileIconThemes(publisher: string, name: string, version: string): Promise<IWorkbenchFileIconTheme[]>;
	readonly onDidFileIconThemeChange: Event<IWorkbenchFileIconTheme>;

	setProductIconTheme(iconThemeId: string | undefined | IWorkbenchProductIconTheme, settingsTarget: ThemeSettingTarget): Promise<IWorkbenchProductIconTheme>;
	getProductIconTheme(): IWorkbenchProductIconTheme;
	getProductIconThemes(): Promise<IWorkbenchProductIconTheme[]>;
	getMarketplaceProductIconThemes(publisher: string, name: string, version: string): Promise<IWorkbenchProductIconTheme[]>;
	readonly onDidProductIconThemeChange: Event<IWorkbenchProductIconTheme>;
}

export interface IThemeScopedColorCustomizations {
	[colorId: string]: string;
}

export interface IColorCustomizations {
	[colorIdOrThemeScope: string]: IThemeScopedColorCustomizations | string;
}

export interface IThemeScopedTokenColorCustomizations {
	[groupId: string]: ITextMateThemingRule[] | ITokenColorizationSetting | boolean | string | undefined;
	comments?: string | ITokenColorizationSetting;
	strings?: string | ITokenColorizationSetting;
	numbers?: string | ITokenColorizationSetting;
	keywords?: string | ITokenColorizationSetting;
	types?: string | ITokenColorizationSetting;
	functions?: string | ITokenColorizationSetting;
	variables?: string | ITokenColorizationSetting;
	textMateRules?: ITextMateThemingRule[];
	semanticHighlighting?: boolean; // deprecated, use ISemanticTokenColorCustomizations.enabled instead
}

export interface ITokenColorCustomizations {
	[groupIdOrThemeScope: string]: IThemeScopedTokenColorCustomizations | ITextMateThemingRule[] | ITokenColorizationSetting | boolean | string | undefined;
	comments?: string | ITokenColorizationSetting;
	strings?: string | ITokenColorizationSetting;
	numbers?: string | ITokenColorizationSetting;
	keywords?: string | ITokenColorizationSetting;
	types?: string | ITokenColorizationSetting;
	functions?: string | ITokenColorizationSetting;
	variables?: string | ITokenColorizationSetting;
	textMateRules?: ITextMateThemingRule[];
	semanticHighlighting?: boolean; // deprecated, use ISemanticTokenColorCustomizations.enabled instead
}

export interface IThemeScopedSemanticTokenColorCustomizations {
	[styleRule: string]: ISemanticTokenRules | boolean | undefined;
	enabled?: boolean;
	rules?: ISemanticTokenRules;
}

export interface ISemanticTokenColorCustomizations {
	[styleRuleOrThemeScope: string]: IThemeScopedSemanticTokenColorCustomizations | ISemanticTokenRules | boolean | undefined;
	enabled?: boolean;
	rules?: ISemanticTokenRules;
}

export interface IThemeScopedExperimentalSemanticTokenColorCustomizations {
	[themeScope: string]: ISemanticTokenRules | undefined;
}

export interface IExperimentalSemanticTokenColorCustomizations {
	[styleRuleOrThemeScope: string]: IThemeScopedExperimentalSemanticTokenColorCustomizations | ISemanticTokenRules | undefined;
}

export type IThemeScopedCustomizations =
	IThemeScopedColorCustomizations
	| IThemeScopedTokenColorCustomizations
	| IThemeScopedExperimentalSemanticTokenColorCustomizations
	| IThemeScopedSemanticTokenColorCustomizations;

export type IThemeScopableCustomizations =
	IColorCustomizations
	| ITokenColorCustomizations
	| IExperimentalSemanticTokenColorCustomizations
	| ISemanticTokenColorCustomizations;

export interface ISemanticTokenRules {
	[selector: string]: string | ISemanticTokenColorizationSetting | undefined;
}

export interface ITextMateThemingRule {
	name?: string;
	scope?: string | string[];
	settings: ITokenColorizationSetting;
}

export interface ITokenColorizationSetting {
	foreground?: string;
	background?: string;
	fontStyle?: string; /* [italic|bold|underline|strikethrough] */
	fontFamily?: string;
	fontSize?: number;
	lineHeight?: number;
}

export interface ISemanticTokenColorizationSetting {
	foreground?: string;
	fontStyle?: string; /* [italic|bold|underline|strikethrough] */
	bold?: boolean;
	underline?: boolean;
	strikethrough?: boolean;
	italic?: boolean;
}

export interface ExtensionData {
	extensionId: string;
	extensionPublisher: string;
	extensionName: string;
	extensionIsBuiltin: boolean;
}

export namespace ExtensionData {
	export function toJSONObject(d: ExtensionData | undefined): any {
		return d && { _extensionId: d.extensionId, _extensionIsBuiltin: d.extensionIsBuiltin, _extensionName: d.extensionName, _extensionPublisher: d.extensionPublisher };
	}
	export function fromJSONObject(o: any): ExtensionData | undefined {
		if (o && isString(o._extensionId) && isBoolean(o._extensionIsBuiltin) && isString(o._extensionName) && isString(o._extensionPublisher)) {
			return { extensionId: o._extensionId, extensionIsBuiltin: o._extensionIsBuiltin, extensionName: o._extensionName, extensionPublisher: o._extensionPublisher };
		}
		return undefined;
	}
	export function fromName(publisher: string, name: string, isBuiltin = false): ExtensionData {
		return { extensionPublisher: publisher, extensionId: `${publisher}.${name}`, extensionName: name, extensionIsBuiltin: isBuiltin };
	}
}

export interface IThemeExtensionPoint {
	id: string;
	label?: string;
	description?: string;
	path: string;
	uiTheme?: ThemeTypeSelector;
	_watch: boolean; // unsupported options to watch location
}
