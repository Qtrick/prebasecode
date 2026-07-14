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
			row.style.display = 'grid';
			row.style.gridTemplateColumns = '1fr 1fr';
			row.style.gap = '4px';
			this._btn(row, localize('prebase.runtime.start', "Start"), () => this.commandService.executeCommand('prebase.runtime.start'));
			this._btn(row, localize('prebase.runtime.stop', "Stop"), () => this.commandService.executeCommand('prebase.runtime.stop'));
			this._btn(row, localize('prebase.runtime.restart', "Restart"), () => this.commandService.executeCommand('prebase.runtime.restart'));
			this._btn(row, localize('prebase.runtime.openTerminal', "Open Terminal"), () => this.commandService.executeCommand('prebase.runtime.openTerminal'));
			this._btn(section, localize('prebase.runtime.detect', "Detect Configurations"), () => this.commandService.executeCommand('prebase.runtime.detectConfigurations'));
		});

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
			nav.style.display = 'grid';
			nav.style.gridTemplateColumns = '1fr 1fr';
			nav.style.gap = '4px';
			this._btn(nav, localize('prebase.runtime.connect', "Connect"), () => this.commandService.executeCommand('prebase.runtime.connect'));
			this._btn(nav, localize('prebase.runtime.reload', "Reload"), () => this.commandService.executeCommand('prebase.runtime.reload'));
			this._btn(nav, localize('prebase.runtime.back', "Back"), () => this.commandService.executeCommand('prebase.runtime.goBack'));
			this._btn(nav, localize('prebase.runtime.forward', "Forward"), () => this.commandService.executeCommand('prebase.runtime.goForward'));
			this._btn(nav, localize('prebase.runtime.openExternal', "Open External"), () => this.commandService.executeCommand('prebase.runtime.openExternal'));
			this._btn(nav, localize('prebase.runtime.copyUrl', "Copy URL"), () => this.commandService.executeCommand('prebase.runtime.copyUrl'));
		});

		// --- Device / viewport
		this._section(localize('prebase.runtime.viewport', "Device / Viewport"), (section) => {
			const presets: PreBaseViewportPreset[] = ['responsive', 'desktop', 'laptop', 'tablet', 'mobile'];
			const presetRow = DOM.append(section, DOM.$('.prebase-runtime-btn-row'));
			presetRow.style.display = 'grid';
			presetRow.style.gridTemplateColumns = '1fr 1fr';
			presetRow.style.gap = '4px';
			for (const preset of presets) {
				this._btn(presetRow, preset[0].toUpperCase() + preset.slice(1), () => {
					this.runtimeService.setViewportPreset(preset);
				});
			}

			const sizeRow = DOM.append(section, DOM.$('div'));
			sizeRow.style.display = 'grid';
			sizeRow.style.gridTemplateColumns = '1fr 1fr';
			sizeRow.style.gap = '4px';
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
			row.style.display = 'grid';
			row.style.gridTemplateColumns = '1fr 1fr';
			row.style.gap = '4px';
			this._btn(row, localize('prebase.runtime.inspect', "Inspect"), () => this.commandService.executeCommand('prebase.runtime.inspect'));
			this._btn(row, localize('prebase.runtime.clearDiag', "Clear"), () => this.commandService.executeCommand('prebase.runtime.clearDiagnostics'));
			this._btn(section, localize('prebase.runtime.screenshot', "Capture Screenshot"), () => this.commandService.executeCommand('prebase.runtime.captureScreenshot'));
		});

		// --- Testing / reports
		this._section(localize('prebase.runtime.testing', "Testing / Reports"), (section) => {
			this._testMeta = DOM.append(section, DOM.$('div'));
			this._styleMeta(this._testMeta);
			const row = DOM.append(section, DOM.$('.prebase-runtime-btn-row'));
			row.style.display = 'grid';
			row.style.gridTemplateColumns = '1fr 1fr';
			row.style.gap = '4px';
			this._btn(row, localize('prebase.runtime.startTest', "Start Test"), () => this.commandService.executeCommand('prebase.runtime.startTestSession'));
			this._btn(row, localize('prebase.runtime.stopTest', "Stop Test"), () => this.commandService.executeCommand('prebase.runtime.stopTestSession'));
			this._btn(row, localize('prebase.runtime.replayTest', "Replay"), () => this.commandService.executeCommand('prebase.runtime.replayTest'));
			this._btn(row, localize('prebase.runtime.showReports', "Show Reports"), () => this.commandService.executeCommand('prebase.runtime.showReports'));
			this._reportsList = DOM.append(section, DOM.$('div'));
			this._styleMeta(this._reportsList);
		});

		// --- Magnus
		this._section(localize('prebase.runtime.magnus', "Magnus"), (section) => {
			this._btn(section, localize('prebase.runtime.attachMagnus', "Attach Runtime Context"), () => this.commandService.executeCommand('prebase.runtime.attachToMagnus'));
			this._btn(section, localize('prebase.runtime.testMagnus', "Test with Magnus"), () => this.commandService.executeCommand('prebase.runtime.testWithMagnus'));
			this._btn(section, localize('prebase.runtime.explainElement', "Explain Element"), () => this.commandService.executeCommand('prebase.runtime.explainElement'));
		});

		void this.runtimeService.detectConfigurations();
		this._refresh();
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
	}

	private _applySize(): void {
		const w = Number(this._widthInput?.value);
		const h = Number(this._heightInput?.value);
		if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
			this.runtimeService.setViewportSize(w, h);
		}
	}

	private _section(title: string, fill: (section: HTMLElement) => void): void {
		const section = DOM.append(this._body!, DOM.$('.prebase-runtime-section'));
		const heading = DOM.append(section, DOM.$('div'));
		heading.textContent = title;
		heading.style.fontWeight = '600';
		heading.style.marginBottom = '6px';
		heading.style.fontSize = '12px';
		heading.style.letterSpacing = '0.02em';
		heading.style.textTransform = 'uppercase';
		heading.style.opacity = '0.85';
		fill(section);
	}

	private _styleControl(el: HTMLElement): void {
		el.style.width = '100%';
		el.style.boxSizing = 'border-box';
		el.style.marginBottom = '6px';
		el.style.padding = '6px 8px';
		el.style.borderRadius = '6px';
		el.style.border = '1px solid #334155';
		el.style.background = '#020617';
		el.style.color = '#e2e8f0';
	}

	private _styleMeta(el: HTMLElement): void {
		el.style.fontSize = '12px';
		el.style.marginBottom = '6px';
		el.style.opacity = '0.9';
		el.style.whiteSpace = 'pre-wrap';
		el.style.lineHeight = '1.4';
	}

	private _btn(parent: HTMLElement, label: string, onClick: () => void): HTMLButtonElement {
		const btn = DOM.append(parent, DOM.$('button')) as HTMLButtonElement;
		btn.textContent = label;
		btn.style.display = 'block';
		btn.style.width = '100%';
		btn.style.marginBottom = '4px';
		btn.style.padding = '7px 8px';
		btn.style.borderRadius = '6px';
		btn.style.border = '1px solid #334155';
		btn.style.background = '#155e75';
		btn.style.color = '#ecfeff';
		btn.style.cursor = 'pointer';
		btn.style.fontSize = '12px';
		this._register(DOM.addDisposableListener(btn, 'click', onClick));
		return btn;
	}

	private _refresh(): void {
		const session = this.runtimeService.getSession();

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
				localize('prebase.runtime.statusConnected', "Connected: {0}", session.previewConnected ? 'yes' : 'no'),
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
