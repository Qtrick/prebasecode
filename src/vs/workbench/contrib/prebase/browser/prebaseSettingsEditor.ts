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
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { IEditorOpenContext } from '../../../common/editor.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';
import { IWorkbenchThemeService } from '../../../services/themes/common/workbenchThemeService.js';
import { MANAGE_TRUST_COMMAND_ID } from '../../workspace/common/workspace.js';
import { PREBASE_RESETTABLE_CONFIG_KEYS, PreBaseConfigKeys } from '../common/prebaseConfiguration.js';
import type { LayoutMode } from '../graphs/core/types.js';
import { IPreBaseGraphService } from '../graphs/host/workbench/prebaseGraphService.js';
import { PreBaseSettingsEditorInput } from './prebaseSettingsEditorInput.js';

/** Popular built-in themes (PreBase + stock VS Code / Code - OSS classics). */
const QUICK_THEMES: { id: string; label: string }[] = [
	{ id: 'PreBase Dark', label: 'PreBase Night' },
	{ id: 'PreBase Light', label: 'PreBase Dawn' },
	{ id: 'Dark Modern', label: 'Dark Modern' },
	{ id: 'Light Modern', label: 'Light Modern' },
	{ id: 'Dark+', label: 'Dark+' },
	{ id: 'Light+', label: 'Light+' },
	{ id: 'Visual Studio Dark', label: 'VS Dark' },
	{ id: 'Visual Studio Light', label: 'VS Light' },
	{ id: 'Dark 2026', label: 'Dark 2026' },
	{ id: 'Light 2026', label: 'Light 2026' },
	{ id: 'Abyss', label: 'Abyss' },
	{ id: 'Monokai', label: 'Monokai' },
	{ id: 'Monokai Dimmed', label: 'Monokai Dimmed' },
	{ id: 'Kimbie Dark', label: 'Kimbie Dark' },
	{ id: 'Solarized Dark', label: 'Solarized Dark' },
	{ id: 'Solarized Light', label: 'Solarized Light' },
	{ id: 'Quiet Light', label: 'Quiet Light' },
	{ id: 'Tomorrow Night Blue', label: 'Tomorrow Night Blue' },
	{ id: 'Red', label: 'Red' },
	{ id: 'Default High Contrast', label: 'HC Dark' },
	{ id: 'Default High Contrast Light', label: 'HC Light' },
];

type SettingsCategory =
	| 'appearance'
	| 'graph'
	| 'sidebar'
	| 'editor'
	| 'extensions'
	| 'interaction'
	| 'performance'
	| 'about';

const CATEGORIES: { id: SettingsCategory; label: string; icon: string }[] = [
	{ id: 'appearance', label: localize('prebase.settings.cat.appearance', "Appearance"), icon: '$(symbol-color)' },
	{ id: 'graph', label: localize('prebase.settings.cat.graph', "Graph"), icon: '$(type-hierarchy)' },
	{ id: 'sidebar', label: localize('prebase.settings.cat.sidebar', "Sidebar"), icon: '$(layout-sidebar-left)' },
	{ id: 'editor', label: localize('prebase.settings.cat.editor', "Editor"), icon: '$(edit)' },
	{ id: 'extensions', label: localize('prebase.settings.cat.extensions', "Extensions"), icon: '$(extensions)' },
	{ id: 'interaction', label: localize('prebase.settings.cat.interaction', "Interaction"), icon: '$(target)' },
	{ id: 'performance', label: localize('prebase.settings.cat.performance', "Performance"), icon: '$(dashboard)' },
	{ id: 'about', label: localize('prebase.settings.cat.about', "About"), icon: '$(info)' },
];

const LAYOUT_PRESETS: LayoutMode[] = ['hierarchy', 'pyramid', 'scattered'];

