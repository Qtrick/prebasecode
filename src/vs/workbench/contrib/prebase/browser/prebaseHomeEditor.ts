/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../base/browser/dom.js';
import { StandardKeyboardEvent } from '../../../../base/browser/keyboardEvent.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { KeyCode } from '../../../../base/common/keyCodes.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { FileAccess, Schemas } from '../../../../base/common/network.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { URI } from '../../../../base/common/uri.js';
import { splitRecentLabel } from '../../../../base/common/labels.js';
import { localize } from '../../../../nls.js';
import { IClipboardService } from '../../../../platform/clipboard/common/clipboardService.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ILabelService, Verbosity } from '../../../../platform/label/common/label.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { storePendingWorkspaceOpen } from './prebaseWorkspaceOpening.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { asCssVariable } from '../../../../platform/theme/common/colorUtils.js';
import { focusBorder } from '../../../../platform/theme/common/colors/baseColors.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { IWorkspaceContextService, WorkbenchState } from '../../../../platform/workspace/common/workspace.js';
import { IRecentFolder, IRecentWorkspace, IWorkspacesService, isRecentFolder, isRecentWorkspace } from '../../../../platform/workspaces/common/workspaces.js';
import { IWindowOpenable } from '../../../../platform/window/common/window.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { IEditorOpenContext } from '../../../common/editor.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';
import { PreBaseHomeEditorInput } from './prebaseHomeEditorInput.js';

const ACCENT = '#2dd4bf';
const SURFACE = 'var(--vscode-sideBar-background)';
const OVERLAY = 'var(--vscode-editorWidget-background)';
const BORDER = 'var(--vscode-input-border, var(--vscode-widget-border))';
const TEXT = 'var(--vscode-foreground)';
const MUTED = 'var(--vscode-descriptionForeground)';
const PAGE_BG = 'var(--vscode-editor-background)';

const HOME_CARD_LIMIT = 6;

interface RecentCardModel {
	key: string;
	name: string;
	pathLabel: string;
	resource: URI;
	openable: IWindowOpenable;
	remoteAuthority: string | undefined;
	kind: 'folder' | 'workspace';
	missing: boolean;
	isLastOpened: boolean;
}

export class PreBaseHomeEditor extends EditorPane {
	static readonly ID = 'workbench.editor.prebaseHome';

