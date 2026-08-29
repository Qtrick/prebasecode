/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../base/browser/dom.js';
import { localize, localize2 } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { ViewPane } from '../../../browser/parts/views/viewPane.js';
import { IViewletViewOptions } from '../../../browser/parts/views/viewsViewlet.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { IPreBaseRuntimeService, type PreBaseViewportPreset } from './prebaseRuntimeService.js';

export class PreBaseRuntimeViewPane extends ViewPane {
	static readonly ID = 'workbench.view.prebase.runtime.explorer';
	static readonly LABEL = localize2('prebase.runtime.view', "Runtime Preview");

	private _body: HTMLElement | undefined;
	private _targetMeta: HTMLElement | undefined;
	private _scriptSelect: HTMLSelectElement | undefined;
	private _urlInput: HTMLInputElement | undefined;
	private _sessionMeta: HTMLElement | undefined;
	private _viewportMeta: HTMLElement | undefined;
	private _widthInput: HTMLInputElement | undefined;
	private _heightInput: HTMLInputElement | undefined;
	private _zoomInput: HTMLInputElement | undefined;
	private _diagMeta: HTMLElement | undefined;
	private _testMeta: HTMLElement | undefined;
	private _reportsList: HTMLElement | undefined;
	private _desktopSection: HTMLElement | undefined;
	private _desktopMeta: HTMLElement | undefined;
	private _desktopManagedBtn: HTMLButtonElement | undefined;
	private _desktopExternalBtn: HTMLButtonElement | undefined;
	private _desktopEnableBtn: HTMLButtonElement | undefined;
	private _desktopElectronBtn: HTMLButtonElement | undefined;
	private _desktopTauriBtn: HTMLButtonElement | undefined;
	private _desktopFrameworkRow: HTMLElement | undefined;
	private readonly _responsiveRows: HTMLElement[] = [];

