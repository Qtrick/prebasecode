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
	'actionBar.toggledBackground': '#383a49',
	'activityBar.activeBorder': '#5eead4',
	'activityBar.background': '#191A1B',
	'activityBar.border': '#2A2B2C',
	'activityBar.foreground': '#f4f4f5',
	'activityBar.inactiveForeground': '#71717a',
	'activityBarBadge.background': '#2dd4bf',
	'activityBarBadge.foreground': '#141516',
	'badge.background': '#242526',
	'badge.foreground': '#f4f4f5',
	'button.background': '#2dd4bf',
	'button.border': '#ffffff1a',
	'button.foreground': '#141516',
	'button.hoverBackground': '#5eead4',
	'button.secondaryBackground': '#242526',
	'button.secondaryForeground': '#f4f4f5',
	'button.secondaryHoverBackground': '#2A2B2C',
	'chat.slashCommandBackground': '#134e4a66',
	'chat.slashCommandForeground': '#5eead4',
	'chat.editedFileForeground': '#E2C08D',
	'chat.requestBubbleBackground': '#ffffff13',
	'chat.requestBubbleHoverBackground': '#ffffff22',
	'checkbox.background': '#202122',
	'checkbox.border': '#2A2B2C',
	'commandCenter.activeBorder': '#2A2B2C',
	'debugToolBar.background': '#191A1B',
	'descriptionForeground': '#a1a1aa',
	'dropdown.background': '#202122',
	'dropdown.border': '#2A2B2C',
	'dropdown.foreground': '#f4f4f5',
	'dropdown.listBackground': '#191A1B',
	'editor.background': '#141516',
	'editor.findMatchBackground': '#9E6A03',
	'editor.foreground': '#f4f4f5',
	'editor.inactiveSelectionBackground': '#3A3D41',
	'editor.selectionHighlightBackground': '#ADD6FF26',
	'editorGroup.border': '#FFFFFF17',
	'editorGroup.emptyBackground': '#141516',
	'editorGroupHeader.tabsBackground': '#191A1B',
	'editorGroupHeader.tabsBorder': '#2A2B2C',
	'editorGutter.addedBackground': '#2EA043',
	'editorGutter.deletedBackground': '#F85149',
	'editorGutter.modifiedBackground': '#22d3ee',
	'editorIndentGuide.activeBackground1': '#707070',
	'editorIndentGuide.background1': '#404040',
	'editorLineNumber.activeForeground': '#f4f4f5',
	'editorLineNumber.foreground': '#71717a',
	'editorOverviewRuler.border': '#141516',
	'editorWidget.background': '#202122',
	'errorForeground': '#F85149',
	'focusBorder': '#2dd4bf',
	'foreground': '#f4f4f5',
	'icon.foreground': '#a1a1aa',
	'input.background': '#202122',
	'input.border': '#2A2B2C',
	'input.foreground': '#f4f4f5',
	'input.placeholderForeground': '#71717a',
	'inputOption.activeBackground': '#2dd4bf82',
	'inputOption.activeBorder': '#2dd4bf',
	'keybindingLabel.foreground': '#f4f4f5',
	'list.activeSelectionIconForeground': '#FFF',
	'list.dropBackground': '#383B3D',
	'menu.background': '#202122',
	'menu.border': '#2A2B2C',
	'menu.foreground': '#f4f4f5',
	'menu.selectionBackground': '#2dd4bf',
	'menu.selectionForeground': '#141516',
	'menu.separatorBackground': '#2A2B2C',
	'notificationCenterHeader.background': '#202122',
	'notificationCenterHeader.foreground': '#f4f4f5',
	'notifications.background': '#202122',
	'notifications.border': '#2A2B2C',
	'notifications.foreground': '#f4f4f5',
	'panel.background': '#191A1B',
	'panel.border': '#2A2B2C',
	'panelInput.border': '#2A2B2C',
	'panelSectionHeader.background': '#242526',
	'panelTitle.activeBorder': '#5eead4',
	'panelTitle.activeForeground': '#f4f4f5',
	'panelTitle.inactiveForeground': '#a1a1aa',
	'peekViewEditor.background': '#141516',
	'peekViewEditor.matchHighlightBackground': '#BB800966',
	'peekViewResult.background': '#242526',
	'peekViewResult.matchHighlightBackground': '#BB800966',
	'pickerGroup.border': '#2A2B2C',
	'ports.iconRunningProcessForeground': '#369432',
	'progressBar.background': '#2dd4bf',
	'quickInput.background': '#202122',
	'quickInput.border': '#2A2B2C',
	'quickInput.foreground': '#f4f4f5',
	'quickInputTitle.background': '#202122',
	'settings.dropdownBackground': '#202122',
	'settings.dropdownBorder': '#2A2B2C',
	'settings.headerForeground': '#f4f4f5',
	'settings.modifiedItemIndicator': '#BB800966',
	'sideBar.background': '#191A1B',
	'sideBar.border': '#2A2B2C',
	'sideBar.foreground': '#f4f4f5',
	'sideBarSectionHeader.background': '#191A1B',
	'sideBarSectionHeader.border': '#2A2B2C',
	'sideBarSectionHeader.foreground': '#f4f4f5',
	'sideBarTitle.foreground': '#f4f4f5',
	'statusBar.background': '#191A1B',
	'statusBar.border': '#2A2B2C',
	'statusBar.debuggingBackground': '#2dd4bf',
	'statusBar.debuggingForeground': '#141516',
	'statusBar.focusBorder': '#2dd4bf',
	'statusBar.foreground': '#f4f4f5',
	'statusBar.noFolderBackground': '#191A1B',
	'statusBarItem.focusBorder': '#2dd4bf',
	'statusBarItem.hoverBackground': '#F1F1F133',
	'statusBarItem.hoverForeground': '#f4f4f5',
	'statusBarItem.prominentBackground': '#71717a66',
	'statusBarItem.remoteBackground': '#2dd4bf',
	'statusBarItem.remoteForeground': '#141516',
	'tab.activeBackground': '#141516',
	'tab.activeBorder': '#141516',
	'tab.activeBorderTop': '#5eead4',
	'tab.activeForeground': '#f4f4f5',
	'tab.border': '#2A2B2C',
	'tab.hoverBackground': '#202122',
	'tab.inactiveBackground': '#191A1B',
	'tab.inactiveForeground': '#a1a1aa',
	'tab.lastPinnedBorder': '#ccc3',
	'tab.selectedBackground': '#202122',
	'tab.selectedBorderTop': '#22d3ee',
	'tab.selectedForeground': '#ffffffa0',
	'tab.unfocusedActiveBorder': '#141516',
	'tab.unfocusedActiveBorderTop': '#2A2B2C',
	'tab.unfocusedHoverBackground': '#202122',
	'terminal.background': '#141516',
	'terminal.foreground': '#f4f4f5',
	'terminal.inactiveSelectionBackground': '#3A3D41',
	'terminal.tab.activeBorder': '#5eead4',
	'textBlockQuote.background': '#202122',
	'textBlockQuote.border': '#2A2B2C',
	'textCodeBlock.background': '#202122',
	'textLink.activeForeground': '#5eead4',
	'textLink.foreground': '#22d3ee',
	'textPreformat.background': '#202122',
	'textPreformat.foreground': '#f4f4f5',
	'textSeparator.foreground': '#2A2B2C',
	'titleBar.activeBackground': '#191A1B',
	'titleBar.activeForeground': '#f4f4f5',
	'titleBar.border': '#2A2B2C',
	'titleBar.inactiveBackground': '#191A1B',
	'titleBar.inactiveForeground': '#a1a1aa',
	'welcomePage.progress.foreground': '#2dd4bf',
	'welcomePage.tileBackground': '#202122',
	'widget.border': '#2A2B2C',
	'agents.background': '#141516',
	'agentsPanel.background': '#191A1B',
	'agentsPanel.foreground': '#f4f4f5',
	'agentsPanel.border': '#2A2B2C',
	'agentsGradient.tintColor': '#2dd4bf',
	'agentsChatInput.background': '#202122',
	'agentsChatInput.foreground': '#f4f4f5',
	'agentsChatInput.border': '#2A2B2C',
	'agentsChatInput.focusBorder': '#2dd4bfb3',
	'agentsChatInput.placeholderForeground': '#71717a',
	'agentsNewSessionButton.background': '#00000000',
	'agentsNewSessionButton.foreground': '#f4f4f5',
	'agentsNewSessionButton.border': '#2A2B2C',
	'agentsNewSessionButton.hoverBackground': '#FFFFFF18',
	'agentsBadge.background': '#2dd4bf',
	'agentsBadge.foreground': '#141516',
	'agentsUnreadBadge.background': '#2dd4bf',
	'agentsUnreadBadge.foreground': '#141516'
};

