/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../base/browser/dom.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { FileAccess } from '../../../../base/common/network.js';
import { localize } from '../../../../nls.js';
import { IURLHandler, IURLService } from '../../../../platform/url/common/url.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IWorkbenchEnvironmentService } from '../../../services/environment/common/environmentService.js';
import { IPreBaseAccountService } from './prebaseAccountService.js';
import { PreBaseOnboardingEditorInput } from './prebaseOnboardingEditorInput.js';
import { decidePreBaseStartup } from '../common/auth/prebaseStartupAuth.js';
import { PREBASE_OAUTH_CALLBACK_AUTHORITY, PREBASE_OAUTH_CALLBACK_PATH, type PreBaseOAuthProvider } from '../common/auth/prebaseOAuth.js';

/** Product-owned startup gate, independent from the generic welcome/onboarding overlay. */
export class PreBaseStartupAuthContribution extends Disposable implements IWorkbenchContribution, IURLHandler {
	static readonly ID = 'workbench.contrib.prebase.startupAuth';

	private _offlineDismissed = false;
	private _overlay: HTMLElement | undefined;

	constructor(
		@IPreBaseAccountService private readonly accountService: IPreBaseAccountService,
		@IEditorService private readonly editorService: IEditorService,
		@IWorkbenchEnvironmentService private readonly environmentService: IWorkbenchEnvironmentService,
		@IProductService private readonly productService: IProductService,
		@IURLService urlService: IURLService,
	) {
		super();
		this._register(urlService.registerHandler(this));
		this._register(this.accountService.onDidChangeState(() => this._reconcile()));
		void this._start();
	}

	async handleURL(uri: URI): Promise<boolean> {
		if (uri.scheme !== this.productService.urlProtocol || uri.authority !== PREBASE_OAUTH_CALLBACK_AUTHORITY || uri.path !== PREBASE_OAUTH_CALLBACK_PATH) {
			return false;
		}
		await this.accountService.handleOAuthCallback(uri);
		return true;
	}

	private async _start(): Promise<void> {
		if (this.environmentService.skipWelcome) {
			return;
		}
		await this.accountService.whenInitialSessionResolved();
		this._reconcile();
	}

	private _reconcile(): void {
		const decision = decidePreBaseStartup(this.accountService.state, this.accountService.isOnboardingComplete(), this._offlineDismissed);
		if (decision === 'show-auth') {
			this._showAuth();
			return;
		}
		this._closeAuth();
		if (decision === 'open-onboarding') {
			void this._openOnboarding();
		}
	}

	private async _openOnboarding(): Promise<void> {
		if (this.editorService.editors.some(editor => editor instanceof PreBaseOnboardingEditorInput)) {
			return;
		}
		await this.editorService.openEditor(new PreBaseOnboardingEditorInput(), { pinned: true, revealIfOpened: true, revealIfVisible: true });
	}

	private _showAuth(): void {
		if (this._overlay) {
			return;
		}
		const document = mainWindow.document;
		const overlay = DOM.append(mainWindow.document.body, DOM.$('.prebase-startup-auth'));
		overlay.setAttribute('role', 'dialog');
		overlay.setAttribute('aria-modal', 'true');
		overlay.setAttribute('aria-label', localize('prebase.auth.ariaLabel', 'Sign in to PreBase'));
		Object.assign(overlay.style, { position: 'fixed', inset: '0', zIndex: '100000', display: 'grid', placeItems: 'center', background: 'var(--vscode-editor-background)' });
		const card = DOM.append(overlay, DOM.$('.prebase-startup-auth-card'));
		Object.assign(card.style, { width: 'min(440px, calc(100vw - 40px))', padding: '32px', boxSizing: 'border-box', border: '1px solid var(--vscode-widget-border)', borderRadius: '10px', background: 'var(--vscode-editorWidget-background)', color: 'var(--vscode-foreground)', boxShadow: '0 12px 36px var(--vscode-widget-shadow)' });
		const logo = DOM.append(card, document.createElement('img'));
		logo.src = FileAccess.asBrowserUri('vs/workbench/contrib/prebase/browser/media/prebase-logo.png').toString(true);
		logo.alt = 'PreBase';
		Object.assign(logo.style, { width: '44px', height: '44px', display: 'block', margin: '0 auto 16px' });
		const title = DOM.append(card, document.createElement('h1'));
		title.textContent = 'PreBase';
		Object.assign(title.style, { textAlign: 'center', fontSize: '24px', margin: '0 0 8px' });
		const copy = DOM.append(card, document.createElement('p'));
		copy.textContent = this.accountService.apiConfigured ? localize('prebase.auth.copy', 'Sign in to sync your optional PreBase account.') : localize('prebase.auth.localCopy', 'Cloud sign-in is not configured. You can use PreBase locally.');
		Object.assign(copy.style, { textAlign: 'center', color: 'var(--vscode-descriptionForeground)', margin: '0 0 20px' });
		for (const provider of [{ id: 'github' as const, label: 'Continue with GitHub' }, { id: 'google' as const, label: 'Continue with Google' }]) {
			const button = DOM.append(card, document.createElement('button'));
			button.textContent = provider.label;
			button.disabled = !this.accountService.apiConfigured;
			Object.assign(button.style, { width: '100%', minHeight: '42px', marginBottom: '10px', border: '1px solid var(--vscode-button-border, var(--vscode-widget-border))', borderRadius: '5px', background: 'var(--vscode-button-secondaryBackground)', color: 'var(--vscode-button-secondaryForeground)', cursor: 'pointer' });
			this._register(DOM.addDisposableListener(button, 'click', () => void this._signIn(provider.id)));
		}
		const offline = DOM.append(card, document.createElement('button'));
		offline.textContent = localize('prebase.auth.continueOffline', 'Continue Offline');
		Object.assign(offline.style, { width: '100%', minHeight: '38px', border: '0', background: 'transparent', color: 'var(--vscode-textLink-foreground)', cursor: 'pointer' });
		this._register(DOM.addDisposableListener(offline, 'click', () => this._continueOffline()));
		this._register(DOM.addDisposableListener(overlay, 'keydown', event => { if (event.key === 'Escape') { event.preventDefault(); this._continueOffline(); } }));
		this._overlay = overlay;
		void offline.focus();
	}

	private async _signIn(provider: PreBaseOAuthProvider): Promise<void> {
		try { await this.accountService.signInWithProvider(provider); } catch { /* state-driven UI presents recoverable failures */ }
	}

	private _continueOffline(): void {
		this._offlineDismissed = true;
		this._reconcile();
	}

	private _closeAuth(): void {
		this._overlay?.remove();
		this._overlay = undefined;
	}

	override dispose(): void {
		this._closeAuth();
		super.dispose();
	}
}

registerWorkbenchContribution2(PreBaseStartupAuthContribution.ID, PreBaseStartupAuthContribution, WorkbenchPhase.AfterRestored);