	constructor(
		options: IViewletViewOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@IPreBaseRuntimeService private readonly runtimeService: IPreBaseRuntimeService,
		@ICommandService private readonly commandService: ICommandService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
		this._register(this.runtimeService.onDidChangeSession(() => this._refresh()));
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		this._body = DOM.append(container, DOM.$('.prebase-runtime-view'));
		this._body.style.padding = '10px';
		this._body.style.display = 'flex';
		this._body.style.flexDirection = 'column';
		this._body.style.gap = '14px';
		this._body.style.overflow = 'auto';

		// --- Preview target
		this._section(localize('prebase.runtime.target', "Preview Target"), (section) => {
			this._targetMeta = DOM.append(section, DOM.$('div'));
			this._styleMeta(this._targetMeta);

			this._scriptSelect = DOM.append(section, DOM.$('select')) as HTMLSelectElement;
			this._styleControl(this._scriptSelect);
			this._register(DOM.addDisposableListener(this._scriptSelect, 'change', () => {
				if (this._scriptSelect?.value) {
					this.runtimeService.selectScript(this._scriptSelect.value);
				}
			}));

			const row = DOM.append(section, DOM.$('.prebase-runtime-btn-row'));
			this._responsiveRow(row);
			this._btn(row, localize('prebase.runtime.start', "Start"), () => this.commandService.executeCommand('prebase.runtime.start'), 'primary');
			this._btn(row, localize('prebase.runtime.stop', "Stop"), () => this.commandService.executeCommand('prebase.runtime.stop'), 'secondary');
			this._btn(row, localize('prebase.runtime.restart', "Restart"), () => this.commandService.executeCommand('prebase.runtime.restart'), 'secondary');
			this._btn(row, localize('prebase.runtime.openTerminal', "Open Terminal"), () => this.commandService.executeCommand('prebase.runtime.openTerminal'), 'secondary');
			const detectBtn = this._btn(row, localize('prebase.runtime.detect', "Detect"), () => this.commandService.executeCommand('prebase.runtime.detectConfigurations'), 'secondary');
			detectBtn.setAttribute('aria-label', localize('prebase.runtime.detectAria', "Detect Configurations"));
		});

		// --- Desktop launch (Electron)
		this._desktopSection = this._section(localize('prebase.runtime.desktopLaunch', "Desktop"), (section) => {
			this._desktopFrameworkRow = DOM.append(section, DOM.$('.prebase-runtime-btn-row'));
			this._responsiveRow(this._desktopFrameworkRow);
			this._desktopFrameworkRow.setAttribute('role', 'group');
			this._desktopFrameworkRow.setAttribute('aria-label', localize('prebase.runtime.desktopFrameworkGroup', "Desktop framework"));
			this._desktopFrameworkRow.style.display = 'none';
			this._desktopElectronBtn = this._btn(this._desktopFrameworkRow, localize('prebase.runtime.desktopElectron', "Electron"), () => this.commandService.executeCommand('prebase.runtime.selectDesktopFramework', 'electron'));
			this._desktopElectronBtn.setAttribute('aria-pressed', 'false');
			this._desktopTauriBtn = this._btn(this._desktopFrameworkRow, localize('prebase.runtime.desktopTauri', "Tauri"), () => this.commandService.executeCommand('prebase.runtime.selectDesktopFramework', 'tauri'));
			this._desktopTauriBtn.setAttribute('aria-pressed', 'false');

			const modeRow = DOM.append(section, DOM.$('.prebase-runtime-btn-row'));
			this._responsiveRow(modeRow);
			modeRow.setAttribute('role', 'group');
			modeRow.setAttribute('aria-label', localize('prebase.runtime.desktopModeGroup', "Desktop launch mode"));
			this._desktopManagedBtn = this._btn(modeRow, localize('prebase.runtime.desktopManaged', "Renderer"), () => this.commandService.executeCommand('prebase.runtime.selectDesktopLaunchMode', 'managed'));
			this._desktopManagedBtn.setAttribute('aria-pressed', 'false');
			this._desktopManagedBtn.setAttribute('aria-label', localize('prebase.runtime.desktopManagedAria', "Renderer mode: test the web frontend without the desktop backend"));
			this._desktopExternalBtn = this._btn(modeRow, localize('prebase.runtime.desktopExternal', "Full app"), () => this.commandService.executeCommand('prebase.runtime.selectDesktopLaunchMode', 'external'));
			this._desktopExternalBtn.setAttribute('aria-pressed', 'false');
			this._desktopExternalBtn.setAttribute('aria-label', localize('prebase.runtime.desktopExternalAria', "Full app mode: launch the real Electron or Tauri application"));

			this._desktopMeta = DOM.append(section, DOM.$('div'));
			this._styleMeta(this._desktopMeta);

			const desktopRow = DOM.append(section, DOM.$('.prebase-runtime-btn-row'));
			this._responsiveRow(desktopRow);
			this._btn(desktopRow, localize('prebase.runtime.desktopStart', "Start Desktop"), () => this.commandService.executeCommand('prebase.runtime.startDesktop'), 'primary');
			this._btn(desktopRow, localize('prebase.runtime.desktopStop', "Stop Desktop"), () => this.commandService.executeCommand('prebase.runtime.stopDesktop'), 'secondary');
			this._btn(desktopRow, localize('prebase.runtime.desktopRestart', "Restart Desktop"), () => this.commandService.executeCommand('prebase.runtime.restartDesktop'), 'secondary');
			this._btn(desktopRow, localize('prebase.runtime.desktopKill', "Kill Session"), () => this.commandService.executeCommand('prebase.runtime.killDesktopSession'), 'secondary');
			this._desktopEnableBtn = this._btn(section, localize('prebase.runtime.enableTauriTesting', "Enable PreBase Tauri Testing…"), () => this.commandService.executeCommand('prebase.runtime.enableTauriTesting'));
			this._desktopEnableBtn.style.display = 'none';
			this._desktopEnableBtn.style.marginTop = '6px';
			this._desktopEnableBtn.setAttribute('aria-label', localize('prebase.runtime.enableTauriTestingAria', "Enable debug-only Tauri WebDriver plugins for full-app testing"));
		});
		this._desktopSection.style.display = 'none';

		// --- Session
		this._section(localize('prebase.runtime.session', "Session"), (section) => {
			this._urlInput = DOM.append(section, DOM.$('input')) as HTMLInputElement;
			this._urlInput.type = 'text';
			this._urlInput.placeholder = 'http://localhost:5173';
			this._styleControl(this._urlInput);
			this._register(DOM.addDisposableListener(this._urlInput, 'keydown', async (e) => {
				if (e.key === 'Enter' && this._urlInput) {
					await this.runtimeService.connectUrl(this._urlInput.value);
				}
			}));

			this._sessionMeta = DOM.append(section, DOM.$('div'));
			this._styleMeta(this._sessionMeta);

			const nav = DOM.append(section, DOM.$('.prebase-runtime-btn-row'));
			this._responsiveRow(nav);
			this._btn(nav, localize('prebase.runtime.connect', "Connect"), () => this.commandService.executeCommand('prebase.runtime.connect'), 'primary');
			this._btn(nav, localize('prebase.runtime.reload', "Reload"), () => this.commandService.executeCommand('prebase.runtime.reload'), 'secondary');
			this._btn(nav, localize('prebase.runtime.back', "Back"), () => this.commandService.executeCommand('prebase.runtime.goBack'), 'secondary');
			this._btn(nav, localize('prebase.runtime.forward', "Forward"), () => this.commandService.executeCommand('prebase.runtime.goForward'), 'secondary');
			const advancedNav = DOM.append(section, DOM.$('.prebase-runtime-btn-row'));
			this._responsiveRow(advancedNav);
			this._btn(advancedNav, localize('prebase.runtime.openExternal', "Open External"), () => this.commandService.executeCommand('prebase.runtime.openExternal'), 'secondary');
			this._btn(advancedNav, localize('prebase.runtime.copyUrl', "Copy URL"), () => this.commandService.executeCommand('prebase.runtime.copyUrl'), 'secondary');
		});

		// --- Device / viewport
		this._section(localize('prebase.runtime.viewport', "Device / Viewport"), (section) => {
			const presets: PreBaseViewportPreset[] = ['responsive', 'desktop', 'laptop', 'tablet', 'mobile'];
			const presetRow = DOM.append(section, DOM.$('.prebase-runtime-btn-row'));
			this._responsiveRow(presetRow);
			for (const preset of presets) {
				this._btn(presetRow, preset[0].toUpperCase() + preset.slice(1), () => {
					this.runtimeService.setViewportPreset(preset);
				});
			}

			const sizeRow = DOM.append(section, DOM.$('div'));
			this._responsiveRow(sizeRow);
			sizeRow.style.marginTop = '6px';

			this._widthInput = DOM.append(sizeRow, DOM.$('input')) as HTMLInputElement;
			this._widthInput.type = 'number';
			this._widthInput.placeholder = 'W';
			this._styleControl(this._widthInput);
			this._heightInput = DOM.append(sizeRow, DOM.$('input')) as HTMLInputElement;
			this._heightInput.type = 'number';
			this._heightInput.placeholder = 'H';
			this._styleControl(this._heightInput);

			this._register(DOM.addDisposableListener(this._widthInput, 'change', () => this._applySize()));
			this._register(DOM.addDisposableListener(this._heightInput, 'change', () => this._applySize()));

			this._zoomInput = DOM.append(section, DOM.$('input')) as HTMLInputElement;
			this._zoomInput.type = 'number';
			this._zoomInput.step = '0.1';
			this._zoomInput.min = '0.25';
			this._zoomInput.max = '3';
			this._zoomInput.placeholder = 'Zoom';
			this._styleControl(this._zoomInput);
			this._register(DOM.addDisposableListener(this._zoomInput, 'change', () => {
				if (this._zoomInput) {
					this.runtimeService.setZoom(Number(this._zoomInput.value) || 1);
				}
			}));

			this._btn(section, localize('prebase.runtime.rotate', "Rotate"), () => this.commandService.executeCommand('prebase.runtime.rotateViewport'));
			this._viewportMeta = DOM.append(section, DOM.$('div'));
			this._styleMeta(this._viewportMeta);
		});

		// --- Inspection / diagnostics
		this._section(localize('prebase.runtime.diagnostics', "Inspection / Diagnostics"), (section) => {
			this._diagMeta = DOM.append(section, DOM.$('div'));
			this._styleMeta(this._diagMeta);
			const row = DOM.append(section, DOM.$('.prebase-runtime-btn-row'));
			this._responsiveRow(row);
			this._btn(row, localize('prebase.runtime.inspect', "Inspect"), () => this.commandService.executeCommand('prebase.runtime.inspect'));
			this._btn(row, localize('prebase.runtime.clearDiag', "Clear"), () => this.commandService.executeCommand('prebase.runtime.clearDiagnostics'));
			this._btn(section, localize('prebase.runtime.screenshot', "Capture Screenshot"), () => this.commandService.executeCommand('prebase.runtime.captureScreenshot'));
		});

		// --- Testing / reports
		this._section(localize('prebase.runtime.testing', "Testing / Reports"), (section) => {
			this._testMeta = DOM.append(section, DOM.$('div'));
			this._styleMeta(this._testMeta);
			const row = DOM.append(section, DOM.$('.prebase-runtime-btn-row'));
			this._responsiveRow(row);
			this._btn(row, localize('prebase.runtime.startTest', "Start Test"), () => this.commandService.executeCommand('prebase.runtime.startTestSession'), 'primary');
			this._btn(row, localize('prebase.runtime.stopTest', "Stop Test"), () => this.commandService.executeCommand('prebase.runtime.stopTestSession'), 'secondary');
			this._btn(row, localize('prebase.runtime.replayTest', "Replay"), () => this.commandService.executeCommand('prebase.runtime.replayTest'), 'secondary');
			this._btn(row, localize('prebase.runtime.showReports', "Reports"), () => this.commandService.executeCommand('prebase.runtime.showReports'), 'secondary');
			this._reportsList = DOM.append(section, DOM.$('div'));
			this._styleMeta(this._reportsList);
		});

		// --- Magnus
		this._section(localize('prebase.runtime.magnus', "Agents"), (section) => {
			this._btn(section, localize('prebase.runtime.attachMagnus', "Attach Runtime Context"), () => this.commandService.executeCommand('prebase.runtime.attachToMagnus'));
			this._btn(section, localize('prebase.runtime.testMagnus', "Test with Agents"), () => this.commandService.executeCommand('prebase.runtime.testWithMagnus'));
			this._btn(section, localize('prebase.runtime.explainElement', "Explain Element"), () => this.commandService.executeCommand('prebase.runtime.explainElement'));
		});

		void this.runtimeService.detectConfigurations();
		this._refresh();
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		const columns = width < 240 ? '1fr' : '1fr 1fr';
		for (const row of this._responsiveRows) {
			row.style.gridTemplateColumns = columns;
		}
	}

