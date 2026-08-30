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
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { IEditorOpenContext } from '../../../common/editor.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IPreBaseAccountService } from './prebaseAccountService.js';
import { PreBaseHomeEditorInput } from './prebaseHomeEditorInput.js';
import { PreBaseOnboardingEditorInput } from './prebaseOnboardingEditorInput.js';

const STEPS = [
	localize('prebase.onboarding.step.account', "Account"),
	localize('prebase.onboarding.step.personalize', "Personalize"),
	localize('prebase.onboarding.step.project', "First project"),
	localize('prebase.onboarding.step.graph', "Codebase maps"),
	localize('prebase.onboarding.step.build', "Build & test"),
	localize('prebase.onboarding.step.magnus', "Agents"),
	localize('prebase.onboarding.step.finish', "Finish"),
];

const ACCENT = '#2dd4bf';
const MUTED = 'var(--vscode-descriptionForeground)';
const TEXT = 'var(--vscode-foreground)';
const SURFACE = 'var(--vscode-sideBar-background)';
const BORDER = 'var(--vscode-input-border, var(--vscode-widget-border))';
const PAGE_BG = 'var(--vscode-editor-background)';

export class PreBaseOnboardingEditor extends EditorPane {
	static readonly ID = 'workbench.editor.prebaseOnboarding';