const GRAPH_LANGUAGES: { name: string; extensions: string }[] = [
	{ name: 'TypeScript', extensions: '.ts .tsx .mts .cts' },
	{ name: 'JavaScript', extensions: '.js .jsx .mjs .cjs' },
	{ name: 'Java', extensions: '.java' },
	{ name: 'Kotlin', extensions: '.kt .kts' },
	{ name: 'Python', extensions: '.py' },
	{ name: 'Go', extensions: '.go' },
	{ name: 'Rust', extensions: '.rs' },
	{ name: 'C#', extensions: '.cs' },
	{ name: 'C / C++', extensions: '.c .cpp .cc .cxx .h .hpp' },
	{ name: 'Swift', extensions: '.swift' },
	{ name: 'PHP', extensions: '.php' },
	{ name: 'Ruby', extensions: '.rb' },
];

const COLORS = {
	bg: '#0b1220',
	surface: '#0f172a',
	overlay: '#111827',
	border: '#1e293b',
	muted: '#1e293b',
	text: '#e2e8f0',
	textSecondary: '#94a3b8',
	textMuted: '#64748b',
	accent: '#2dd4bf',
	accentDim: 'rgba(45, 212, 191, 0.15)',
	accentBorder: 'rgba(45, 212, 191, 0.28)',
	navActive: '#1e293b',
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
			background: 'rgba(15, 23, 42, 0.55)',
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
					btn.style.background = 'rgba(30, 41, 59, 0.45)';
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
			background: 'rgba(17, 24, 39, 0.45)',
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
			borderBottom: `1px solid rgba(30, 41, 59, 0.6)`,
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

		const currentThemeId = this.workbenchThemeService.getColorTheme().settingsId
			|| this.workbenchThemeService.getColorTheme().id;
		const themeCtrl = document.createElement('div');
		Object.assign(themeCtrl.style, { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px', maxWidth: '420px' });

		const chips = DOM.append(themeCtrl, DOM.$('div'));
		Object.assign(chips.style, { display: 'flex', flexWrap: 'wrap', gap: '6px', justifyContent: 'flex-end' });
		for (const theme of QUICK_THEMES) {
			const btn = DOM.append(chips, DOM.$('button')) as HTMLButtonElement;
			btn.type = 'button';
			btn.textContent = theme.label;
			const active = currentThemeId === theme.id || currentThemeId.endsWith(theme.id);
			Object.assign(btn.style, {
				background: active ? '#155e75' : '#0f172a',
				color: active ? '#ecfeff' : '#cbd5e1',
				border: active ? '1px solid #22d3ee88' : '1px solid #334155',
				borderRadius: '999px',
				padding: '4px 10px',
				fontSize: '11px',
				cursor: 'pointer',
			});
			this._renderDisposables.add(DOM.addDisposableListener(btn, 'click', () => {
				void this.workbenchThemeService.setColorTheme(theme.id, 'auto').then(result => {
					if (!result) {
						this.notificationService.info(localize(
							'prebase.settings.themeMissing',
							"Theme “{0}” is not available yet. Use the full theme picker, or ensure built-in theme extensions are built.",
							theme.label
						));
					}
				});
			}));
		}

		const themeNote = DOM.append(themeCtrl, DOM.$('span'));
		themeNote.textContent = localize(
			'prebase.settings.themeUsesWorkbench',
			"Includes PreBase + VS Code classics (Dark+, Light+, Abyss, Monokai, …)"
		);
		Object.assign(themeNote.style, { fontSize: '11px', color: COLORS.textMuted, textAlign: 'right' });
		themeCtrl.appendChild(this._linkBtn(localize('prebase.settings.openTheme', "Browse all themes…"), () => {
			void this.commandService.executeCommand('workbench.action.selectTheme');
		}));
		this._row(
			card,
			localize('prebase.settings.theme', "Theme"),
			localize('prebase.settings.themeHint', "Pick a built-in theme or open the full Color Theme picker."),
			themeCtrl
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

		const reduce = this._accentCheckbox();
		reduce.checked = this._get(PreBaseConfigKeys.GraphReduceMotion, false);
		this._renderDisposables.add(DOM.addDisposableListener(reduce, 'change', () => void this._set(PreBaseConfigKeys.GraphReduceMotion, reduce.checked)));
		this._row(card, localize('prebase.settings.reduceMotion', "Reduce motion"), localize('prebase.settings.reduceMotionHint', "Minimizes graph and UI animations."), reduce);

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
		const card = this._panel(
			this._main!,
			localize('prebase.settings.graph.title', "Graph"),
			localize('prebase.settings.graph.desc', "Default layout and architecture map display.")
		);

		const layout = document.createElement('select');
		this._selectStyle(layout);
		for (const m of LAYOUT_PRESETS) {
			const opt = document.createElement('option');
			opt.value = m;
			opt.textContent = m;
			layout.appendChild(opt);
		}
		layout.value = this._get(PreBaseConfigKeys.GraphDefaultArchitectureLayout, 'hierarchy');
		this._renderDisposables.add(DOM.addDisposableListener(layout, 'change', async () => {
			const mode = layout.value as LayoutMode;
			await this._set(PreBaseConfigKeys.GraphDefaultArchitectureLayout, mode);
			await this.graphService.setLayoutMode(mode);
		}));
		this._row(card, localize('prebase.settings.defaultLayout', "Default layout"), undefined, layout);

		const session = document.createElement('span');
		session.textContent = this.graphService.getViewState().layoutMode;
		Object.assign(session.style, { fontSize: '12px', color: COLORS.accent, textTransform: 'capitalize' });
		this._row(card, localize('prebase.settings.sessionLayout', "Session layout"), localize('prebase.settings.sessionLayoutHint', "Active layout for the current project."), session);

		const zoom = this._range(0.5, 1.4, 0.02, this._get(PreBaseConfigKeys.GraphInitialZoom, 0.92));
		this._renderDisposables.add(DOM.addDisposableListener(zoom, 'input', () => void this._set(PreBaseConfigKeys.GraphInitialZoom, Number(zoom.value))));
		this._row(card, localize('prebase.settings.initialZoom', "Initial zoom"), localize('prebase.settings.initialZoomHint', "Camera zoom when a project first loads."), zoom);

		const edgeLabels = this._accentCheckbox();
		edgeLabels.checked = this._get(PreBaseConfigKeys.GraphShowEdgeLabels, false);
		this._renderDisposables.add(DOM.addDisposableListener(edgeLabels, 'change', () => void this._set(PreBaseConfigKeys.GraphShowEdgeLabels, edgeLabels.checked)));
		this._row(card, localize('prebase.settings.edgeLabels', "Edge import labels"), localize('prebase.settings.edgeLabelsHint', "Show import paths on dependency edges."), edgeLabels);

		const dimWrap = document.createElement('div');
		Object.assign(dimWrap.style, { display: 'flex', alignItems: 'center', gap: '8px' });
		const dimVal = this._get(PreBaseConfigKeys.GraphLegendInteractionDim, 40);
		const dim = this._range(0, 80, 5, dimVal);
		const dimLabel = document.createElement('span');
		dimLabel.textContent = `${dimVal}%`;
		Object.assign(dimLabel.style, { fontSize: '10px', color: COLORS.textMuted, fontVariantNumeric: 'tabular-nums' });
		this._renderDisposables.add(DOM.addDisposableListener(dim, 'input', () => {
			dimLabel.textContent = `${dim.value}%`;
			void this._set(PreBaseConfigKeys.GraphLegendInteractionDim, Number(dim.value));
		}));
		dimWrap.append(dim, dimLabel);
		this._row(
			card,
			localize('prebase.settings.legendDim', "Legend dim during interaction"),
			localize('prebase.settings.legendDimHint', "How much the architecture legend fades while panning, zooming, or selecting."),
			dimWrap
		);
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
			"API keys and secrets are never shown in this UI. Configure Gemini and other keys in your project .env file."
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
		const card = this._panel(
			this._main!,
			localize('prebase.settings.interaction.title', "Interaction"),
			localize('prebase.settings.interaction.desc', "Pan and zoom behavior.")
		);

		const pan = this._range(0.5, 2, 0.1, this._get(PreBaseConfigKeys.InteractionPanSensitivity, 1));
		this._renderDisposables.add(DOM.addDisposableListener(pan, 'input', () => void this._set(PreBaseConfigKeys.InteractionPanSensitivity, Number(pan.value))));
		this._row(card, localize('prebase.settings.panSensitivity', "Pan sensitivity"), undefined, pan);

		const zoom = this._range(0.5, 2, 0.1, this._get(PreBaseConfigKeys.InteractionZoomSensitivity, 1));
		this._renderDisposables.add(DOM.addDisposableListener(zoom, 'input', () => void this._set(PreBaseConfigKeys.InteractionZoomSensitivity, Number(zoom.value))));
		this._row(card, localize('prebase.settings.zoomSensitivity', "Zoom sensitivity"), undefined, zoom);

		const drag = document.createElement('select');
		this._selectStyle(drag);
		for (const [v, label] of [['natural', 'Natural'], ['inverted', 'Inverted']] as const) {
			const opt = document.createElement('option');
			opt.value = v;
			opt.textContent = label;
			drag.appendChild(opt);
		}
		drag.value = this._get(PreBaseConfigKeys.InteractionNetworkDragDirection, 'natural');
		this._renderDisposables.add(DOM.addDisposableListener(drag, 'change', () => void this._set(PreBaseConfigKeys.InteractionNetworkDragDirection, drag.value)));
		this._row(
			card,
			localize('prebase.settings.networkDrag', "Network drag direction"),
			localize('prebase.settings.networkDragHint', "Natural follows cursor drag like grabbing the sphere; Inverted rotates opposite to cursor."),
			drag
		);

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
		const card = this._panel(
			this._main!,
			localize('prebase.settings.performance.title', "Performance"),
			localize('prebase.settings.performance.desc', "Rendering quality and graph limits.")
		);

		const quality = document.createElement('select');
		this._selectStyle(quality);
		for (const [v, label] of [['balanced', 'Balanced'], ['performance', 'Performance']] as const) {
			const opt = document.createElement('option');
			opt.value = v;
			opt.textContent = label;
			quality.appendChild(opt);
		}
		const q = this._get<string>(PreBaseConfigKeys.GraphQuality, 'balanced');
		quality.value = (q === 'performance') ? 'performance' : 'balanced';
		this._renderDisposables.add(DOM.addDisposableListener(quality, 'change', () => void this._set(PreBaseConfigKeys.GraphQuality, quality.value)));
		this._row(card, localize('prebase.settings.graphQuality', "Graph quality"), localize('prebase.settings.graphQualityHint', "Performance mode reduces edge animation."), quality);
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
		for (const lang of GRAPH_LANGUAGES) {
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
		const card = DOM.append(this._advanced!, DOM.$('div'));
		Object.assign(card.style, {
			borderRadius: '12px',
			border: `1px solid ${COLORS.border}`,
			background: 'rgba(17, 24, 39, 0.35)',
			padding: '0 16px',
		});
		const head = DOM.append(card, DOM.$('div'));
		Object.assign(head.style, { padding: '12px 0', borderBottom: `1px solid rgba(30, 41, 59, 0.6)`, marginBottom: '4px' });
		const h = DOM.append(head, DOM.$('h3'));
		h.textContent = localize('prebase.settings.advanced', "Advanced");
		Object.assign(h.style, { margin: '0', fontSize: '13px', fontWeight: '600' });
		const d = DOM.append(head, DOM.$('p'));
		d.textContent = this._category === 'graph'
			? localize('prebase.settings.advancedGraphHint', "Layout changes apply after relayout.")
			: localize('prebase.settings.advancedHint', "Fine-tuned controls for this category.");
		Object.assign(d.style, { margin: '2px 0 0', fontSize: '11px', color: COLORS.textMuted });

		if (this._category === 'graph') {
			this._advNumber(card, localize('prebase.settings.layoutAnim', "Layout animation"), localize('prebase.settings.layoutAnimHint', "Fit-view duration in milliseconds."), PreBaseConfigKeys.GraphLayoutAnimationDuration, 750, 0, 2000, 50);
			this._advRange(card, localize('prebase.settings.layerRadius', "Layer radius scale"), localize('prebase.settings.layerRadiusHint', "Scales concentric ring radii."), PreBaseConfigKeys.GraphLayerRadiusScale, 1, 0.7, 1.4, 0.05);
			this._advNumber(card, localize('prebase.settings.maxPerLayer', "Max nodes per layer"), localize('prebase.settings.maxPerLayerHint', "Before an overflow sub-ring is added."), PreBaseConfigKeys.GraphMaxNodesPerLayer, 24, 8, 48, 1);
			this._advNumber(card, localize('prebase.settings.layerGap', "Layer gap"), localize('prebase.settings.layerGapHint', "Distance between dependency rings."), PreBaseConfigKeys.GraphLayerGap, 96, 80, 200, 4);
			this._advNumber(card, localize('prebase.settings.centerClearance', "Center clearance"), localize('prebase.settings.centerClearanceHint', "Radius of the innermost ring."), PreBaseConfigKeys.GraphCenterClearance, 80, 64, 160, 4);
			this._advNumber(card, localize('prebase.settings.scatterPasses', "Scatter balance passes"), localize('prebase.settings.scatterPassesHint', "Spacing relaxation iterations."), PreBaseConfigKeys.GraphScatterRelaxIterations, 10, 4, 24, 1);
			this._advRange(card, localize('prebase.settings.folderRadius', "Folder expansion radius"), localize('prebase.settings.folderRadiusHint', "Tree mode radial child layout."), PreBaseConfigKeys.GraphFolderExpansionRadius, 82, 48, 160, 4);
			this._advRange(card, localize('prebase.settings.visibleRelated', "Visible related connections"), localize('prebase.settings.visibleRelatedHint', "Root link always shown; controls extra ranked links per file (0–2)."), PreBaseConfigKeys.GraphVisibleRelatedConnections, 1, 0, 2, 1, true);

			const netHead = DOM.append(card, DOM.$('div'));
			Object.assign(netHead.style, { padding: '8px 0', borderBottom: `1px solid rgba(30, 41, 59, 0.6)` });
			const nh = DOM.append(netHead, DOM.$('p'));
			nh.textContent = localize('prebase.settings.networkGraph', "Network graph");
			Object.assign(nh.style, { margin: '0', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.06em', color: COLORS.textMuted });

			const autoRotate = this._accentCheckbox();
			autoRotate.checked = this._get(PreBaseConfigKeys.GraphNetworkIdleAutoRotate, false);
			this._renderDisposables.add(DOM.addDisposableListener(autoRotate, 'change', () => void this._set(PreBaseConfigKeys.GraphNetworkIdleAutoRotate, autoRotate.checked)));
			this._row(card, localize('prebase.settings.autoRotate', "Auto-rotate when idle"), localize('prebase.settings.autoRotateHint', "Slowly rotates the network graph when you are not interacting."), autoRotate);

			this._advRange(card, localize('prebase.settings.physics', "Physics strength"), localize('prebase.settings.physicsHint', "Scales repulsion and centering forces in the network view."), PreBaseConfigKeys.GraphNetworkPhysicsStrength, 1, 0.5, 2, 0.05, true);
			this._advRange(card, localize('prebase.settings.edgeOpacity', "Edge opacity"), localize('prebase.settings.edgeOpacityHint', "Network link visibility. Higher is more readable."), PreBaseConfigKeys.GraphNetworkEdgeOpacity, 0.55, 0.2, 0.9, 0.05, true);

			const applyRow = DOM.append(card, DOM.$('div'));
			Object.assign(applyRow.style, { padding: '12px 0' });
			const apply = this._btn(localize('prebase.settings.applyLayout', "Apply layout now"), true);
			this._renderDisposables.add(DOM.addDisposableListener(apply, 'click', () => {
				void this.graphService.relayout();
			}));
			applyRow.appendChild(apply);
		}

		if (this._category === 'interaction') {
			const wrap = document.createElement('div');
			Object.assign(wrap.style, { display: 'flex', alignItems: 'center', gap: '8px' });
			const delay = this._get(PreBaseConfigKeys.InteractionNodeDragDelayMs, 200);
			const range = this._range(80, 400, 10, delay);
			const label = document.createElement('span');
			label.textContent = `${delay}ms`;
			Object.assign(label.style, { fontSize: '10px', color: COLORS.textMuted, width: '40px', textAlign: 'right' });
			this._renderDisposables.add(DOM.addDisposableListener(range, 'input', () => {
				label.textContent = `${range.value}ms`;
				void this._set(PreBaseConfigKeys.InteractionNodeDragDelayMs, Number(range.value) || 200);
			}));
			wrap.append(range, label);
			this._row(
				card,
				localize('prebase.settings.nodeDragHover', "Node drag hover delay"),
				localize('prebase.settings.nodeDragHoverHint', "Hover delay (ms) before a graph node becomes draggable. Unrelated to Agents chat modes."),
				wrap
			);
		}

		if (this._category === 'performance') {
			this._advNumber(card, localize('prebase.settings.maxNodes', "Max rendered nodes"), localize('prebase.settings.maxNodesHint', "Caps visible nodes by importance."), PreBaseConfigKeys.GraphMaxRenderedNodes, 280, 50, 2000, 50);
			this._advNumber(card, localize('prebase.settings.renderThrottle', "Render throttle"), localize('prebase.settings.renderThrottleHint', "Delays graph node/edge sync (ms)."), PreBaseConfigKeys.GraphRenderThrottleMs, 0, 0, 100, 1);
			this._advNumber(card, localize('prebase.settings.networkLod', "Network LOD threshold"), localize('prebase.settings.networkLodHint', "Above this node count, network view uses performance mode."), PreBaseConfigKeys.GraphNetworkLodNodeThreshold, 900, 400, 3000, 100);
			this._advNumber(card, localize('prebase.settings.simTicks', "Network simulation ticks"), localize('prebase.settings.simTicksHint', "Force layout warmup/cooldown scale."), PreBaseConfigKeys.GraphNetworkSimulationTicks, 80, 20, 200, 1);
		}
	}

	private _advNumber(parent: HTMLElement, label: string, hint: string, key: string, fallback: number, min: number, max: number, step: number): void {
		const input = document.createElement('input');
		input.type = 'number';
		input.min = String(min);
		input.max = String(max);
		input.step = String(step);
		this._inputStyle(input);
		input.value = String(this._get(key, fallback));
		this._renderDisposables.add(DOM.addDisposableListener(input, 'change', () => {
			const n = Number(input.value);
			void this._set(key, Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback);
		}));
		this._row(parent, label, hint, input);
	}

	private _advRange(parent: HTMLElement, label: string, hint: string, key: string, fallback: number, min: number, max: number, step: number, showValue = false): void {
		const wrap = document.createElement('div');
		Object.assign(wrap.style, { display: 'flex', alignItems: 'center', gap: '8px' });
		const value = this._get(key, fallback);
		const range = this._range(min, max, step, value);
		const valEl = document.createElement('span');
		valEl.textContent = showValue ? String(Number(Number(value).toFixed(2))) : '';
		Object.assign(valEl.style, { fontSize: '10px', color: COLORS.textMuted, width: showValue ? '28px' : '0', textAlign: 'right' });
		this._renderDisposables.add(DOM.addDisposableListener(range, 'input', () => {
			const n = Number(range.value);
			if (showValue) {
				valEl.textContent = String(Number(n.toFixed(2)));
			}
			void this._set(key, n);
		}));
		wrap.appendChild(range);
		if (showValue) {
			wrap.appendChild(valEl);
		}
		this._row(parent, label, hint, wrap);
	}
}