	private _responsiveRow(row: HTMLElement): void {
		row.style.display = 'grid';
		row.style.gridTemplateColumns = '1fr 1fr';
		row.style.gap = '4px';
		this._responsiveRows.push(row);
	}

	private _applySize(): void {
		const w = Number(this._widthInput?.value);
		const h = Number(this._heightInput?.value);
		if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
			this.runtimeService.setViewportSize(w, h);
		}
	}

	private _section(title: string, fill: (section: HTMLElement) => void): HTMLElement {
		const section = DOM.append(this._body!, DOM.$('.prebase-runtime-section'));
		const heading = DOM.append(section, DOM.$('h3'));
		heading.textContent = title;
		heading.style.fontWeight = '600';
		heading.style.margin = '0 0 6px';
		heading.style.fontSize = '12px';
		heading.style.letterSpacing = '0.02em';
		heading.style.textTransform = 'uppercase';
		heading.style.opacity = '0.85';
		fill(section);
		return section;
	}

	private _styleControl(el: HTMLElement): void {
		el.style.width = '100%';
		el.style.boxSizing = 'border-box';
		el.style.marginBottom = '6px';
		el.style.padding = '6px 8px';
		el.style.borderRadius = '6px';
		el.style.border = '1px solid var(--vscode-sideBar-border, var(--vscode-panel-border, #2A2B2C))';
		el.style.background = 'var(--vscode-input-background, #202122)';
		el.style.color = 'var(--vscode-input-foreground, #f4f4f5)';
	}

	private _styleMeta(el: HTMLElement): void {
		el.style.fontSize = '12px';
		el.style.marginBottom = '6px';
		el.style.opacity = '0.9';
		el.style.whiteSpace = 'pre-wrap';
		el.style.lineHeight = '1.4';
	}

	private _btn(parent: HTMLElement, label: string, onClick: () => void, kind: 'primary' | 'secondary' = 'secondary'): HTMLButtonElement {
		const btn = DOM.append(parent, DOM.$('button')) as HTMLButtonElement;
		btn.type = 'button';
		btn.textContent = label;
		btn.style.display = 'block';
		btn.style.width = '100%';
		btn.style.marginBottom = '4px';
		btn.style.padding = '7px 8px';
		btn.style.borderRadius = 'var(--vscode-cornerRadius-medium, 6px)';
		btn.style.border = '1px solid var(--vscode-button-border, transparent)';
		btn.style.background = kind === 'primary'
			? 'var(--vscode-button-background)'
			: 'var(--vscode-button-secondaryBackground)';
		btn.style.color = kind === 'primary'
			? 'var(--vscode-button-foreground)'
			: 'var(--vscode-button-secondaryForeground)';
		btn.style.cursor = 'pointer';
		btn.style.fontSize = 'var(--vscode-bodyFontSize-small, 12px)';
		this._register(DOM.addDisposableListener(btn, 'click', onClick));
		return btn;
	}

	private _refresh(): void {
		const session = this.runtimeService.getSession();
		const desktop = session.desktopProfile;
		const recognized = desktop && (desktop.confidence === 'high' || desktop.confidence === 'medium');

		if (this._desktopSection) {
			this._desktopSection.style.display = recognized ? 'block' : 'none';
		}
		if (this._desktopMeta && recognized && desktop) {
			const mode = session.desktopLaunchMode === 'external' ? 'Full app' : 'Renderer';
			const status = session.desktopSessionState
				?? (session.desktopSessionActive ? 'Ready' : 'Not running');
			const others = (session.desktopProfiles ?? []).filter(profile => profile.framework !== desktop.framework && (profile.confidence === 'high' || profile.confidence === 'medium'));
			const lines = [
				others.length
					? localize('prebase.runtime.desktopFrameworkBoth', "{0} (also {1})", desktop.label, others.map(profile => profile.label).join(', '))
					: localize('prebase.runtime.desktopFramework', "{0}", desktop.label),
				localize('prebase.runtime.desktopMode', "Mode: {0}", mode),
				localize('prebase.runtime.desktopStatus', "Status: {0}", status),
			];
			if (desktop.capabilities.fullNativeSetupRequired && session.desktopLaunchMode === 'external') {
				lines.push(localize('prebase.runtime.desktopSetup', "Renderer testing is available. Full-app Tauri testing needs a debug-only integration."));
			} else if (desktop.capabilities.limitations[0]) {
				lines.push(desktop.capabilities.limitations[0]);
			}
			this._desktopMeta.textContent = lines.join('\n');
			this._desktopMeta.setAttribute('role', 'status');
			this._desktopMeta.setAttribute('aria-live', 'polite');
			this._desktopMeta.setAttribute('aria-atomic', 'true');
		}
		if (this._desktopFrameworkRow && this._desktopElectronBtn && this._desktopTauriBtn) {
			const profiles = session.desktopProfiles ?? [];
			const both = profiles.some(profile => profile.framework === 'electron' && (profile.confidence === 'high' || profile.confidence === 'medium'))
				&& profiles.some(profile => profile.framework === 'tauri' && (profile.confidence === 'high' || profile.confidence === 'medium'));
			this._desktopFrameworkRow.style.display = both ? 'grid' : 'none';
			this._desktopElectronBtn.setAttribute('aria-pressed', String(desktop?.framework === 'electron'));
			this._desktopTauriBtn.setAttribute('aria-pressed', String(desktop?.framework === 'tauri'));
			this._desktopElectronBtn.style.outline = desktop?.framework === 'electron' ? '2px solid var(--vscode-focusBorder)' : '';
			this._desktopTauriBtn.style.outline = desktop?.framework === 'tauri' ? '2px solid var(--vscode-focusBorder)' : '';
		}
		if (this._desktopEnableBtn) {
			const setup = Boolean(recognized && desktop?.capabilities.fullNativeSetupRequired && session.desktopLaunchMode === 'external');
			this._desktopEnableBtn.style.display = setup ? 'block' : 'none';
		}
		if (this._desktopManagedBtn) {
			const selected = session.desktopLaunchMode === 'managed';
			this._desktopManagedBtn.style.outline = selected ? '2px solid var(--vscode-focusBorder)' : '';
			this._desktopManagedBtn.setAttribute('aria-pressed', String(selected));
		}
		if (this._desktopExternalBtn) {
			const selected = session.desktopLaunchMode === 'external';
			this._desktopExternalBtn.style.outline = selected ? '2px solid var(--vscode-focusBorder)' : '';
			this._desktopExternalBtn.setAttribute('aria-pressed', String(selected));
		}

		if (this._targetMeta) {
			this._targetMeta.textContent = [
				localize('prebase.runtime.frameworkLabel', "Framework: {0}", session.framework?.label ?? '—'),
				localize('prebase.runtime.rootLabel', "Root: {0}", session.workspaceRoot || '—'),
				localize('prebase.runtime.pmLabel', "Package manager: {0}", session.packageManager ?? '—'),
				localize('prebase.runtime.serverLabel', "Server: {0}", session.serverRunning ? 'running' : 'stopped')
			].join('\n');
		}

		if (this._scriptSelect) {
			const prev = this._scriptSelect.value;
			while (this._scriptSelect.options.length) {
				this._scriptSelect.remove(0);
			}
			if (!session.scripts.length) {
				const opt = document.createElement('option');
				opt.value = '';
				opt.textContent = localize('prebase.runtime.noScriptsOpt', "No scripts detected");
				this._scriptSelect.add(opt);
			} else {
				for (const script of session.scripts) {
					const opt = document.createElement('option');
					opt.value = script.scriptName;
					opt.textContent = script.label;
					this._scriptSelect.add(opt);
				}
				this._scriptSelect.value = session.selectedScriptName || prev || session.scripts[0].scriptName;
			}
		}

		if (this._urlInput && this._urlInput !== document.activeElement) {
			this._urlInput.value = session.url;
		}

		if (this._sessionMeta) {
			this._sessionMeta.textContent = [
				localize('prebase.runtime.statusPreview', "Status: {0}", session.previewStatus),
				localize('prebase.runtime.statusRunning', "Running: {0}", session.running ? 'yes' : 'no'),
				session.detectedUrls.length
					? localize('prebase.runtime.detected', "Detected: {0}", session.detectedUrls.slice(0, 3).join(', '))
					: ''
			].filter(Boolean).join('\n');
		}

		if (this._widthInput && this._widthInput !== document.activeElement) {
			this._widthInput.value = String(session.viewport.width);
		}
		if (this._heightInput && this._heightInput !== document.activeElement) {
			this._heightInput.value = String(session.viewport.height);
		}
		if (this._zoomInput && this._zoomInput !== document.activeElement) {
			this._zoomInput.value = String(session.viewport.zoom);
		}
		if (this._viewportMeta) {
			this._viewportMeta.textContent = localize(
				'prebase.runtime.viewportState',
				"{0} · {1}×{2} · zoom {3}{4}",
				session.viewport.preset,
				session.viewport.width,
				session.viewport.height,
				session.viewport.zoom,
				session.viewport.rotated ? ' · rotated' : ''
			);
		}

		if (this._diagMeta) {
			this._diagMeta.textContent = [
				localize('prebase.runtime.statusConsoleErrors', "Console errors: {0}", session.consoleErrorCount),
				localize('prebase.runtime.statusConsole', "Console lines: {0}", session.consoleEntries.length),
				localize('prebase.runtime.statusNetwork', "Network lines: {0}", session.networkEntries.length),
				session.consoleEntries.length
					? session.consoleEntries.slice(-3).join('\n')
					: localize('prebase.runtime.none', "None")
			].join('\n');
		}

		if (this._testMeta) {
			this._testMeta.textContent = session.testSessionActive
				? localize('prebase.runtime.testActive', "Test session: active since {0}", new Date(session.testSessionStartedAt ?? Date.now()).toLocaleTimeString())
				: localize('prebase.runtime.testIdle', "Test session: idle");
		}
		if (this._reportsList) {
			this._reportsList.textContent = session.reports.length
				? session.reports.slice(0, 8).map((r, i) => `${i + 1}. ${r}`).join('\n')
				: localize('prebase.runtime.noReportsYet', "No reports yet.");
		}
	}
}