export const COLOR_THEME_LIGHT_INITIAL_COLORS = {
	'actionBar.toggledBackground': '#dddddd',
	'activityBar.activeBorder': '#0d9488',
	'activityBar.background': '#F8F8F8',
	'activityBar.border': '#E5E5E5',
	'activityBar.foreground': '#101012',
	'activityBar.inactiveForeground': '#616161',
	'activityBarBadge.background': '#0d9488',
	'activityBarBadge.foreground': '#FFFFFF',
	'badge.background': '#f4f4f5',
	'badge.foreground': '#3B3B3B',
	'button.background': '#0d9488',
	'button.border': '#0000001a',
	'button.foreground': '#FFFFFF',
	'button.hoverBackground': '#0f766e',
	'button.secondaryBackground': '#E5E5E5',
	'button.secondaryForeground': '#3B3B3B',
	'button.secondaryHoverBackground': '#f4f4f5',
	'chat.slashCommandBackground': '#99f6e47A',
	'chat.slashCommandForeground': '#0f766e',
	'chat.editedFileForeground': '#895503',
	'checkbox.background': '#F8F8F8',
	'checkbox.border': '#CECECE',
	'descriptionForeground': '#3B3B3B',
	'diffEditor.unchangedRegionBackground': '#f8f8f8',
	'dropdown.background': '#FFFFFF',
	'dropdown.border': '#CECECE',
	'dropdown.foreground': '#3B3B3B',
	'dropdown.listBackground': '#FFFFFF',
	'editor.background': '#FFFFFF',
	'editor.foreground': '#3B3B3B',
	'editor.inactiveSelectionBackground': '#ccfbf1',
	'editor.selectionHighlightBackground': '#99f6e480',
	'editorGroup.border': '#E5E5E5',
	'editorGroupHeader.tabsBackground': '#F8F8F8',
	'editorGroupHeader.tabsBorder': '#E5E5E5',
	'editorGutter.addedBackground': '#2EA043',
	'editorGutter.deletedBackground': '#F85149',
	'editorGutter.modifiedBackground': '#0d9488',
	'editorIndentGuide.activeBackground1': '#939393',
	'editorIndentGuide.background1': '#D3D3D3',
	'editorLineNumber.activeForeground': '#171184',
	'editorLineNumber.foreground': '#6E7681',
	'editorOverviewRuler.border': '#E5E5E5',
	'editorSuggestWidget.background': '#F8F8F8',
	'editorWidget.background': '#F8F8F8',
	'errorForeground': '#F85149',
	'focusBorder': '#0d9488',
	'foreground': '#3B3B3B',
	'icon.foreground': '#3B3B3B',
	'input.background': '#FFFFFF',
	'input.border': '#CECECE',
	'input.foreground': '#3B3B3B',
	'input.placeholderForeground': '#767676',
	'inputOption.activeBackground': '#ccfbf1',
	'inputOption.activeBorder': '#0d9488',
	'inputOption.activeForeground': '#000000',
	'keybindingLabel.foreground': '#3B3B3B',
	'list.activeSelectionBackground': '#E8E8E8',
	'list.activeSelectionForeground': '#000000',
	'list.activeSelectionIconForeground': '#000000',
	'list.focusAndSelectionOutline': '#0d9488',
	'list.hoverBackground': '#F2F2F2',
	'menu.border': '#CECECE',
	'menu.selectionBackground': '#0d9488',
	'menu.selectionForeground': '#ffffff',
	'notebook.cellBorderColor': '#E5E5E5',
	'notebook.selectedCellBackground': '#ccfbf150',
	'notificationCenterHeader.background': '#FFFFFF',
	'notificationCenterHeader.foreground': '#3B3B3B',
	'notifications.background': '#FFFFFF',
	'notifications.border': '#E5E5E5',
	'notifications.foreground': '#3B3B3B',
	'panel.background': '#F8F8F8',
	'panel.border': '#E5E5E5',
	'panelInput.border': '#E5E5E5',
	'panelTitle.activeBorder': '#0d9488',
	'panelTitle.activeForeground': '#3B3B3B',
	'panelTitle.inactiveForeground': '#3B3B3B',
	'peekViewEditor.matchHighlightBackground': '#BB800966',
	'peekViewResult.background': '#FFFFFF',
	'peekViewResult.matchHighlightBackground': '#BB800966',
	'pickerGroup.border': '#E5E5E5',
	'pickerGroup.foreground': '#8B949E',
	'ports.iconRunningProcessForeground': '#369432',
	'progressBar.background': '#0d9488',
	'quickInput.background': '#F8F8F8',
	'quickInput.foreground': '#3B3B3B',
	'searchEditor.textInputBorder': '#CECECE',
	'settings.dropdownBackground': '#FFFFFF',
	'settings.dropdownBorder': '#CECECE',
	'settings.headerForeground': '#101012',
	'settings.modifiedItemIndicator': '#BB800966',
	'settings.numberInputBorder': '#CECECE',
	'settings.textInputBorder': '#CECECE',
	'sideBar.background': '#F8F8F8',
	'sideBar.border': '#E5E5E5',
	'sideBar.foreground': '#3B3B3B',
	'sideBarSectionHeader.background': '#F8F8F8',
	'sideBarSectionHeader.border': '#E5E5E5',
	'sideBarSectionHeader.foreground': '#3B3B3B',
	'sideBarTitle.foreground': '#3B3B3B',
	'statusBar.background': '#F8F8F8',
	'statusBar.border': '#E5E5E5',
	'statusBar.debuggingBackground': '#FD716C',
	'statusBar.debuggingForeground': '#000000',
	'statusBar.focusBorder': '#0d9488',
	'statusBar.foreground': '#3B3B3B',
	'statusBar.noFolderBackground': '#F8F8F8',
	'statusBarItem.compactHoverBackground': '#f4f4f5',
	'statusBarItem.errorBackground': '#C72E0F',
	'statusBarItem.focusBorder': '#0d9488',
	'statusBarItem.hoverBackground': '#B8B8B850',
	'statusBarItem.prominentBackground': '#6E768166',
	'statusBarItem.remoteBackground': '#0d9488',
	'statusBarItem.remoteForeground': '#FFFFFF',
	'tab.activeBackground': '#FFFFFF',
	'tab.activeBorder': '#F8F8F8',
	'tab.activeBorderTop': '#0d9488',
	'tab.activeForeground': '#3B3B3B',
	'tab.border': '#E5E5E5',
	'tab.hoverBackground': '#FFFFFF',
	'tab.inactiveBackground': '#F8F8F8',
	'tab.inactiveForeground': '#868686',
	'tab.lastPinnedBorder': '#D4D4D4',
	'tab.selectedBackground': '#ffffffa5',
	'tab.selectedBorderTop': '#68a3da',
	'tab.selectedForeground': '#333333b3',
	'tab.unfocusedActiveBorder': '#F8F8F8',
	'tab.unfocusedActiveBorderTop': '#E5E5E5',
	'tab.unfocusedHoverBackground': '#F8F8F8',
	'terminal.foreground': '#3B3B3B',
	'terminal.inactiveSelectionBackground': '#ccfbf1',
	'terminal.tab.activeBorder': '#0d9488',
	'terminalCursor.foreground': '#0d9488',
	'textBlockQuote.background': '#F8F8F8',
	'textBlockQuote.border': '#E5E5E5',
	'textCodeBlock.background': '#F8F8F8',
	'textLink.activeForeground': '#0d9488',
	'textLink.foreground': '#0d9488',
	'textPreformat.background': '#0000001F',
	'textPreformat.foreground': '#3B3B3B',
	'textSeparator.foreground': '#21262D',
	'titleBar.activeBackground': '#F8F8F8',
	'titleBar.activeForeground': '#1E1E1E',
	'titleBar.border': '#E5E5E5',
	'titleBar.inactiveBackground': '#F8F8F8',
	'titleBar.inactiveForeground': '#8B949E',
	'welcomePage.tileBackground': '#F3F3F3',
	'widget.border': '#E5E5E5'
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