	private _root: HTMLElement | undefined;
	private _body: HTMLElement | undefined;
	private readonly _renderDisposables = this._register(new DisposableStore());
	private readonly _contextMenuDisposables = this._register(new DisposableStore());
	private _contextMenu: HTMLElement | undefined;
	private _renderGeneration = 0;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService private readonly appStorageService: IStorageService,
		@IWorkspacesService private readonly workspacesService: IWorkspacesService,
		@ILabelService private readonly labelService: ILabelService,
		@IHostService private readonly hostService: IHostService,
		@ICommandService private readonly commandService: ICommandService,
		@IFileService private readonly fileService: IFileService,
		@IClipboardService private readonly clipboardService: IClipboardService,
		@INotificationService private readonly notificationService: INotificationService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IProductService private readonly productService: IProductService,
	) {
		super(PreBaseHomeEditor.ID, group, telemetryService, themeService, appStorageService);
		this._register(this.workspacesService.onDidChangeRecentlyOpened(() => void this._render()));
		this._register(this.workspaceContextService.onDidChangeWorkbenchState(() => void this._render()));
		this._register(this.workspaceContextService.onDidChangeWorkspaceFolders(() => void this._render()));
		this._register(this.labelService.onDidChangeFormatters(() => void this._render()));
	}

	protected createEditor(parent: HTMLElement): void {
		this._root = DOM.append(parent, DOM.$('.prebase-home-editor'));
		this._root.style.height = '100%';
		this._root.style.overflow = 'auto';
		this._root.style.boxSizing = 'border-box';
		this._root.style.background = `radial-gradient(ellipse at center, rgba(45,212,191,0.08) 0%, transparent 65%), ${PAGE_BG}`;
		this._root.style.color = TEXT;
		this._body = DOM.append(this._root, DOM.$('.prebase-home-body'));
		this._body.style.maxWidth = '960px';
		this._body.style.margin = '0 auto';
		this._body.style.padding = '48px 28px 64px';
		this._body.style.display = 'flex';
		this._body.style.flexDirection = 'column';
		this._body.style.alignItems = 'stretch';
		this._body.style.gap = '28px';
	}

	override async setInput(input: PreBaseHomeEditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		if (!token.isCancellationRequested) {
			await this._render();
		}
	}

	override clearInput(): void {
		this._renderGeneration++;
		this._closeContextMenu();
		this._renderDisposables.clear();
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

	private async _render(): Promise<void> {
		if (!this._body || !this.input) {
			return;
		}
		const generation = ++this._renderGeneration;
		const emptyWorkbench = this.workspaceContextService.getWorkbenchState() === WorkbenchState.EMPTY;
		const workspaceName = emptyWorkbench
			? undefined
			: this.labelService.getWorkspaceLabel(this.workspaceContextService.getWorkspace(), { verbose: Verbosity.SHORT });

		const cards = await this._buildRecentCards();
		if (generation !== this._renderGeneration || !this._body || !this.input) {
			return;
		}

		this._closeContextMenu();
		this._renderDisposables.clear();
		DOM.clearNode(this._body);
		this._renderHero(emptyWorkbench, workspaceName);
		this._renderQuickActions(emptyWorkbench);
		this._renderRecentSection(cards);
	}

	private _renderHero(emptyWorkbench: boolean, workspaceName: string | undefined): void {
		const hero = DOM.append(this._body!, DOM.$('.prebase-home-hero'));
		hero.style.textAlign = 'center';
		hero.style.display = 'flex';
		hero.style.flexDirection = 'column';
		hero.style.alignItems = 'center';
		hero.style.gap = '10px';

		const badge = DOM.append(hero, DOM.$('div'));
		badge.style.width = '72px';
		badge.style.height = '72px';
		badge.style.borderRadius = '18px';
		badge.style.display = 'block';
		badge.style.boxSizing = 'border-box';
		badge.style.border = `1px solid ${BORDER}`;
		badge.style.background = 'var(--vscode-editor-background)';
		badge.style.overflow = 'hidden';
		badge.style.flexShrink = '0';
		badge.style.lineHeight = '0';
		const logo = DOM.append(badge, DOM.$('img')) as HTMLImageElement;
		logo.src = FileAccess.asBrowserUri('vs/workbench/contrib/prebase/browser/media/prebase-logo.png').toString(true);
		logo.alt = this.productService.nameLong || 'PreBase';
		logo.draggable = false;
		logo.style.display = 'block';
		logo.style.width = '100%';
		logo.style.height = '100%';
		logo.style.objectFit = 'cover';
		logo.style.objectPosition = 'center';
		logo.style.userSelect = 'none';
		logo.style.pointerEvents = 'none';

		const title = DOM.append(hero, DOM.$('h1'));
		title.textContent = this.productService.nameLong || 'PreBase';
		title.style.margin = '8px 0 0';
		title.style.fontSize = '28px';
		title.style.fontWeight = '600';
		title.style.letterSpacing = '-0.02em';

		const subtitle = DOM.append(hero, DOM.$('p'));
		subtitle.style.margin = '0';
		subtitle.style.maxWidth = '520px';
		subtitle.style.color = MUTED;
		subtitle.style.fontSize = '13px';
		subtitle.style.lineHeight = '1.5';
		if (emptyWorkbench) {
			subtitle.textContent = localize(
				'prebase.home.subtitleEmpty',
				"Open a folder or workspace to explore the Code Graph, dependencies, and structure. Recent projects below use your native history."
			);
		} else {
			subtitle.textContent = localize(
				'prebase.home.subtitleWorkspace',
				"Working in {0}. Open a file, generate a graph, or jump to another recent project.",
				workspaceName || localize('prebase.home.thisWorkspace', "this workspace")
			);
		}
	}

	private _renderQuickActions(emptyWorkbench: boolean): void {
		const row = DOM.append(this._body!, DOM.$('.prebase-home-actions'));
		row.style.display = 'flex';
		row.style.flexWrap = 'wrap';
		row.style.justifyContent = 'center';
		row.style.gap = '8px';

		if (emptyWorkbench) {
			this._actionButton(row, localize('prebase.home.openFolder', "Open Folder"), () => {
				storePendingWorkspaceOpen(this.appStorageService, {
					label: localize('prebase.home.openFolderPending', "folder"),
					action: 'openFolder',
				});
				void this.commandService.executeCommand('workbench.action.files.openFolder');
			}, true);
			this._actionButton(row, localize('prebase.home.openWorkspace', "Open Workspace"), () => {
				storePendingWorkspaceOpen(this.appStorageService, {
					label: localize('prebase.home.openWorkspacePending', "workspace"),
					action: 'openWorkspace',
				});
				void this.commandService.executeCommand('workbench.action.openWorkspace');
			});
			this._actionButton(row, localize('prebase.home.clone', "Clone Repository"), () => {
				void this.commandService.executeCommand('git.clone');
			});
			this._actionButton(row, localize('prebase.home.newFile', "New File"), () => {
				void this.commandService.executeCommand('workbench.action.files.newUntitledFile');
			});
		} else {
			this._actionButton(row, localize('prebase.home.openFile', "Open File"), () => {
				void this.commandService.executeCommand('workbench.action.files.openFile');
			}, true);
			this._actionButton(row, localize('prebase.home.newFile', "New File"), () => {
				void this.commandService.executeCommand('workbench.action.files.newUntitledFile');
			});
			this._actionButton(row, localize('prebase.home.codeGraph', "Code Graph"), () => {
				void this.commandService.executeCommand('prebase.graph.open');
			});
			this._actionButton(row, localize('prebase.home.runtime', "Runtime Preview"), () => {
				void this.commandService.executeCommand('prebase.runtime.open');
			});
			this._actionButton(row, localize('prebase.home.magnus', "Agents"), () => {
				void this.commandService.executeCommand('workbench.action.chat.open');
			});
		}
	}

	private _renderRecentSection(cards: RecentCardModel[]): void {
		const section = DOM.append(this._body!, DOM.$('section'));
		section.style.display = 'flex';
		section.style.flexDirection = 'column';
		section.style.gap = '12px';

		const header = DOM.append(section, DOM.$('div'));
		header.style.display = 'flex';
		header.style.alignItems = 'center';
		header.style.justifyContent = 'space-between';
		header.style.gap = '12px';
		header.style.flexWrap = 'wrap';

		const title = DOM.append(header, DOM.$('h2'));
		title.textContent = localize('prebase.home.recent', "Recent projects");
		title.style.margin = '0';
		title.style.fontSize = '11px';
		title.style.fontWeight = '600';
		title.style.letterSpacing = '0.08em';
		title.style.textTransform = 'uppercase';
		title.style.color = MUTED;

		const tools = DOM.append(header, DOM.$('div'));
		tools.style.display = 'flex';
		tools.style.gap = '6px';
		tools.style.flexWrap = 'wrap';
		this._linkButton(tools, localize('prebase.home.openRecent', "Open Recent…"), () => {
			void this.commandService.executeCommand('workbench.action.openRecent');
		});
		this._linkButton(tools, localize('prebase.home.showAll', "Show All Recent Projects"), () => {
			void this.commandService.executeCommand('workbench.action.openRecent');
		});
		this._linkButton(tools, localize('prebase.home.clearRecent', "Clear Recently Opened"), () => {
			void this.workspacesService.clearRecentlyOpened();
		});

		if (cards.length === 0) {
			const empty = DOM.append(section, DOM.$('div'));
			empty.style.border = `1px dashed ${BORDER}`;
			empty.style.borderRadius = '12px';
			empty.style.padding = '24px';
			empty.style.textAlign = 'center';
			empty.style.background = `color-mix(in srgb, ${OVERLAY} 45%, transparent)`;
			const p1 = DOM.append(empty, DOM.$('p'));
			p1.style.margin = '0';
			p1.style.fontSize = '12px';
			p1.style.color = MUTED;
			p1.textContent = localize('prebase.home.noRecents', "No recent projects yet.");
			const p2 = DOM.append(empty, DOM.$('p'));
			p2.style.margin = '6px 0 0';
			p2.style.fontSize = '11px';
			p2.style.color = MUTED;
			p2.textContent = localize('prebase.home.noRecentsHint', "Open a folder to begin mapping your codebase.");
			return;
		}

		const grid = DOM.append(section, DOM.$('div'));
		grid.style.display = 'grid';
		// Fixed-ish card width so a single recent project does not stretch into a huge tile.
		grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(200px, 260px))';
		grid.style.gap = '10px';
		grid.style.justifyContent = 'start';
		for (const card of cards) {
			this._renderCard(grid, card);
		}
	}

	private async _buildRecentCards(): Promise<RecentCardModel[]> {
		const { workspaces } = await this.workspacesService.getRecentlyOpened();

		const models: RecentCardModel[] = [];
		for (const recent of workspaces) {
			if (!isRecentFolder(recent) && !isRecentWorkspace(recent)) {
				continue;
			}
			// Include the current workspace so a single recent open still appears on Home
			// (VS Code "Open Recent" excludes the active one; Home should show it).
			models.push(this._toCardModel(recent, models.length === 0));
			if (models.length >= HOME_CARD_LIMIT) {
				break;
			}
		}

		await Promise.all(models.map(async m => {
			if (m.resource.scheme !== Schemas.file && m.resource.scheme !== Schemas.vscodeUserData) {
				m.missing = false;
				return;
			}
			try {
				m.missing = !(await this.fileService.exists(m.resource));
			} catch {
				m.missing = true;
			}
		}));

		return models;
	}

	private _toCardModel(recent: IRecentFolder | IRecentWorkspace, isLastOpened: boolean): RecentCardModel {
		if (isRecentFolder(recent)) {
			const fullPath = recent.label || this.labelService.getWorkspaceLabel(recent.folderUri, { verbose: Verbosity.LONG });
			const { name } = splitRecentLabel(fullPath);
			return {
				key: recent.folderUri.toString(),
				name,
				pathLabel: fullPath,
				resource: recent.folderUri,
				openable: { folderUri: recent.folderUri },
				remoteAuthority: recent.remoteAuthority,
				kind: 'folder',
				missing: false,
				isLastOpened,
			};
		}
		const fullPath = recent.label || this.labelService.getWorkspaceLabel(recent.workspace, { verbose: Verbosity.LONG });
		const { name } = splitRecentLabel(fullPath);
		return {
			key: recent.workspace.id,
			name,
			pathLabel: fullPath,
			resource: recent.workspace.configPath,
			openable: { workspaceUri: recent.workspace.configPath },
			remoteAuthority: recent.remoteAuthority,
			kind: 'workspace',
			missing: false,
			isLastOpened,
		};
	}

	private _renderCard(parent: HTMLElement, card: RecentCardModel): void {
		const btn = DOM.append(parent, DOM.$('button')) as HTMLButtonElement;
		btn.type = 'button';
		btn.style.display = 'flex';
		btn.style.flexDirection = 'column';
		btn.style.alignItems = 'stretch';
		btn.style.gap = '6px';
		btn.style.textAlign = 'left';
		btn.style.padding = '10px 12px';
		btn.style.borderRadius = '10px';
		btn.style.cursor = 'pointer';
		btn.style.background = card.isLastOpened
			? `color-mix(in srgb, ${OVERLAY} 88%, transparent)`
			: `color-mix(in srgb, ${SURFACE} 70%, transparent)`;
		btn.style.border = card.isLastOpened ? `1px solid rgba(45,212,191,0.45)` : `1px solid ${BORDER}`;
		btn.style.color = TEXT;
		btn.style.opacity = card.missing ? '0.72' : '1';
		btn.style.outline = 'none';
		btn.style.width = '100%';
		btn.style.maxWidth = '260px';
		btn.style.boxSizing = 'border-box';
		btn.setAttribute('aria-label', localize('prebase.home.cardAria', "Open {0} at {1}", card.name, card.pathLabel));
		this._attachFocusRing(btn);

		const top = DOM.append(btn, DOM.$('div'));
		top.style.display = 'flex';
		top.style.gap = '8px';
		top.style.alignItems = 'flex-start';

		const icon = DOM.append(top, DOM.$('span'));
		icon.classList.add(...ThemeIcon.asClassNameArray(card.kind === 'workspace' ? Codicon.folderLibrary : Codicon.folderOpened));
		icon.style.width = '26px';
		icon.style.height = '26px';
		icon.style.borderRadius = '6px';
		icon.style.display = 'flex';
		icon.style.alignItems = 'center';
		icon.style.justifyContent = 'center';
		icon.style.border = `1px solid ${card.isLastOpened ? 'rgba(45,212,191,0.3)' : BORDER}`;
		icon.style.background = card.isLastOpened ? 'rgba(45,212,191,0.1)' : `color-mix(in srgb, ${SURFACE} 55%, transparent)`;
		icon.style.color = card.isLastOpened ? ACCENT : MUTED;
		icon.style.flexShrink = '0';
		icon.style.fontSize = '14px';

		const textCol = DOM.append(top, DOM.$('div'));
		textCol.style.minWidth = '0';
		textCol.style.flex = '1';
		textCol.style.display = 'flex';
		textCol.style.flexDirection = 'column';
		textCol.style.gap = '2px';

		const titleRow = DOM.append(textCol, DOM.$('div'));
		titleRow.style.display = 'flex';
		titleRow.style.alignItems = 'center';
		titleRow.style.gap = '6px';
		titleRow.style.minWidth = '0';

		const nameEl = DOM.append(titleRow, DOM.$('div'));
		nameEl.textContent = card.name;
		nameEl.style.fontSize = '12px';
		nameEl.style.fontWeight = '600';
		nameEl.style.overflow = 'hidden';
		nameEl.style.textOverflow = 'ellipsis';
		nameEl.style.whiteSpace = 'nowrap';
		nameEl.style.minWidth = '0';
		nameEl.style.flex = '1';

		if (card.isLastOpened) {
			const badge = DOM.append(titleRow, DOM.$('span'));
			badge.textContent = localize('prebase.home.lastOpened', "Last opened");
			badge.style.flexShrink = '0';
			badge.style.fontSize = '8px';
			badge.style.letterSpacing = '0.05em';
			badge.style.textTransform = 'uppercase';
			badge.style.color = ACCENT;
			badge.style.border = '1px solid rgba(45,212,191,0.25)';
			badge.style.background = 'rgba(45,212,191,0.1)';
			badge.style.borderRadius = '999px';
			badge.style.padding = '1px 6px';
			badge.style.lineHeight = '1.4';
		}

		const pathEl = DOM.append(textCol, DOM.$('div'));
		pathEl.textContent = card.pathLabel.replace(/\//g, '/\u200B');
		pathEl.title = card.pathLabel;
		pathEl.style.fontSize = '10px';
		pathEl.style.fontFamily = 'var(--monaco-monospace-font, monospace)';
		pathEl.style.color = MUTED;
		pathEl.style.lineHeight = '1.35';
		pathEl.style.overflow = 'hidden';
		pathEl.style.textOverflow = 'ellipsis';
		pathEl.style.whiteSpace = 'nowrap';

		const meta = DOM.append(btn, DOM.$('div'));
		meta.style.display = 'flex';
		meta.style.gap = '8px';
		meta.style.flexWrap = 'wrap';
		meta.style.fontSize = '10px';
		meta.style.color = MUTED;
		meta.style.borderTop = `1px solid color-mix(in srgb, ${BORDER} 60%, transparent)`;
		meta.style.paddingTop = '6px';
		meta.style.marginTop = '2px';
		DOM.append(meta, DOM.$('span')).textContent = card.kind === 'workspace'
			? localize('prebase.home.kindWorkspace', "Workspace")
			: localize('prebase.home.kindFolder', "Folder");
		if (card.remoteAuthority) {
			DOM.append(meta, DOM.$('span')).textContent = localize('prebase.home.remote', "Remote · {0}", card.remoteAuthority);
		}
		if (card.missing) {
			const miss = DOM.append(meta, DOM.$('span'));
			miss.textContent = localize('prebase.home.unavailable', "Unavailable");
			miss.style.color = '#fca5a5';
		}

		this._renderDisposables.add(DOM.addDisposableListener(btn, 'click', () => void this._openCard(card, false)));
		this._renderDisposables.add(DOM.addDisposableListener(btn, 'contextmenu', e => {
			e.preventDefault();
			this._openContextMenu(e.clientX, e.clientY, card);
		}));
		this._renderDisposables.add(DOM.addDisposableListener(btn, 'keydown', e => {
			const ke = new StandardKeyboardEvent(e);
			if (ke.keyCode === KeyCode.Enter || ke.keyCode === KeyCode.Space) {
				e.preventDefault();
				void this._openCard(card, false);
			} else if (ke.keyCode === KeyCode.ContextMenu || (ke.shiftKey && ke.keyCode === KeyCode.F10)) {
				e.preventDefault();
				const rect = btn.getBoundingClientRect();
				this._openContextMenu(rect.left + 8, rect.bottom + 4, card);
			}
		}));
	}

	private async _openCard(card: RecentCardModel, forceNewWindow: boolean): Promise<void> {
		if (card.missing && (card.resource.scheme === Schemas.file || card.resource.scheme === Schemas.vscodeUserData)) {
			this.notificationService.notify({
				severity: Severity.Error,
				message: localize('prebase.home.missingOpen', "Could not open “{0}”. The folder or workspace is no longer available.", card.name),
			});
			return;
		}
		storePendingWorkspaceOpen(this.appStorageService, {
			label: card.name || card.pathLabel,
			uri: card.resource.toString(),
			action: 'openRecent',
		});
		await this.hostService.openWindow([card.openable], {
			forceNewWindow,
			remoteAuthority: card.remoteAuthority || null,
		});
	}

	private _openContextMenu(x: number, y: number, card: RecentCardModel): void {
		this._closeContextMenu();
		const menu = DOM.append(this._root!, DOM.$('.prebase-home-menu'));
		this._contextMenu = menu;
		menu.setAttribute('role', 'menu');
		menu.style.position = 'fixed';
		menu.style.left = `${x}px`;
		menu.style.top = `${y}px`;
		menu.style.zIndex = '10000';
		menu.style.minWidth = '210px';
		menu.style.padding = '4px 0';
		menu.style.borderRadius = '10px';
		menu.style.border = `1px solid ${BORDER}`;
		menu.style.background = SURFACE;
		menu.style.boxShadow = '0 12px 40px rgba(0,0,0,0.45)';

		const addItem = (label: string, run: () => void, danger = false) => {
			const item = DOM.append(menu, DOM.$('button')) as HTMLButtonElement;
			item.type = 'button';
			item.setAttribute('role', 'menuitem');
			item.textContent = label;
			item.style.display = 'block';
			item.style.width = '100%';
			item.style.textAlign = 'left';
			item.style.padding = '8px 12px';
			item.style.border = 'none';
			item.style.background = 'transparent';
			item.style.color = danger ? '#fca5a5' : MUTED;
			item.style.fontSize = '12px';
			item.style.cursor = 'pointer';
			item.style.outline = 'none';
			this._attachFocusRing(item, this._contextMenuDisposables);
			this._contextMenuDisposables.add(DOM.addDisposableListener(item, 'click', () => {
				this._closeContextMenu();
				run();
			}));
		};

		addItem(localize('prebase.home.ctxOpen', "Open"), () => void this._openCard(card, false));
		addItem(localize('prebase.home.ctxOpenNew', "Open in New Window"), () => void this._openCard(card, true));
		if (card.resource.scheme === Schemas.file) {
			addItem(localize('prebase.home.ctxReveal', "Reveal in File Explorer"), () => {
				void this.commandService.executeCommand('revealFileInOS', card.resource);
			});
		}
		addItem(localize('prebase.home.ctxCopy', "Copy Path"), () => {
			void this.clipboardService.writeText(card.resource.scheme === Schemas.file ? card.resource.fsPath : card.resource.toString());
		});
		addItem(localize('prebase.home.ctxRemove', "Remove from Recently Opened"), () => {
			void this.workspacesService.removeRecentlyOpened([card.resource]);
		}, true);

		const win = DOM.getWindow(this._root!);
		this._contextMenuDisposables.add(DOM.addDisposableListener(win, 'mousedown', e => {
			if (this._contextMenu && !this._contextMenu.contains(e.target as Node)) {
				this._closeContextMenu();
			}
		}));
		this._contextMenuDisposables.add(DOM.addDisposableListener(win, 'keydown', e => {
			if (new StandardKeyboardEvent(e).keyCode === KeyCode.Escape) {
				this._closeContextMenu();
			}
		}));
	}

	private _closeContextMenu(): void {
		this._contextMenuDisposables.clear();
		if (this._contextMenu) {
			this._contextMenu.remove();
			this._contextMenu = undefined;
		}
	}

	private _attachFocusRing(el: HTMLElement, store: DisposableStore = this._renderDisposables): void {
		const ring = `2px solid ${asCssVariable(focusBorder)}`;
		store.add(DOM.addDisposableListener(el, 'focus', () => {
			el.style.outline = ring;
			el.style.outlineOffset = '2px';
		}));
		store.add(DOM.addDisposableListener(el, 'blur', () => {
			el.style.outline = 'none';
			el.style.outlineOffset = '';
		}));
	}

	private _actionButton(parent: HTMLElement, label: string, onClick: () => void, primary = false): void {
		const btn = DOM.append(parent, DOM.$('button')) as HTMLButtonElement;
		btn.type = 'button';
		btn.textContent = label;
		btn.style.padding = '8px 14px';
		btn.style.borderRadius = '10px';
		btn.style.fontSize = '12px';
		btn.style.fontWeight = '550';
		btn.style.cursor = 'pointer';
		btn.style.border = primary ? `1px solid ${ACCENT}` : `1px solid ${BORDER}`;
		btn.style.background = primary ? ACCENT : SURFACE;
		btn.style.color = primary ? '#042f2e' : TEXT;
		btn.style.outline = 'none';
		this._attachFocusRing(btn);
		this._renderDisposables.add(DOM.addDisposableListener(btn, 'click', onClick));
	}

	private _linkButton(parent: HTMLElement, label: string, onClick: () => void): void {
		const btn = DOM.append(parent, DOM.$('button')) as HTMLButtonElement;
		btn.type = 'button';
		btn.textContent = label;
		btn.style.border = 'none';
		btn.style.background = 'transparent';
		btn.style.color = ACCENT;
		btn.style.fontSize = '11px';
		btn.style.cursor = 'pointer';
		btn.style.padding = '2px 4px';
		btn.style.outline = 'none';
		btn.style.borderRadius = '4px';
		this._attachFocusRing(btn);
		this._renderDisposables.add(DOM.addDisposableListener(btn, 'click', onClick));
	}
}
