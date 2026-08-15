/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../base/browser/dom.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { ColorScheme } from '../../../../platform/theme/common/theme.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { IEditorOpenContext } from '../../../common/editor.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';
import { IWorkbenchThemeService } from '../../../services/themes/common/workbenchThemeService.js';
import { MANAGE_TRUST_COMMAND_ID } from '../../workspace/common/workspace.js';
import { PREBASE_RESETTABLE_CONFIG_KEYS, PreBaseConfigKeys } from '../common/prebaseConfiguration.js';
import { IPreBaseGraphService } from '../graphs/host/workbench/prebaseGraphService.js';
import {
	GRAPH_SUPPORTED_LANGUAGES,
	type IPreBaseGraphSettingsUiHost,
	renderGraphAdvanced,
	renderGraphCategory,
	renderGraphInteractionControls,
	renderGraphPerformanceCategory,
	renderGraphReduceMotionRow,
} from '../graphs/host/workbench/settings/graphSettingsUi.js';
import { classifyColorTheme, type ThemeGroup } from '../common/prebaseThemeClassify.js';
import { PreBaseSettingsEditorInput } from './prebaseSettingsEditorInput.js';

type SettingsCategory =
	| 'appearance'
	| 'graph'
	| 'ai'
	| 'sidebar'
	| 'editor'
	| 'extensions'
	| 'interaction'
	| 'performance'
	| 'about';

const CATEGORIES: { id: SettingsCategory; label: string; icon: string }[] = [
	{ id: 'appearance', label: localize('prebase.settings.cat.appearance', "Appearance"), icon: '$(symbol-color)' },
	{ id: 'graph', label: localize('prebase.settings.cat.graph', "Graph"), icon: '$(type-hierarchy)' },
	{ id: 'ai', label: localize('prebase.settings.cat.ai', "Agents & AI"), icon: '$(sparkle)' },
	{ id: 'sidebar', label: localize('prebase.settings.cat.sidebar', "Sidebar"), icon: '$(layout-sidebar-left)' },
	{ id: 'editor', label: localize('prebase.settings.cat.editor', "Editor"), icon: '$(edit)' },
	{ id: 'extensions', label: localize('prebase.settings.cat.extensions', "Extensions"), icon: '$(extensions)' },
	{ id: 'interaction', label: localize('prebase.settings.cat.interaction', "Interaction"), icon: '$(target)' },
	{ id: 'performance', label: localize('prebase.settings.cat.performance', "Performance"), icon: '$(dashboard)' },
	{ id: 'about', label: localize('prebase.settings.cat.about', "About"), icon: '$(info)' },
];

const COLORS = {
	bg: 'var(--vscode-editor-background)',
	surface: 'var(--vscode-sideBar-background)',
	overlay: 'var(--vscode-editorWidget-background)',
	border: 'var(--vscode-input-border, var(--vscode-widget-border))',
	muted: 'var(--vscode-input-background)',
	text: 'var(--vscode-foreground)',
	textSecondary: 'var(--vscode-descriptionForeground)',
	textMuted: 'var(--vscode-descriptionForeground)',
	accent: '#2dd4bf',
	accentDim: 'rgba(45, 212, 191, 0.15)',
	accentBorder: 'rgba(45, 212, 191, 0.28)',
	navActive: 'var(--vscode-list-inactiveSelectionBackground, var(--vscode-input-background))',
};

interface SidebarDraft {
	min: number;
	max: number;
	left: number;
	collapsed: number;
	inspector: number;
}

export class PreBaseSettingsEditor extends EditorPane {
	static readonly ID = 'workbench.editor.prebaseSettings';

