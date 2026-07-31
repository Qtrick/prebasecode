/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../base/browser/dom.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { IEditorOpenContext } from '../../../common/editor.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';
import { PreBaseWorkspaceOpeningEditorInput } from './prebaseWorkspaceOpeningEditorInput.js';
import { workspaceOpeningStageLabel } from './prebaseWorkspaceOpening.js';

/**
 * Lightweight native loading surface — no webview, no remote images, no app icon.
 */
export class PreBaseWorkspaceOpeningEditor extends EditorPane {
	static readonly ID = PreBaseWorkspaceOpeningEditorInput.EditorID;

	private _root: HTMLElement | undefined;
	private readonly _renderDisposables = this._register(new DisposableStore());

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
	) {
		super(PreBaseWorkspaceOpeningEditor.ID, group, telemetryService, themeService, storageService);
	}

	protected override createEditor(parent: HTMLElement): void {
		this._root = DOM.append(parent, DOM.$('.prebase-workspace-opening'));
		this._root.setAttribute('role', 'status');
		this._root.setAttribute('aria-live', 'polite');
		this._root.style.height = '100%';
		this._root.style.display = 'flex';
		this._root.style.alignItems = 'center';
		this._root.style.justifyContent = 'center';
		this._root.style.background = 'var(--vscode-editor-background)';
		this._root.style.color = 'var(--vscode-foreground)';
		this._root.style.padding = '32px';
		this._root.style.boxSizing = 'border-box';
	}

	override layout(_dimension: DOM.Dimension): void {
		// Full-bleed loading surface; CSS handles sizing.
	}

	override async setInput(input: PreBaseWorkspaceOpeningEditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		if (token.isCancellationRequested || !this._root) {
			return;
		}
		this._renderDisposables.clear();
		DOM.clearNode(this._root);

		const card = DOM.append(this._root, DOM.$('.prebase-workspace-opening-card'));
		card.style.maxWidth = '480px';
		card.style.width = '100%';
		card.style.display = 'flex';
		card.style.flexDirection = 'column';
		card.style.gap = '10px';

		const brand = DOM.append(card, DOM.$('div'));
		brand.textContent = 'PreBase';
		brand.style.fontSize = '13px';
		brand.style.letterSpacing = '0.04em';
		brand.style.textTransform = 'uppercase';
		brand.style.opacity = '0.7';

		const title = DOM.append(card, DOM.$('h1'));
		title.textContent = localize('prebase.workspace.openingTitle', "Opening {0}…", input.projectLabel || 'project');
		title.style.margin = '0';
		title.style.fontSize = '22px';
		title.style.fontWeight = '600';

		const stage = DOM.append(card, DOM.$('div'));
		stage.textContent = workspaceOpeningStageLabel(input.phase);
		stage.style.opacity = '0.85';
		stage.style.fontSize = '13px';

		const bar = DOM.append(card, DOM.$('div'));
		bar.setAttribute('role', 'progressbar');
		bar.setAttribute('aria-label', localize('prebase.workspace.openingProgress', "Opening project"));
		bar.style.height = '3px';
		bar.style.marginTop = '8px';
		bar.style.borderRadius = '999px';
		bar.style.overflow = 'hidden';
		bar.style.background = 'var(--vscode-progressBar-background, rgba(45,212,191,0.25))';

		const fill = DOM.append(bar, DOM.$('div'));
		fill.style.height = '100%';
		fill.style.width = '40%';
		fill.style.background = 'var(--vscode-progressBar-background, #2dd4bf)';
		const targetWindow = DOM.getWindow(this._root);
		const reduceMotion = targetWindow.matchMedia('(prefers-reduced-motion: reduce)').matches;
		if (!reduceMotion) {
			fill.style.animation = 'prebase-workspace-opening-indeterminate 1.2s ease-in-out infinite';
			const style = DOM.append(this._root, DOM.$('style'));
			style.textContent = `@keyframes prebase-workspace-opening-indeterminate{0%{transform:translateX(-100%)}100%{transform:translateX(280%)}}`;
		}

		const note = DOM.append(card, DOM.$('p'));
		note.textContent = localize(
			'prebase.workspace.openingNote',
			"The workbench stays available. Code Graph and Runtime Preview continue loading in the background."
		);
		note.style.margin = '8px 0 0';
		note.style.fontSize = '12px';
		note.style.opacity = '0.65';
		note.style.lineHeight = '1.45';
	}

	override clearInput(): void {
		this._renderDisposables.clear();
		if (this._root) {
			DOM.clearNode(this._root);
		}
		super.clearInput();
	}
}