	private _root: HTMLElement | undefined;
	private _body: HTMLElement | undefined;
	private _step = 0;
	private readonly _ui = this._register(new DisposableStore());

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IPreBaseAccountService private readonly accountService: IPreBaseAccountService,
		@ICommandService private readonly commandService: ICommandService,
		@IEditorService private readonly editorService: IEditorService,
		@INotificationService private readonly notificationService: INotificationService,
		@IProductService private readonly productService: IProductService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
	) {
		super(PreBaseOnboardingEditor.ID, group, telemetryService, themeService, storageService);
		this._register(this.accountService.onDidChangeState(() => {
			if (this.input) {
				this._render();
			}
		}));
	}

	protected createEditor(parent: HTMLElement): void {
		this._root = DOM.append(parent, DOM.$('.prebase-onboarding'));
		this._root.style.height = '100%';
		this._root.style.overflow = 'auto';
		this._root.style.background = `radial-gradient(ellipse at top, rgba(45,212,191,0.1) 0%, transparent 55%), ${PAGE_BG}`;
		this._root.style.color = TEXT;
		this._root.style.fontFamily = 'var(--vscode-font-family)';
		this._body = DOM.append(this._root, DOM.$('.prebase-onboarding-body'));
		this._body.style.maxWidth = '720px';
		this._body.style.margin = '0 auto';
		this._body.style.padding = '40px 24px 56px';
	}

	override async setInput(input: PreBaseOnboardingEditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		if (!token.isCancellationRequested) {
			this._render();
		}
	}

	override clearInput(): void {
		this._ui.clear();
		if (this._body) {
			DOM.clearNode(this._body);
		}
		super.clearInput();
	}

	override layout(dimension: DOM.Dimension): void {
		if (this._root) {
			this._root.style.height = `${dimension.height}px`;
		}
	}

	private _render(): void {
		if (!this._body) {
			return;
		}
		this._ui.clear();
		DOM.clearNode(this._body);

		const title = DOM.append(this._body, DOM.$('h1'));
		title.textContent = localize('prebase.onboarding.welcome', "Welcome to {0}", this.productService.nameLong || 'PreBase');
		title.style.margin = '0 0 6px';
		title.style.fontSize = '26px';
		title.style.fontWeight = '600';

		const sub = DOM.append(this._body, DOM.$('p'));
		sub.textContent = localize('prebase.onboarding.support', "Set up your workspace. You can skip account setup and configure Agents later.");
		sub.style.color = MUTED;
		sub.style.margin = '0 0 18px';
		sub.style.fontSize = '13px';

		const progress = DOM.append(this._body, DOM.$('div'));
		progress.style.display = 'flex';
		progress.style.flexWrap = 'wrap';
		progress.style.gap = '6px';
		progress.style.marginBottom = '18px';
		progress.setAttribute('aria-label', localize('prebase.onboarding.progress', "Onboarding progress, step {0} of {1}", this._step + 1, STEPS.length));
		STEPS.forEach((label, i) => {
			const pill = DOM.append(progress, DOM.$('span'));
			const current = i === this._step;
			const done = i < this._step;
			pill.textContent = current ? `${i + 1}. ${label}` : String(i + 1);
			pill.title = label;
			pill.style.fontSize = '10px';
			pill.style.padding = current ? '3px 8px' : '3px 7px';
			pill.style.borderRadius = '999px';
			pill.style.border = `1px solid ${current ? ACCENT : BORDER}`;
			pill.style.color = current ? ACCENT : MUTED;
			pill.style.background = current ? 'rgba(45,212,191,0.12)' : 'transparent';
			pill.style.opacity = done ? '0.55' : '1';
			if (current) {
				pill.setAttribute('aria-current', 'step');
			}
		});

		const panel = DOM.append(this._body, DOM.$('div'));
		panel.style.border = `1px solid ${BORDER}`;
		panel.style.borderRadius = '14px';
		panel.style.padding = '18px';
		panel.style.background = SURFACE;
		panel.style.minHeight = '220px';

		switch (this._step) {
			case 0: this._renderAccount(panel); break;
			case 1: this._renderPersonalize(panel); break;
			case 2: this._renderProject(panel); break;
			case 3: this._renderGraph(panel); break;
			case 4: this._renderBuild(panel); break;
			case 5: this._renderMagnus(panel); break;
			default: this._renderFinish(panel); break;
		}

		const nav = DOM.append(this._body, DOM.$('div'));
		nav.style.display = 'flex';
		nav.style.justifyContent = 'space-between';
		nav.style.gap = '8px';
		nav.style.marginTop = '16px';
		nav.style.flexWrap = 'wrap';

		const left = DOM.append(nav, DOM.$('div'));
		left.style.display = 'flex';
		left.style.gap = '8px';
		if (this._step > 0) {
			this._btn(left, localize('prebase.onboarding.back', "Back"), () => { this._step--; this._render(); });
		}
		this._btn(left, localize('prebase.onboarding.skip', "Skip"), () => this._advance(true), false);

		const right = DOM.append(nav, DOM.$('div'));
		if (this._step < STEPS.length - 1) {
			this._btn(right, localize('prebase.onboarding.continue', "Continue"), () => this._advance(false), true);
		} else {
			this._btn(right, localize('prebase.onboarding.finish', "Finish"), () => void this._finish(), true);
		}
	}

	private _renderAccount(panel: HTMLElement): void {
		const heading = DOM.append(panel, DOM.$('h2'));
		heading.textContent = localize('prebase.onboarding.accountTitle', "Sign in to PreBase");
		heading.style.margin = '0 0 8px';
		heading.style.fontSize = '16px';

		const state = this.accountService.state;
		const note = DOM.append(panel, DOM.$('p'));
		note.style.color = MUTED;
		note.style.fontSize = '12px';
		note.style.margin = '0 0 12px';
		if (state === 'unconfigured') {
			note.textContent = localize('prebase.onboarding.accountUnconfigured', "Cloud sign-in is not configured (prebase.cloud.url + prebase.cloud.publishableKey). You can continue without signing in.");
		} else if (state === 'signedIn' && this.accountService.account) {
			note.textContent = localize('prebase.onboarding.accountSignedIn', "Signed in as {0}.", this.accountService.account.displayName);
		} else {
			note.textContent = localize('prebase.onboarding.accountOptional', "Optional. Editor, graphs, terminal, and Agents do not require a PreBase account.");
		}

		const actions = DOM.append(panel, DOM.$('div'));
		actions.style.display = 'flex';
		actions.style.flexWrap = 'wrap';
		actions.style.gap = '8px';

		const configured = this.accountService.apiConfigured;
		if (!configured) {
			this._btn(actions, localize('prebase.onboarding.configureAccount', "Configure Account Service…"), () => {
				void this.commandService.executeCommand('prebase.account.configureService');
			}, true);
		} else {
			this._btn(actions, localize('prebase.onboarding.signIn', "Sign In"), () => {
				void this.commandService.executeCommand('prebase.account.signIn');
			}, true);
		}
		this._btn(actions, localize('prebase.onboarding.continueWithout', "Continue without Signing In"), () => this._advance(true));

		if (this.accountService.lastError) {
			const err = DOM.append(panel, DOM.$('p'));
			err.textContent = this.accountService.lastError;
			err.style.color = '#fca5a5';
			err.style.fontSize = '12px';
			err.style.marginTop = '10px';
		}
	}

	private _renderPersonalize(panel: HTMLElement): void {
		DOM.append(panel, DOM.$('h2')).textContent = localize('prebase.onboarding.personalizeTitle', "Personalize");
		const p = DOM.append(panel, DOM.$('p'));
		p.style.color = MUTED;
		p.style.fontSize = '12px';
		p.textContent = localize('prebase.onboarding.personalizeBody', "Choose PreBase Dark and keep native Settings for keymap and density. Theme changes use the native color theme service.");
		const row = DOM.append(panel, DOM.$('div'));
		row.style.display = 'flex';
		row.style.gap = '8px';
		row.style.flexWrap = 'wrap';
		this._btn(row, localize('prebase.onboarding.themeDark', "PreBase Dark"), () => {
			void this.configurationService.updateValue('workbench.colorTheme', 'PreBase Dark');
		}, true);
		this._btn(row, localize('prebase.onboarding.openSettings', "Open Settings"), () => {
			void this.commandService.executeCommand('workbench.action.openSettings');
		});
	}

	private _renderProject(panel: HTMLElement): void {
		DOM.append(panel, DOM.$('h2')).textContent = localize('prebase.onboarding.projectTitle', "Open your first project");
		const p = DOM.append(panel, DOM.$('p'));
		p.style.color = MUTED;
		p.style.fontSize = '12px';
		p.textContent = localize('prebase.onboarding.projectBody', "Recent projects use native workspace history and appear on PreBase Home.");
		const row = DOM.append(panel, DOM.$('div'));
		row.style.display = 'flex';
		row.style.gap = '8px';
		row.style.flexWrap = 'wrap';
		this._btn(row, localize('prebase.onboarding.openFolder', "Open Folder"), () => void this.commandService.executeCommand('workbench.action.files.openFolder'), true);
		this._btn(row, localize('prebase.onboarding.openWorkspace', "Open Workspace"), () => void this.commandService.executeCommand('workbench.action.openWorkspace'));
		this._btn(row, localize('prebase.onboarding.clone', "Clone Repository"), () => void this.commandService.executeCommand('git.clone'));
		this._btn(row, localize('prebase.onboarding.home', "Open PreBase Home"), () => void this.editorService.openEditor(new PreBaseHomeEditorInput(), { pinned: true }));
	}

	private _renderGraph(panel: HTMLElement): void {
		DOM.append(panel, DOM.$('h2')).textContent = localize('prebase.onboarding.graphTitle', "Understand your codebase");
		const p = DOM.append(panel, DOM.$('p'));
		p.style.color = MUTED;
		p.style.fontSize = '12px';
		p.textContent = localize('prebase.onboarding.graphBody', "Code Graph uses Organic, Sphere, Constellation, and Clustered 3D layouts. Drag the graph to rotate it. A project must be open before it becomes available.");
		const row = DOM.append(panel, DOM.$('div'));
		row.style.display = 'flex';
		row.style.gap = '8px';
		row.style.flexWrap = 'wrap';
		this._btn(row, localize('prebase.onboarding.net', "Code Graph"), () => void this.commandService.executeCommand('prebase.graph.openNetwork'), true);
	}

	private _renderBuild(panel: HTMLElement): void {
		DOM.append(panel, DOM.$('h2')).textContent = localize('prebase.onboarding.buildTitle', "Build and test");
		const p = DOM.append(panel, DOM.$('p'));
		p.style.color = MUTED;
		p.style.fontSize = '12px';
		p.textContent = localize('prebase.onboarding.buildBody', "Use the native editor, terminal, source control, and Runtime Preview without leaving PreBase.");
		const row = DOM.append(panel, DOM.$('div'));
		row.style.display = 'flex';
		row.style.gap = '8px';
		row.style.flexWrap = 'wrap';
		this._btn(row, localize('prebase.onboarding.terminal', "Open Terminal"), () => void this.commandService.executeCommand('workbench.action.terminal.toggleTerminal'), true);
		this._btn(row, localize('prebase.onboarding.runtime', "Runtime Preview"), () => void this.commandService.executeCommand('prebase.runtime.open'));
	}

	private _renderMagnus(panel: HTMLElement): void {
		DOM.append(panel, DOM.$('h2')).textContent = localize('prebase.onboarding.magnusTitle', "Agents (optional)");
		const p = DOM.append(panel, DOM.$('p'));
		p.style.color = MUTED;
		p.style.fontSize = '12px';
		p.textContent = localize('prebase.onboarding.magnusBody', "Configure an API key for Agents when you want AI assistance. Agents uses its own SecretStorage key and does not require a PreBase account.");
		const row = DOM.append(panel, DOM.$('div'));
		row.style.display = 'flex';
		row.style.gap = '8px';
		row.style.flexWrap = 'wrap';
		this._btn(row, localize('prebase.onboarding.magnusConfig', "Configure Agents"), () => void this.commandService.executeCommand('prebase.magnus.setApiKey'), true);
		this._btn(row, localize('prebase.onboarding.magnusSkip', "Skip for now"), () => this._advance(true));
	}

	private _renderFinish(panel: HTMLElement): void {
		DOM.append(panel, DOM.$('h2')).textContent = localize('prebase.onboarding.finishTitle', "You're ready");
		const p = DOM.append(panel, DOM.$('p'));
		p.style.color = MUTED;
		p.style.fontSize = '12px';
		p.textContent = localize('prebase.onboarding.finishBody', "Open PreBase Home or a project. You can reopen onboarding anytime from the Command Palette.");
	}

	private _advance(skip: boolean): void {
		void skip;
		if (this._step < STEPS.length - 1) {
			this._step++;
			this._render();
		} else {
			void this._finish();
		}
	}

	private async _finish(): Promise<void> {
		this.accountService.markOnboardingComplete();
		await this.editorService.openEditor(new PreBaseHomeEditorInput(), { pinned: true });
		const active = this.group.activeEditor;
		if (active instanceof PreBaseOnboardingEditorInput) {
			await this.group.closeEditor(active);
		}
	}

	private _btn(parent: HTMLElement, label: string, onClick: () => void, primary = false): HTMLButtonElement {
		const btn = DOM.append(parent, DOM.$('button')) as HTMLButtonElement;
		btn.type = 'button';
		btn.textContent = label;
		btn.style.padding = '8px 12px';
		btn.style.borderRadius = '8px';
		btn.style.border = '1px solid var(--vscode-button-border, transparent)';
		btn.style.background = primary ? 'var(--vscode-button-background)' : 'var(--vscode-button-secondaryBackground)';
		btn.style.color = primary ? 'var(--vscode-button-foreground)' : 'var(--vscode-button-secondaryForeground)';
		btn.style.cursor = 'pointer';
		btn.style.fontSize = '12px';
		btn.style.outline = 'none';
		this._ui.add(DOM.addDisposableListener(btn, 'focus', () => {
			btn.style.outline = '1px solid var(--vscode-focusBorder)';
			btn.style.outlineOffset = '2px';
		}));
		this._ui.add(DOM.addDisposableListener(btn, 'blur', () => {
			btn.style.outline = 'none';
		}));
		this._ui.add(DOM.addDisposableListener(btn, 'click', () => {
			try {
				onClick();
			} catch (err) {
				this.notificationService.notify({
					severity: Severity.Error,
					message: err instanceof Error ? err.message : String(err),
				});
			}
		}));
		return btn;
	}
}