	private _root: HTMLElement | undefined;
	private _nav: HTMLElement | undefined;
	private _main: HTMLElement | undefined;
	private _advanced: HTMLElement | undefined;
	private _category: SettingsCategory = 'appearance';
	private readonly _renderDisposables = this._register(new DisposableStore());
	private _sidebarDraft: SidebarDraft | undefined;
	private _sidebarSavedEl: HTMLElement | undefined;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ICommandService private readonly commandService: ICommandService,
		@IProductService private readonly productService: IProductService,
		@INotificationService private readonly notificationService: INotificationService,
		@IPreBaseGraphService private readonly graphService: IPreBaseGraphService,
		@IWorkbenchThemeService private readonly workbenchThemeService: IWorkbenchThemeService,
	) {
		super(PreBaseSettingsEditor.ID, group, telemetryService, themeService, storageService);
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('prebase') || e.affectsConfiguration('editor') || e.affectsConfiguration('workbench.colorTheme')) {
				this._render();
			}
		}));
		this._register(this.workbenchThemeService.onDidColorThemeChange(() => {
			if (this._category === 'appearance') {
				this._render();
			}
		}));
		this._register(this.graphService.onDidChangeViewState(() => {
			if (this._category === 'graph') {
				this._render();
			}
		}));
	}

	protected createEditor(parent: HTMLElement): void {
		this._root = DOM.append(parent, DOM.$('.prebase-settings-editor'));
		Object.assign(this._root.style, {
			display: 'flex',
			height: '100%',
			width: '100%',
			background: COLORS.bg,
			color: COLORS.text,
			fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
			overflow: 'hidden',
		});

		const aside = DOM.append(this._root, DOM.$('.prebase-settings-aside'));
		Object.assign(aside.style, {
			width: '208px',
			flexShrink: '0',
			borderRight: `1px solid ${COLORS.border}`,
			background: COLORS.surface,
			display: 'flex',
			flexDirection: 'column',
		});

		const header = DOM.append(aside, DOM.$('div'));
		Object.assign(header.style, {
			padding: '16px',
			borderBottom: `1px solid ${COLORS.border}`,
		});
		const title = DOM.append(header, DOM.$('div'));
		title.textContent = localize('prebase.settings.title', "Settings");
		Object.assign(title.style, { fontSize: '13px', fontWeight: '600' });
		const subtitle = DOM.append(header, DOM.$('div'));
		subtitle.textContent = localize('prebase.settings.subtitle', "Preferences");
		Object.assign(subtitle.style, { fontSize: '11px', color: COLORS.textMuted, marginTop: '2px' });

		this._nav = DOM.append(aside, DOM.$('nav'));
		Object.assign(this._nav.style, {
			flex: '1',
			padding: '8px',
			overflowY: 'auto',
			display: 'flex',
			flexDirection: 'column',
			gap: '2px',
		});

		const resetWrap = DOM.append(aside, DOM.$('div'));
		Object.assign(resetWrap.style, {
			padding: '12px',
			borderTop: `1px solid ${COLORS.border}`,
		});
		const resetBtn = DOM.append(resetWrap, DOM.$('button')) as HTMLButtonElement;
		resetBtn.type = 'button';
		resetBtn.textContent = localize('prebase.settings.resetAll', "⟳  Reset all");
		Object.assign(resetBtn.style, {
			background: 'transparent',
			border: 'none',
			color: COLORS.textMuted,
			fontSize: '11px',
			cursor: 'pointer',
			padding: '6px 8px',
			width: '100%',
			textAlign: 'left',
		});
		this._register(DOM.addDisposableListener(resetBtn, 'click', () => void this._resetAll()));
		this._register(DOM.addDisposableListener(resetBtn, 'mouseenter', () => { resetBtn.style.color = COLORS.textSecondary; }));
		this._register(DOM.addDisposableListener(resetBtn, 'mouseleave', () => { resetBtn.style.color = COLORS.textMuted; }));

		const body = DOM.append(this._root, DOM.$('.prebase-settings-body'));
		Object.assign(body.style, {
			flex: '1',
			minWidth: '0',
			overflowY: 'auto',
		});

		const grid = DOM.append(body, DOM.$('.prebase-settings-grid'));
		Object.assign(grid.style, {
			display: 'grid',
			gridTemplateColumns: 'minmax(0, 1fr) 280px',
			gap: '32px',
			padding: '32px',
			maxWidth: '1100px',
		});

		this._main = DOM.append(grid, DOM.$('.prebase-settings-main'));
		Object.assign(this._main.style, { minWidth: '0' });

		this._advanced = DOM.append(grid, DOM.$('.prebase-settings-advanced'));
		Object.assign(this._advanced.style, { minWidth: '0', alignSelf: 'start', position: 'sticky', top: '24px' });

		this._render();
	}

	override async setInput(input: PreBaseSettingsEditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		if (token.isCancellationRequested) {
			return;
		}
		this._render();
	}

	override layout(dimension: DOM.Dimension): void {
		if (!this._root) {
			return;
		}
		this._root.style.height = `${dimension.height}px`;
		this._root.style.width = `${dimension.width}px`;
		const showAdvanced = dimension.width >= 900;
		if (this._advanced) {
			this._advanced.style.display = showAdvanced && this._hasAdvanced() ? 'block' : 'none';
		}
		const grid = this._root.querySelector('.prebase-settings-grid') as HTMLElement | null;
		if (grid) {
			grid.style.gridTemplateColumns = showAdvanced && this._hasAdvanced()
				? 'minmax(0, 1fr) 280px'
				: 'minmax(0, 1fr)';
		}
	}

	private _hasAdvanced(): boolean {
		return this._category === 'graph'
			|| this._category === 'interaction'
			|| this._category === 'performance';
	}

	private _get<T>(key: string, fallback: T): T {
		const v = this.configurationService.getValue<T>(key);
		return (v === undefined || v === null) ? fallback : v;
	}

	private async _set(key: string, value: unknown): Promise<void> {
		await this.configurationService.updateValue(key, value);
	}

	/** Bridge for graph-owned Settings panels (keeps shell helpers here). */
	private _graphSettingsHost(): IPreBaseGraphSettingsUiHost {
		return {
			main: this._main!,
			advanced: this._advanced!,
			category: this._category,
			colors: { border: COLORS.border, textMuted: COLORS.textMuted, accent: COLORS.accent },
			get: <T>(key: string, fallback: T) => this._get(key, fallback),
			set: (key, value) => this._set(key, value),
			track: (d) => { this._renderDisposables.add(d); },
			on: (el, type, listener) => {
				this._renderDisposables.add(DOM.addDisposableListener(el, type, listener));
			},
			panel: (parent, title, description) => this._panel(parent, title, description),
			row: (parent, label, hint, control) => this._row(parent, label, hint, control),
			selectStyle: (el) => this._selectStyle(el),
			inputStyle: (el) => this._inputStyle(el),
			accentCheckbox: () => this._accentCheckbox(),
			range: (min, max, step, value) => this._range(min, max, step, value),
			btn: (label, primary) => this._btn(label, primary),
			relayout: async () => { await this.graphService.relayout(); },
		};
	}

	private async _resetAll(): Promise<void> {
		for (const key of PREBASE_RESETTABLE_CONFIG_KEYS) {
			await this.configurationService.updateValue(key, undefined);
		}
		this._sidebarDraft = undefined;
		this.notificationService.info(localize('prebase.settings.resetDone', "PreBase settings restored to defaults. Editor preferences were left unchanged."));
		this._render();
	}

	private _render(): void {
		if (!this._nav || !this._main || !this._advanced) {
			return;
		}
		this._renderDisposables.clear();
		DOM.clearNode(this._nav);
		DOM.clearNode(this._main);
		DOM.clearNode(this._advanced);

		for (const cat of CATEGORIES) {
			const btn = DOM.append(this._nav, DOM.$('button')) as HTMLButtonElement;
			btn.type = 'button';
			btn.textContent = cat.label;
			const active = cat.id === this._category;
			Object.assign(btn.style, {
				display: 'block',
				width: '100%',
				textAlign: 'left',
				padding: '8px 12px',
				borderRadius: '8px',
				border: 'none',
				background: active ? COLORS.navActive : 'transparent',
				color: active ? COLORS.text : COLORS.textMuted,
				fontSize: '12px',
				fontWeight: '500',
				cursor: 'pointer',
			});
			this._renderDisposables.add(DOM.addDisposableListener(btn, 'click', () => {
				this._category = cat.id;
				this._render();
				if (this._root) {
					this.layout(DOM.getClientArea(this._root));
				}
			}));
			this._renderDisposables.add(DOM.addDisposableListener(btn, 'mouseenter', () => {
				if (!active) {
					btn.style.color = COLORS.textSecondary;
					btn.style.background = 'color-mix(in srgb, var(--vscode-list-hoverBackground, var(--vscode-input-background)) 70%, transparent)';
				}
			}));
			this._renderDisposables.add(DOM.addDisposableListener(btn, 'mouseleave', () => {
				if (!active) {
					btn.style.color = COLORS.textMuted;
					btn.style.background = 'transparent';
				}
			}));
		}

		switch (this._category) {
			case 'appearance': this._renderAppearance(); break;
			case 'graph': this._renderGraph(); break;
			case 'ai': this._renderAI(); break;
			case 'sidebar': this._renderSidebar(); break;
			case 'editor': this._renderEditor(); break;
			case 'extensions': this._renderExtensions(); break;
			case 'interaction': this._renderInteraction(); break;
			case 'performance': this._renderPerformance(); break;
			case 'about': this._renderAbout(); break;
		}

		if (this._hasAdvanced()) {
			this._renderAdvanced();
		}

		if (this._root) {
			this.layout(DOM.getClientArea(this._root));
		}
	}

	private _panel(parent: HTMLElement, title: string, description?: string): HTMLElement {
		const wrap = DOM.append(parent, DOM.$('div'));
		Object.assign(wrap.style, { marginBottom: '24px' });
		const h = DOM.append(wrap, DOM.$('h2'));
		h.textContent = title;
		Object.assign(h.style, { margin: '0', fontSize: '15px', fontWeight: '600' });
		if (description) {
			const d = DOM.append(wrap, DOM.$('p'));
			d.textContent = description;
			Object.assign(d.style, { margin: '4px 0 0', fontSize: '13px', color: COLORS.textMuted });
		}
		const card = DOM.append(wrap, DOM.$('div'));
		Object.assign(card.style, {
			marginTop: '16px',
			borderRadius: '12px',
			border: `1px solid ${COLORS.border}`,
			background: 'transparent',
			padding: '0 16px',
		});
		return card;
	}

	private _row(parent: HTMLElement, label: string, hint: string | undefined, control: HTMLElement): void {
		const row = DOM.append(parent, DOM.$('div'));
		Object.assign(row.style, {
			display: 'flex',
			alignItems: 'flex-start',
			justifyContent: 'space-between',
			gap: '24px',
			padding: '10px 0',
			borderBottom: `1px solid color-mix(in srgb, ${COLORS.border} 55%, transparent)`,
		});
		const left = DOM.append(row, DOM.$('div'));
		Object.assign(left.style, { minWidth: '0', flex: '1' });
		const lab = DOM.append(left, DOM.$('div'));
		lab.textContent = label;
		Object.assign(lab.style, { fontSize: '13px', color: COLORS.text });
		if (hint) {
			const h = DOM.append(left, DOM.$('div'));
			h.textContent = hint;
			Object.assign(h.style, { fontSize: '11px', color: COLORS.textMuted, marginTop: '2px', lineHeight: '1.45' });
		}
		const right = DOM.append(row, DOM.$('div'));
		Object.assign(right.style, { flexShrink: '0', paddingTop: '2px' });
		right.appendChild(control);
	}

	private _selectStyle(el: HTMLSelectElement): void {
		Object.assign(el.style, {
			fontSize: '12px',
			borderRadius: '8px',
			background: COLORS.muted,
			border: `1px solid ${COLORS.border}`,
			color: COLORS.text,
			padding: '6px 10px',
			minWidth: '120px',
		});
	}

	private _inputStyle(el: HTMLInputElement): void {
		Object.assign(el.style, {
			fontSize: '12px',
			borderRadius: '8px',
			background: COLORS.muted,
			border: `1px solid ${COLORS.border}`,
			color: COLORS.text,
			padding: '4px 8px',
			width: '64px',
		});
	}

	private _accentCheckbox(): HTMLInputElement {
		const el = document.createElement('input');
		el.type = 'checkbox';
		el.style.accentColor = COLORS.accent;
		return el;
	}

	private _range(min: number, max: number, step: number, value: number): HTMLInputElement {
		const el = document.createElement('input');
		el.type = 'range';
		el.min = String(min);
		el.max = String(max);
		el.step = String(step);
		el.value = String(value);
		Object.assign(el.style, { width: '128px', accentColor: COLORS.accent });
		return el;
	}

	private _btn(label: string, primary = false): HTMLButtonElement {
		const btn = document.createElement('button');
		btn.type = 'button';
		btn.textContent = label;
		Object.assign(btn.style, {
			fontSize: '12px',
			padding: '6px 12px',
			borderRadius: '8px',
			cursor: 'pointer',
			border: primary ? `1px solid ${COLORS.accentBorder}` : `1px solid ${COLORS.border}`,
			background: primary ? COLORS.accentDim : COLORS.muted,
			color: primary ? COLORS.accent : COLORS.text,
		});
		return btn;
	}

	private _linkBtn(label: string, onClick: () => void): HTMLButtonElement {
		const btn = this._btn(label);
		this._renderDisposables.add(DOM.addDisposableListener(btn, 'click', onClick));
		return btn;
	}

	private _renderAppearance(): void {
		const card = this._panel(
			this._main!,
			localize('prebase.settings.appearance.title', "Appearance"),
			localize('prebase.settings.appearance.desc', "Theme, density, and motion preferences.")
		);

		const themeCtrl = document.createElement('div');
		Object.assign(themeCtrl.style, { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px', maxWidth: '420px' });

		const themeSelect = document.createElement('select');
		this._selectStyle(themeSelect);
		themeSelect.style.minWidth = '280px';
		themeSelect.setAttribute('aria-label', localize('prebase.settings.theme', "Color Theme"));
		const loadingOpt = document.createElement('option');
		loadingOpt.textContent = localize('prebase.settings.themeLoading', "Loading themes…");
		loadingOpt.disabled = true;
		themeSelect.appendChild(loadingOpt);
		themeCtrl.appendChild(themeSelect);

		const themeMeta = DOM.append(themeCtrl, DOM.$('span'));
		Object.assign(themeMeta.style, { fontSize: '11px', color: COLORS.textMuted, textAlign: 'right' });

		const populateThemes = async () => {
			const themes = await this.workbenchThemeService.getColorThemes();
			const current = this.workbenchThemeService.getColorTheme();
			const currentId = current.settingsId || current.id;
			const groups: Record<ThemeGroup, typeof themes> = { prebase: [], builtin: [], extension: [] };
			for (const theme of themes) {
				const g = classifyColorTheme(theme);
				if (g === 'skip') {
					continue;
				}
				groups[g].push(theme);
			}
			const sortThemes = (a: (typeof themes)[number], b: (typeof themes)[number]) => a.label.localeCompare(b.label);
			groups.prebase.sort(sortThemes);
			groups.builtin.sort(sortThemes);
			groups.extension.sort(sortThemes);

			themeSelect.replaceChildren();
			const addGroup = (label: string, list: typeof themes) => {
				if (!list.length) {
					return;
				}
				const og = document.createElement('optgroup');
				og.label = label;
				for (const theme of list) {
					const opt = document.createElement('option');
					opt.value = theme.settingsId;
					const kind = theme.type === ColorScheme.HIGH_CONTRAST_DARK || theme.type === ColorScheme.HIGH_CONTRAST_LIGHT ? 'HC'
						: theme.type === ColorScheme.LIGHT ? 'Light' : 'Dark';
					opt.textContent = `${theme.label} (${kind})`;
					og.appendChild(opt);
				}
				themeSelect.appendChild(og);
			};
			addGroup(localize('prebase.settings.themeGroupPrebase', "PreBase"), groups.prebase);
			addGroup(localize('prebase.settings.themeGroupBuiltin', "VS Code Built-In"), groups.builtin);
			addGroup(localize('prebase.settings.themeGroupExtensions', "Installed Extensions"), groups.extension);

			const match = [...groups.prebase, ...groups.builtin, ...groups.extension]
				.find(t => t.settingsId === currentId || t.id === currentId || currentId.endsWith(t.settingsId));
			themeSelect.value = match?.settingsId ?? currentId;
			themeMeta.textContent = localize(
				'prebase.settings.themeDynamicCount',
				"{0} themes available · changes apply live",
				groups.prebase.length + groups.builtin.length + groups.extension.length
			);
		};

		void populateThemes();
		this._renderDisposables.add(this.workbenchThemeService.onDidColorThemeChange(() => {
			void populateThemes();
		}));
		this._renderDisposables.add(DOM.addDisposableListener(themeSelect, 'change', () => {
			const id = themeSelect.value;
			void this.workbenchThemeService.setColorTheme(id, 'auto').then(result => {
				if (!result) {
					this.notificationService.info(localize(
						'prebase.settings.themeMissing',
						"Theme “{0}” is not available yet. Use the full theme picker, or ensure built-in theme extensions are built.",
						id
					));
				}
			});
		}));

		themeCtrl.appendChild(this._linkBtn(localize('prebase.settings.openTheme', "Browse all themes…"), () => {
			void this.commandService.executeCommand('workbench.action.selectTheme');
		}));
		this._row(
			card,
			localize('prebase.settings.theme', "Color Theme"),
			localize('prebase.settings.themeHint', "Dynamically discovered PreBase, VS Code built-in, and extension themes."),
			themeCtrl
		);

		const fileIconCtrl = document.createElement('div');
		Object.assign(fileIconCtrl.style, { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px', maxWidth: '420px' });
		const fileIconSelect = document.createElement('select');
		this._selectStyle(fileIconSelect);
		fileIconSelect.style.minWidth = '280px';
		fileIconCtrl.appendChild(fileIconSelect);
		const populateFileIcons = async () => {
			const themes = await this.workbenchThemeService.getFileIconThemes();
			const current = this.workbenchThemeService.getFileIconTheme();
			fileIconSelect.replaceChildren();
			const none = document.createElement('option');
			none.value = '';
			none.textContent = localize('prebase.settings.fileIconNone', "None");
			fileIconSelect.appendChild(none);
			for (const theme of themes.filter(t => !!t.id).sort((a, b) => a.label.localeCompare(b.label))) {
				const opt = document.createElement('option');
				opt.value = theme.settingsId ?? theme.id;
				opt.textContent = theme.label;
				fileIconSelect.appendChild(opt);
			}
			fileIconSelect.value = current.settingsId ?? current.id ?? '';
		};
		void populateFileIcons();
		this._renderDisposables.add(this.workbenchThemeService.onDidFileIconThemeChange(() => { void populateFileIcons(); }));
		this._renderDisposables.add(DOM.addDisposableListener(fileIconSelect, 'change', () => {
			void this.workbenchThemeService.setFileIconTheme(fileIconSelect.value || '', 'auto');
		}));
		fileIconCtrl.appendChild(this._linkBtn(localize('prebase.settings.openFileIconTheme', "Browse file icon themes…"), () => {
			void this.commandService.executeCommand('workbench.action.selectIconTheme');
		}));
		this._row(
			card,
			localize('prebase.settings.fileIconTheme', "File Icon Theme"),
			localize('prebase.settings.fileIconThemeHint', "Includes Minimal, Seti, and Modern Icons when available."),
			fileIconCtrl
		);

		const density = document.createElement('select');
		this._selectStyle(density);
		for (const [v, label] of [['comfortable', 'Comfortable'], ['compact', 'Compact']] as const) {
			const opt = document.createElement('option');
			opt.value = v;
			opt.textContent = label;
			density.appendChild(opt);
		}
		density.value = this._get(PreBaseConfigKeys.UiDensity, 'comfortable');
		this._renderDisposables.add(DOM.addDisposableListener(density, 'change', () => void this._set(PreBaseConfigKeys.UiDensity, density.value)));
		this._row(card, localize('prebase.settings.uiDensity', "UI density"), localize('prebase.settings.uiDensityHint', "Reserved — Maps/Runtime UI does not read this setting yet."), density);

		const reduceCard = card;
		renderGraphReduceMotionRow(this._graphSettingsHost(), reduceCard);

		const magnus = document.createElement('select');
		this._selectStyle(magnus);
		for (const [v, label] of [['float', 'Floating bubble'], ['sidebar', 'Right sidebar']] as const) {
			const opt = document.createElement('option');
			opt.value = v;
			opt.textContent = label;
			magnus.appendChild(opt);
		}
		// Prefer extension key when present; otherwise PreBase UI key.
		const magnusPanel = this.configurationService.getValue<string>('prebase.magnus.panelLocation');
		const magnusDisplay = this._get(PreBaseConfigKeys.UiMagnusDisplay, 'sidebar');
		if (magnusPanel === 'panel') {
			magnus.value = 'float';
		} else if (magnusPanel === 'sidebar') {
			magnus.value = 'sidebar';
		} else {
			magnus.value = magnusDisplay;
		}
		this._renderDisposables.add(DOM.addDisposableListener(magnus, 'change', async () => {
			await this._set(PreBaseConfigKeys.UiMagnusDisplay, magnus.value);
			// Keep Magnus extension setting in sync when available (float → panel).
			try {
				await this._set('prebase.magnus.panelLocation', magnus.value === 'float' ? 'panel' : 'sidebar');
			} catch {
				// Extension may not be installed.
			}
		}));
		this._row(
			card,
			localize('prebase.settings.magnusDisplay', "Agents AI display"),
			localize('prebase.settings.magnusDisplayHint', "Float keeps Agents as a draggable bubble. Sidebar pins it as a resizable right panel."),
			magnus
		);

		const modelCtrl = document.createElement('div');
		Object.assign(modelCtrl.style, { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' });
		const modelNote = DOM.append(modelCtrl, DOM.$('span'));
		modelNote.textContent = localize('prebase.settings.magnusModelNote', "Configure in Extensions → Agents");
		Object.assign(modelNote.style, { fontSize: '11px', color: COLORS.textMuted, maxWidth: '180px', textAlign: 'right' });
		modelCtrl.appendChild(this._linkBtn(localize('prebase.settings.openMagnusSettings', "Agents model settings…"), () => {
			void this.commandService.executeCommand('workbench.action.openSettings', 'prebase.magnus');
		}));
		this._row(
			card,
			localize('prebase.settings.magnusModel', "Agents AI model"),
			localize('prebase.settings.magnusModelHint', "Choose which model Agents uses. Managed by the Agents extension — not duplicated here. API keys belong in .env, never in this UI."),
			modelCtrl
		);
	}

	private _renderGraph(): void {
		renderGraphCategory(this._graphSettingsHost());
	}

	private _renderAI(): void {
		const execCard = this._panel(
			this._main!,
			localize('prebase.settings.ai.execTitle', "Execution Mode & Provider"),
			localize('prebase.settings.ai.execDesc', "Choose how PreBase connects to AI models (Gemini, etc.) and where credentials originate.")
		);

		const execSelect = document.createElement('select');
		this._selectStyle(execSelect);
		const modes = [
			{ id: 'auto', label: 'Automatic (Recommended)' },
			{ id: 'development-env', label: 'Development Environment (.env)' },
			{ id: 'byok', label: 'Bring Your Own Key (BYOK)' },
			{ id: 'hosted', label: 'PreBase Hosted (Cloud Gateway)' },
		];
		for (const m of modes) {
			const opt = document.createElement('option');
			opt.value = m.id;
			opt.textContent = m.label;
			execSelect.appendChild(opt);
		}
		const currentMode = this.configurationService.getValue<string>('prebase.magnus.executionMode') || 'auto';
		execSelect.value = currentMode;
		this._renderDisposables.add(DOM.addDisposableListener(execSelect, 'change', () => {
			void this.configurationService.updateValue('prebase.magnus.executionMode', execSelect.value);
		}));
		this._row(
			execCard,
			localize('prebase.settings.ai.execMode', "Execution mode"),
			localize('prebase.settings.ai.execModeHint', "Automatic uses PreBase root .env in source dev, BYOK key if configured, or PreBase Cloud when signed in."),
			execSelect
		);

		const modelSelect = document.createElement('select');
		this._selectStyle(modelSelect);
		const models = [
			{ id: 'auto', label: 'Auto (Recommended - Gemini 2.5 Flash)' },
			{ id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro (Complex Reasoning)' },
			{ id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (Fast & Capable)' },
			{ id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash (Fast)' },
			{ id: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash Lite (Lightweight)' },
		];
		for (const m of models) {
			const opt = document.createElement('option');
			opt.value = m.id;
			opt.textContent = m.label;
			modelSelect.appendChild(opt);
		}
		modelSelect.value = this.configurationService.getValue<string>('prebase.magnus.defaultModel') || 'auto';
		this._renderDisposables.add(DOM.addDisposableListener(modelSelect, 'change', () => {
			void this.configurationService.updateValue('prebase.magnus.defaultModel', modelSelect.value);
		}));
		this._row(
			execCard,
			localize('prebase.settings.ai.defaultModel', "Default model"),
			localize('prebase.settings.ai.defaultModelHint', "Selected model for Agents chat, code completion, and architectural graph descriptions."),
			modelSelect
		);

		const actionsCard = this._panel(
			this._main!,
			localize('prebase.settings.ai.actionsTitle', "Credentials & Diagnostics"),
			localize('prebase.settings.ai.actionsDesc', "Manage secure SecretStorage credentials and test provider connectivity.")
		);

		const testBtn = this._linkBtn(localize('prebase.settings.ai.testConn', "Test AI Connection…"), () => {
			void this.commandService.executeCommand('prebase.magnus.testModelProvider');
		});
		this._row(
			actionsCard,
			localize('prebase.settings.ai.test', "Connectivity"),
			localize('prebase.settings.ai.testHint', "Sends a non-streaming health ping to verify provider credentials and endpoint response."),
			testBtn
		);

		const diagBtn = this._linkBtn(localize('prebase.settings.ai.diagnose', "Run Provider Diagnostics…"), () => {
			void this.commandService.executeCommand('prebase.magnus.diagnoseProviders');
		});
		this._row(
			actionsCard,
			localize('prebase.settings.ai.diag', "Diagnostics"),
			localize('prebase.settings.ai.diagHint', "Inspects credential sources across local .env, OS SecretStorage, and cloud availability without exposing secrets."),
			diagBtn
		);

		const keyCtrl = document.createElement('div');
		Object.assign(keyCtrl.style, { display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' });
		keyCtrl.appendChild(this._linkBtn(localize('prebase.settings.ai.setKey', "Configure BYOK Key…"), () => {
			void this.commandService.executeCommand('prebase.magnus.setApiKey');
		}));
		keyCtrl.appendChild(this._linkBtn(localize('prebase.settings.ai.importEnv', "Import from .env…"), () => {
			void this.commandService.executeCommand('prebase.magnus.importApiKeyFromEnv');
		}));
		keyCtrl.appendChild(this._linkBtn(localize('prebase.settings.ai.clearKey', "Clear Key"), () => {
			void this.commandService.executeCommand('prebase.magnus.clearApiKey');
		}));
		this._row(
			actionsCard,
			localize('prebase.settings.ai.keyManagement', "Secret Storage"),
			localize('prebase.settings.ai.keyManagementHint', "Credentials are saved in OS-backed secure storage. Secret keys are never rendered in the UI."),
			keyCtrl
		);

		const note = DOM.append(actionsCard, DOM.$('p'));
		note.textContent = localize(
			'prebase.settings.ai.privacyNotice',
			"PreBase Privacy & Security: Model provider keys are never transmitted to third parties except the direct provider endpoint or authenticated PreBase agent gateway. Source files and telemetry are never uploaded."
		);
		Object.assign(note.style, { fontSize: '11px', color: COLORS.textMuted, padding: '8px 0 0', lineHeight: '1.45', margin: '0' });
	}

	private _renderSidebar(): void {
		const card = this._panel(
			this._main!,
			localize('prebase.settings.sidebar.title', "Sidebar"),
			localize('prebase.settings.sidebar.desc', "Graph sidebar behavior.")
		);
		const collapse = this._accentCheckbox();
		collapse.checked = this._get(PreBaseConfigKeys.UiCollapseLongSections, true);
		this._renderDisposables.add(DOM.addDisposableListener(collapse, 'change', () => void this._set(PreBaseConfigKeys.UiCollapseLongSections, collapse.checked)));
		this._row(
			card,
			localize('prebase.settings.collapseSections', "Collapse long sections by default"),
			localize('prebase.settings.collapseSectionsHint', "Reserved — Maps UI does not read this setting yet."),
			collapse
		);

		if (!this._sidebarDraft) {
			this._sidebarDraft = {
				min: this._get(PreBaseConfigKeys.UiSidebarMinWidth, 180),
				max: this._get(PreBaseConfigKeys.UiSidebarMaxWidth, 420),
				left: this._get(PreBaseConfigKeys.UiSidebarLeftWidth, 224),
				collapsed: this._get(PreBaseConfigKeys.UiSidebarCollapsedWidth, 36),
				inspector: this._get(PreBaseConfigKeys.UiSidebarInspectorWidth, 240),
			};
		}
		const draft = this._sidebarDraft;
		const custom = this._panel(
			this._main!,
			localize('prebase.settings.sidebarCustom.title', "Sidebar customization"),
			localize('prebase.settings.sidebarCustom.desc', "Stored width preferences. Reserved — not applied to the workbench sidebar yet.")
		);

		const addSlider = (label: string, key: keyof SidebarDraft, min: number, max: number) => {
			const wrap = document.createElement('div');
			Object.assign(wrap.style, { display: 'flex', alignItems: 'center', gap: '8px' });
			const range = this._range(min, max, 1, draft[key]);
			const val = document.createElement('span');
			val.textContent = String(draft[key]);
			Object.assign(val.style, { fontSize: '10px', color: COLORS.textMuted, width: '28px', textAlign: 'right' });
			this._renderDisposables.add(DOM.addDisposableListener(range, 'input', () => {
				draft[key] = Number(range.value);
				val.textContent = range.value;
			}));
			wrap.append(range, val);
			this._row(custom, label, undefined, wrap);
		};

		addSlider(localize('prebase.settings.sidebarMin', "Minimum width"), 'min', 160, 280);
		addSlider(localize('prebase.settings.sidebarMax', "Maximum width"), 'max', 300, 560);
		addSlider(localize('prebase.settings.sidebarLeft', "Left sidebar width"), 'left', 160, 560);
		addSlider(localize('prebase.settings.sidebarCollapsed', "Collapsed rail width"), 'collapsed', 32, 56);
		addSlider(localize('prebase.settings.sidebarInspector', "Right (inspector) width"), 'inspector', 160, 560);

		const saveRow = DOM.append(custom, DOM.$('div'));
		Object.assign(saveRow.style, { display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 0' });
		const saveBtn = this._btn(localize('prebase.settings.sidebarSave', "Save"), true);
		this._renderDisposables.add(DOM.addDisposableListener(saveBtn, 'click', async () => {
			const min = Math.min(draft.min, draft.max);
			const max = Math.max(draft.min, draft.max);
			const clamp = (v: number) => Math.min(max, Math.max(min, v));
			await this._set(PreBaseConfigKeys.UiSidebarMinWidth, min);
			await this._set(PreBaseConfigKeys.UiSidebarMaxWidth, max);
			await this._set(PreBaseConfigKeys.UiSidebarLeftWidth, clamp(draft.left));
			await this._set(PreBaseConfigKeys.UiSidebarCollapsedWidth, draft.collapsed);
			await this._set(PreBaseConfigKeys.UiSidebarInspectorWidth, clamp(draft.inspector));
			draft.min = min;
			draft.max = max;
			draft.left = clamp(draft.left);
			draft.inspector = clamp(draft.inspector);
			if (this._sidebarSavedEl) {
				this._sidebarSavedEl.style.display = '';
				setTimeout(() => { if (this._sidebarSavedEl) { this._sidebarSavedEl.style.display = 'none'; } }, 2000);
			}
		}));
		saveRow.appendChild(saveBtn);
		this._sidebarSavedEl = DOM.append(saveRow, DOM.$('span'));
		this._sidebarSavedEl.textContent = localize('prebase.settings.saved', "Saved");
		Object.assign(this._sidebarSavedEl.style, { fontSize: '11px', color: COLORS.accent, display: 'none' });
	}

	private _renderEditor(): void {
		const card = this._panel(
			this._main!,
			localize('prebase.settings.editor.title', "Editor"),
			localize('prebase.settings.editor.desc', "Workbench Code View editor preferences (writes native editor.* settings).")
		);

		const fontSize = document.createElement('input');
		fontSize.type = 'number';
		fontSize.min = '11';
		fontSize.max = '20';
		this._inputStyle(fontSize);
		fontSize.value = String(this._get('editor.fontSize', 13));
		this._renderDisposables.add(DOM.addDisposableListener(fontSize, 'change', () => void this._set('editor.fontSize', Number(fontSize.value) || 13)));
		this._row(card, localize('prebase.settings.fontSize', "Font size"), localize('prebase.settings.fontSizeHint', "Affects Code View — writes editor.fontSize."), fontSize);

		const lineNumbers = this._accentCheckbox();
		const ln = this._get<string | boolean>('editor.lineNumbers', 'on');
		lineNumbers.checked = ln !== 'off' && ln !== false;
		this._renderDisposables.add(DOM.addDisposableListener(lineNumbers, 'change', () => void this._set('editor.lineNumbers', lineNumbers.checked ? 'on' : 'off')));
		this._row(card, localize('prebase.settings.lineNumbers', "Line numbers"), localize('prebase.settings.lineNumbersHint', "Affects Code View — writes editor.lineNumbers."), lineNumbers);

		const wordWrap = this._accentCheckbox();
		const ww = this._get<string | boolean>('editor.wordWrap', 'off');
		wordWrap.checked = ww === 'on' || ww === true;
		this._renderDisposables.add(DOM.addDisposableListener(wordWrap, 'change', () => void this._set('editor.wordWrap', wordWrap.checked ? 'on' : 'off')));
		this._row(card, localize('prebase.settings.wordWrap', "Word wrap"), localize('prebase.settings.wordWrapHint', "Affects Code View — writes editor.wordWrap."), wordWrap);

		const minimap = this._accentCheckbox();
		minimap.checked = this._get<boolean>('editor.minimap.enabled', true) !== false;
		this._renderDisposables.add(DOM.addDisposableListener(minimap, 'change', () => void this._set('editor.minimap.enabled', minimap.checked)));
		this._row(card, localize('prebase.settings.minimap', "Minimap"), localize('prebase.settings.minimapHint', "Affects Code View — writes editor.minimap.enabled."), minimap);
	}

	private _renderExtensions(): void {
		const gallery = this._panel(
			this._main!,
			localize('prebase.settings.extGallery.title', "Extension gallery"),
			localize('prebase.settings.extGallery.desc', "PreBase searches and installs extensions from Open VSX (Eclipse Foundation).")
		);

		const provider = document.createElement('span');
		provider.textContent = localize('prebase.settings.openVsx', "Open VSX (default)");
		Object.assign(provider.style, { fontSize: '12px', color: COLORS.accent });
		this._row(
			gallery,
			localize('prebase.settings.galleryProvider', "Gallery provider"),
			localize('prebase.settings.galleryProviderHint', "Open VSX is ToS-compliant for non-Microsoft editors. Visual Studio Marketplace is not used here."),
			provider
		);

		const openExt = this._linkBtn(localize('prebase.settings.openExtensions', "Open Extensions view"), () => {
			void this.commandService.executeCommand('workbench.view.extensions');
		});
		this._row(
			gallery,
			localize('prebase.settings.browseExtensions', "Browse & install"),
			localize('prebase.settings.browseExtensionsHint', "Use the Extensions view to search Open VSX or Install from VSIX…. No fake install buttons here."),
			openExt
		);

		const meta = DOM.append(gallery, DOM.$('p'));
		meta.textContent = localize(
			'prebase.settings.extMetaNote',
			"Icons and READMEs come from Open VSX package metadata when published. If a listing has no icon or README, PreBase shows the default icon or “No README available” — content is never invented. Install, uninstall, enable, and disable use the real workbench extension management path; details open in the editor, not inside this sidebar."
		);
		Object.assign(meta.style, { fontSize: '11px', color: COLORS.textMuted, padding: '4px 0 8px', lineHeight: '1.45', margin: '0' });

		const host = DOM.append(gallery, DOM.$('p'));
		host.textContent = localize(
			'prebase.settings.extHostNote',
			"PreBase runs a real Extension Host (not V1.1’s partial shim). There is no “Needs host” badge: installed extensions either activate, stay disabled, need a reload, or fail for a concrete enablement/API reason. Extension code does not run in the renderer, and AI provider keys are not exposed to extensions."
		);
		Object.assign(host.style, { fontSize: '11px', color: COLORS.textMuted, padding: '0 0 12px', lineHeight: '1.45', margin: '0' });

		const note = DOM.append(gallery, DOM.$('p'));
		note.textContent = localize(
			'prebase.settings.apiKeyNote',
			"API keys and secrets are never shown in this UI. Configure Gemini credentials securely via Agents Provider Settings, or import from .env using “Agents: Import Provider Key from .env…”."
		);
		Object.assign(note.style, { fontSize: '11px', color: COLORS.textMuted, padding: '0 0 12px', lineHeight: '1.45', margin: '0' });

		const trust = this._panel(
			this._main!,
			localize('prebase.settings.trust.title', "Workspace trust"),
			localize('prebase.settings.trust.desc', "Restricted blocks untrusted extension activation. Manage trust for this workspace.")
		);
		const trustBtn = this._linkBtn(localize('prebase.settings.manageTrust', "Manage workspace trust…"), () => {
			void this.commandService.executeCommand(MANAGE_TRUST_COMMAND_ID);
		});
		this._row(trust, localize('prebase.settings.trustMode', "Trust"), localize('prebase.settings.trustHint', "Opens the workbench Workspace Trust editor."), trustBtn);
	}

	private _renderInteraction(): void {
		renderGraphInteractionControls(this._graphSettingsHost());

		const term = this._panel(
			this._main!,
			localize('prebase.settings.terminalVis.title', "Terminal visibility"),
			localize('prebase.settings.terminalVis.desc', "Choose which workspace pages show the bottom terminal panel. Hiding Terminal does not stop running sessions.")
		);
		const always = document.createElement('span');
		always.textContent = localize('prebase.settings.alwaysOn', "Always on");
		Object.assign(always.style, { fontSize: '11px', color: COLORS.textMuted });
		this._row(term, localize('prebase.settings.termCode', "Code View"), localize('prebase.settings.termCodeHint', "Always enabled — Terminal is required for editing."), always);

		const mkTerm = (label: string, key: string, fallback: boolean) => {
			const cb = this._accentCheckbox();
			cb.checked = this._get(key, fallback);
			this._renderDisposables.add(DOM.addDisposableListener(cb, 'change', () => void this._set(key, cb.checked)));
			this._row(term, label, undefined, cb);
		};
		mkTerm(localize('prebase.settings.termGraph', "Graph View"), PreBaseConfigKeys.InteractionTerminalVisibilityGraph, false);
		mkTerm(localize('prebase.settings.termRuntime', "Runtime Preview"), PreBaseConfigKeys.InteractionTerminalVisibilityRuntime, true);
		mkTerm(localize('prebase.settings.termSettings', "Settings"), PreBaseConfigKeys.InteractionTerminalVisibilitySettings, false);
	}

	private _renderPerformance(): void {
		renderGraphPerformanceCategory(this._graphSettingsHost());
	}

	private _renderAbout(): void {
		const card = this._panel(
			this._main!,
			localize('prebase.settings.about.title', "About PreBase"),
			localize('prebase.settings.about.desc', "Architecture intelligence for your codebase.")
		);
		const block = DOM.append(card, DOM.$('div'));
		Object.assign(block.style, { padding: '12px 0', display: 'flex', flexDirection: 'column', gap: '12px' });

		const row = DOM.append(block, DOM.$('div'));
		Object.assign(row.style, { display: 'flex', alignItems: 'center', gap: '12px' });
		const logo = DOM.append(row, DOM.$('div'));
		Object.assign(logo.style, {
			width: '40px',
			height: '40px',
			borderRadius: '12px',
			background: COLORS.muted,
			border: `1px solid ${COLORS.border}`,
			display: 'flex',
			alignItems: 'center',
			justifyContent: 'center',
			color: COLORS.accent,
			fontWeight: '700',
			fontSize: '14px',
		});
		logo.textContent = 'PB';
		const meta = DOM.append(row, DOM.$('div'));
		const name = DOM.append(meta, DOM.$('div'));
		name.textContent = this.productService.nameLong || this.productService.nameShort || 'PreBase';
		Object.assign(name.style, { fontSize: '13px', fontWeight: '600' });
		const ver = DOM.append(meta, DOM.$('div'));
		ver.textContent = localize('prebase.settings.version', "Version {0}", this.productService.version || '0.0.0');
		Object.assign(ver.style, { fontSize: '12px', color: COLORS.textMuted });

		const tagline = DOM.append(block, DOM.$('p'));
		tagline.textContent = localize(
			'prebase.settings.tagline',
			"Real-time software architecture visualization built on the VS Code workbench with PreBase graph and runtime tooling."
		);
		Object.assign(tagline.style, { margin: '0', fontSize: '13px', color: COLORS.textSecondary, lineHeight: '1.5' });

		const langs = this._panel(
			this._main!,
			localize('prebase.settings.langs.title', "Supported languages"),
			localize('prebase.settings.langs.desc', "Graph import analysis and editor syntax highlighting.")
		);
		const list = DOM.append(langs, DOM.$('div'));
		Object.assign(list.style, { padding: '8px 0', maxHeight: '256px', overflowY: 'auto' });
		for (const lang of GRAPH_SUPPORTED_LANGUAGES) {
			const item = DOM.append(list, DOM.$('div'));
			Object.assign(item.style, {
				display: 'flex',
				justifyContent: 'space-between',
				gap: '12px',
				padding: '6px 8px',
				borderRadius: '8px',
			});
			const n = DOM.append(item, DOM.$('span'));
			n.textContent = lang.name;
			Object.assign(n.style, { fontSize: '13px' });
			const e = DOM.append(item, DOM.$('span'));
			e.textContent = lang.extensions;
			Object.assign(e.style, { fontSize: '10px', color: COLORS.textMuted, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' });
		}
	}

	private _renderAdvanced(): void {
		renderGraphAdvanced(this._graphSettingsHost());
	}
}
