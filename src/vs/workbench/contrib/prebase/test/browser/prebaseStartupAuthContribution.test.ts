/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import { Emitter, type Event } from '../../../../../base/common/event.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { upcastPartial } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import type { IProductService } from '../../../../../platform/product/common/productService.js';
import type { IURLHandler, IURLService } from '../../../../../platform/url/common/url.js';
import type { IEditorService } from '../../../../services/editor/common/editorService.js';
import type { IWorkbenchEnvironmentService } from '../../../../services/environment/common/environmentService.js';
import { PreBaseStartupAuthContribution } from '../../browser/prebaseStartupAuthContribution.js';
import { type IPreBaseAccountService, type PreBaseAccountState } from '../../browser/prebaseAccountService.js';
import type { PreBaseOAuthProvider } from '../../common/auth/prebaseOAuth.js';

class TestAccountService implements IPreBaseAccountService {
	declare readonly _serviceBrand: undefined;
	private readonly _onDidChangeState = new Emitter<void>();
	readonly onDidChangeState: Event<void> = this._onDidChangeState.event;
	state: PreBaseAccountState = 'signedOut';
	account = undefined;
	lastError = undefined;
	apiConfigured = true;
	signInCalls = 0;

	whenInitialSessionResolved(): Promise<void> { return Promise.resolve(); }
	isOnboardingComplete(): boolean { return true; }
	markOnboardingComplete(): void { }
	resetOnboarding(): void { }
	async signIn(): Promise<void> { }
	async signUp(): Promise<void> { }
	async signInWithProvider(_provider: PreBaseOAuthProvider): Promise<void> { this.signInCalls++; }
	async handleOAuthCallback(): Promise<boolean> { return true; }
	async signOut(): Promise<void> { }
	async restoreSession(): Promise<void> { }

	setState(state: PreBaseAccountState): void {
		this.state = state;
		this._onDidChangeState.fire();
	}

	dispose(): void { this._onDidChangeState.dispose(); }
}

async function waitForAuthOverlay(): Promise<HTMLElement> {
	for (let attempt = 0; attempt < 10; attempt++) {
		const overlay = mainWindow.document.querySelector<HTMLElement>('.prebase-startup-auth');
		if (overlay) {
			return overlay;
		}
		await Promise.resolve();
	}
	throw new Error('Expected startup auth overlay to be rendered.');
}

function githubButton(overlay: HTMLElement): HTMLButtonElement {
	const button = Array.from(overlay.querySelectorAll('button')).find(candidate => candidate.textContent?.includes('GitHub'));
	if (!button) {
		throw new Error('Expected GitHub sign-in button.');
	}
	return button;
}

suite('PreBase startup auth overlay lifecycle', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	test('releases detached overlay button listeners across repeated close and reopen cycles', async () => {
		const workbench = mainWindow.document.createElement('div');
		workbench.className = 'monaco-workbench';
		mainWindow.document.body.appendChild(workbench);
		disposables.add(toDisposable(() => workbench.remove()));

		const accountService = disposables.add(new TestAccountService());
		const urlHandlers: IURLHandler[] = [];
		const contribution = disposables.add(new PreBaseStartupAuthContribution(
			accountService,
			upcastPartial<IEditorService>({ editors: [] }),
			upcastPartial<IWorkbenchEnvironmentService>({ skipWelcome: false }),
			upcastPartial<IProductService>({ urlProtocol: 'prebase' }),
			upcastPartial<IURLService>({
				registerHandler: handler => {
					urlHandlers.push(handler);
					return toDisposable(() => {
						const index = urlHandlers.indexOf(handler);
						if (index >= 0) {
							urlHandlers.splice(index, 1);
						}
					});
				},
			}),
		));

		const closedButtons: HTMLButtonElement[] = [];
		for (let cycle = 0; cycle < 3; cycle++) {
			const overlay = await waitForAuthOverlay();
			closedButtons.push(githubButton(overlay));
			accountService.setState('signedIn');
			accountService.setState('signedOut');
		}

		for (const closedButton of closedButtons) {
			closedButton.click();
		}
		assert.strictEqual(accountService.signInCalls, 0, 'detached overlays must not retain sign-in listeners');

		githubButton(await waitForAuthOverlay()).click();
		assert.strictEqual(accountService.signInCalls, 1, 'the current overlay must retain its live sign-in listener');
		assert.strictEqual(urlHandlers.length, 1);
		contribution.dispose();
	});
});
