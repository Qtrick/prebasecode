/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../../../base/browser/dom.js';
import { DisposableStore } from '../../../../../../base/common/lifecycle.js';
import { CancellationTokenSource } from '../../../../../../base/common/cancellation.js';
import { URI } from '../../../../../../base/common/uri.js';
import { localize, localize2 } from '../../../../../../nls.js';
import { CommandsRegistry, ICommandService } from '../../../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../../../platform/keybinding/common/keybinding.js';
import { IOpenerService } from '../../../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../../../platform/theme/common/themeService.js';
import { IWorkspaceContextService } from '../../../../../../platform/workspace/common/workspace.js';
import { ViewPane } from '../../../../../browser/parts/views/viewPane.js';
import { IViewletViewOptions } from '../../../../../browser/parts/views/viewsViewlet.js';
import { IViewDescriptorService } from '../../../../../common/views.js';
import { IEditorService } from '../../../../../services/editor/common/editorService.js';
import { computeLanguageStats } from '../../core/analysis/languageStats.js';
import type { GraphNode } from '../../common/types/graphTypes.js';
import { PreBaseGraphConfigKeys } from '../../common/configuration/graphConfigKeys.js';
import { IPreBaseGraphService } from './prebaseGraphService.js';
import { IPreBaseTemporalViewService } from '../../temporal/view/temporalViewTypes.js';
import { IWorkbenchGitHistoryService } from './workbenchGitHistoryService.js';
import type { GitCommitMetadata } from '../../history/git/gitTypes.js';
import { PreBaseGraphEditorInput } from './graphEditorInput.js';

type GraphFilterId = 'all' | 'files' | 'components' | 'dependencies';
type ExplorerViewMode = 'flat' | 'tree';

const FILTERS: { id: GraphFilterId; label: string }[] = [
	{ id: 'all', label: 'All' },
	{ id: 'files', label: 'Files' },
	{ id: 'components', label: 'Components' },
	{ id: 'dependencies', label: 'Dependencies' },
];

const ACCENT = '#2dd4bf';
const ACCENT_SOFT = '#2dd4bf22';
const TEXT = 'var(--vscode-foreground)';
const MUTED = 'var(--vscode-descriptionForeground)';
const SURFACE = 'var(--vscode-input-background)';
const SURFACE_OVERLAY = 'var(--vscode-editorWidget-background)';
const BORDER = 'var(--vscode-input-border, var(--vscode-widget-border))';

interface ExplorerDirNode {
	type: 'dir';
	name: string;
	fullPath: string;
	children: ExplorerTreeNode[];
}

interface ExplorerFileNode {
	type: 'file';
	name: string;
	node: GraphNode;
}

type ExplorerTreeNode = ExplorerDirNode | ExplorerFileNode;

export class PreBaseMapsViewPane extends ViewPane {
	static readonly ID = 'workbench.view.prebase.maps.explorer';
	static readonly LABEL = localize2('prebase.maps.view', "Graph");

	private _scroll: HTMLElement | undefined;
	private _langSection: HTMLElement | undefined;
	private _filterSection: HTMLElement | undefined;
	private _networkSection: HTMLElement | undefined;
	private _displaySection: HTMLElement | undefined;
	private _historySection: HTMLElement | undefined;
	private _historyBody: HTMLElement | undefined;
	private _historyList: HTMLElement | undefined;
	private _temporalSection: HTMLElement | undefined;
	private _temporalBody: HTMLElement | undefined;
	private _temporalExpanded = true;
	private _temporalRefSelect: HTMLSelectElement | undefined;
	private _temporalCompareSelect: HTMLSelectElement | undefined;
	private _temporalFollowHeadCheckbox: HTMLInputElement | undefined;
	private _temporalModeStateBtn: HTMLButtonElement | undefined;
	private _temporalModeChangesBtn: HTMLButtonElement | undefined;
	private _temporalFilterInput: HTMLInputElement | undefined;
	private _temporalStatusBadge: HTMLElement | undefined;
	private _temporalChangeBadgesWrap: HTMLElement | undefined;
	private _temporalSyncBtn: HTMLButtonElement | undefined;
	private _explorerList: HTMLElement | undefined;
	private _diag: HTMLElement | undefined;

	private _modeNetBtn: HTMLButtonElement | undefined;
	private _modeTemporalBtn: HTMLButtonElement | undefined;
	private _graphModeHelper: HTMLElement | undefined;
	private _graphModeOpenBtn: HTMLButtonElement | undefined;
	private _searchInput: HTMLInputElement | undefined;
	private _commitSearchInput: HTMLInputElement | undefined;
	private _idleRotateCheckbox: HTMLInputElement | undefined;
	private _legendCheckbox: HTMLInputElement | undefined;
	private _displayBody: HTMLElement | undefined;
	private _legendContainer: HTMLElement | undefined;

	private readonly _filterButtons = new Map<GraphFilterId, HTMLButtonElement>();
	private readonly _networkLayoutButtons = new Map<string, HTMLButtonElement>();
	private readonly _explorerModeButtons = new Map<ExplorerViewMode, HTMLButtonElement>();
	private readonly _expandedDirs = new Set<string>(['src']);
	private readonly _explorerDisposables = this._register(new DisposableStore());
	private readonly _historyDisposables = this._register(new DisposableStore());

	private _searchQuery = '';
	private _commitSearchQuery = '';
	private _remoteSearchResults: GitCommitMetadata[] | null = null;
	private _isSearchingHistory = false;
	private _searchCts: CancellationTokenSource | null = null;
	private _searchDebounceTimer: any = null;
	private _historyExpanded = true;

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
		@IPreBaseGraphService private readonly graphService: IPreBaseGraphService,
		@IPreBaseTemporalViewService private readonly temporalViewService: IPreBaseTemporalViewService,
		@IWorkbenchGitHistoryService private readonly gitHistoryService: IWorkbenchGitHistoryService,
		@ICommandService private readonly commandService: ICommandService,
		@IEditorService private readonly editorService: IEditorService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
		this._register(this.graphService.onDidChangeDiagnostics(() => this._refresh()));
		this._register(this.graphService.onDidChangeViewState(() => this._refresh()));
		this._register(this.graphService.onDidChangeSnapshot(() => this._refresh()));
		this._register(this.temporalViewService.onDidChangeState(() => {
			this._refreshTemporal();
			this._refreshHistory();
		}));
		this._register(this.temporalViewService.onDidChangeTimeline(() => {
			this._refreshTemporal();
			this._refreshHistory();
		}));
		this._register(this.temporalViewService.onDidChangeDiff(() => {
			this._refreshTemporal();
		}));
		this._register(this.editorService.onDidActiveEditorChange(() => this._refresh()));
		this._register(this.workspaceContextService.onDidChangeWorkbenchState(() => this._refresh()));
		this._register(this.workspaceContextService.onDidChangeWorkspaceFolders(() => this._refresh()));
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (
				e.affectsConfiguration(PreBaseGraphConfigKeys.GraphNetworkIdleAutoRotate) ||
				e.affectsConfiguration(PreBaseGraphConfigKeys.GraphShowLegend) ||
				e.affectsConfiguration(PreBaseGraphConfigKeys.GraphExplorerViewMode) ||
				e.affectsConfiguration(PreBaseGraphConfigKeys.GraphNetworkLayoutMode)
			) {
				this._refresh();
			}
		}));
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		this._scroll = DOM.append(container, DOM.$('.prebase-maps-view'));
		this._scroll.style.padding = '8px';
		this._scroll.style.display = 'flex';
		this._scroll.style.flexDirection = 'column';
		this._scroll.style.gap = '10px';
		this._scroll.style.overflowY = 'auto';
		this._scroll.style.height = '100%';
		this._scroll.style.boxSizing = 'border-box';

		this._renderGraphMode();
		this._renderLanguages();
		this._renderSearch();
		this._renderFilter();
		this._renderNetwork();
		this._renderTemporal();
		this._renderDisplay();
		this._renderHistory();
		this._renderExplorer();
		this._renderActions();
		this._renderDiagnostics();
		this._refresh();

		if (
			this._hasOpenProject() &&
			this.configurationService.getValue<boolean>(PreBaseGraphConfigKeys.GraphAutoScan) !== false &&
			!this.graphService.getSnapshot() &&
			this.graphService.getDiagnostics().status !== 'scanning'
		) {
			void this.graphService.scanWorkspace();
		}
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		if (this._scroll) {
			this._scroll.style.width = `${width}px`;
			this._scroll.style.height = `${height}px`;
		}
	}

	private _renderGraphMode(): void {
		const section = DOM.append(this._scroll!, DOM.$('div'));
		this._sectionLabel(section, localize('prebase.maps.graphMode', "Graph mode"));
		const row = DOM.append(section, DOM.$('div'));
		this._segmentTrack(row);
		this._modeNetBtn = this._segmentBtn(row, localize('prebase.maps.network', "Code Graph"), () => {
			if (!this._hasOpenProject()) {
				return;
			}
			this.commandService.executeCommand('prebase.graph.openNetwork');
		});
		this._modeTemporalBtn = this._segmentBtn(row, localize('prebase.maps.temporal', "Temporal"), () => {
			if (!this._hasOpenProject()) {
				return;
			}
			this.commandService.executeCommand('prebase.graph.openTemporal');
		});

		this._graphModeHelper = DOM.append(section, DOM.$('p'));
		this._graphModeHelper.style.fontSize = '10px';
		this._graphModeHelper.style.color = MUTED;
		this._graphModeHelper.style.margin = '6px 2px 0';
		this._graphModeHelper.style.lineHeight = '1.4';
		this._graphModeHelper.textContent = localize(
			'prebase.maps.openProjectHint',
			"Open a project to choose a graph mode and generate its visualization."
		);

		this._graphModeOpenBtn = DOM.append(section, DOM.$('button')) as HTMLButtonElement;
		this._graphModeOpenBtn.type = 'button';
		this._graphModeOpenBtn.textContent = localize('prebase.maps.openFolder', "Open Folder");
		this._graphModeOpenBtn.style.marginTop = '6px';
		this._graphModeOpenBtn.style.padding = '4px 8px';
		this._graphModeOpenBtn.style.fontSize = '10px';
		this._graphModeOpenBtn.style.borderRadius = '6px';
		this._graphModeOpenBtn.style.cursor = 'pointer';
		this._graphModeOpenBtn.style.border = `1px solid ${ACCENT}66`;
		this._graphModeOpenBtn.style.background = ACCENT_SOFT;
		this._graphModeOpenBtn.style.color = ACCENT;
		this._register(DOM.addDisposableListener(this._graphModeOpenBtn, 'click', () => {
			void this.commandService.executeCommand('workbench.action.files.openFolder');
		}));
	}

	private _renderLanguages(): void {
		this._langSection = DOM.append(this._scroll!, DOM.$('div'));
	}

	private _renderSearch(): void {
		const section = DOM.append(this._scroll!, DOM.$('div'));
		this._searchInput = DOM.append(section, DOM.$('input')) as HTMLInputElement;
		this._searchInput.type = 'search';
		this._searchInput.placeholder = localize('prebase.maps.searchFiles', "Search files…");
		this._searchInput.style.width = '100%';
		this._searchInput.style.boxSizing = 'border-box';
		this._searchInput.style.padding = '6px 8px';
		this._searchInput.style.fontSize = '11px';
		this._searchInput.style.borderRadius = '6px';
		this._searchInput.style.border = `1px solid ${BORDER}`;
		this._searchInput.style.background = SURFACE_OVERLAY;
		this._searchInput.style.color = TEXT;
		this._register(DOM.addDisposableListener(this._searchInput, 'input', () => {
			this._searchQuery = this._searchInput?.value.trim().toLowerCase() ?? '';
			this._refreshExplorerList();
		}));
	}

	private _renderFilter(): void {
		this._filterSection = DOM.append(this._scroll!, DOM.$('div'));
		this._sectionLabel(this._filterSection, localize('prebase.maps.filter', "Filter"));
		const row = DOM.append(this._filterSection, DOM.$('div'));
		row.style.display = 'flex';
		row.style.flexWrap = 'wrap';
		row.style.gap = '4px';
		for (const f of FILTERS) {
			const btn = this._chipBtn(row, f.label, () => {
				void this.configurationService.updateValue(PreBaseGraphConfigKeys.GraphFilter, f.id);
			});
			this._filterButtons.set(f.id, btn);
		}
	}

	private _renderNetwork(): void {
		this._networkSection = DOM.append(this._scroll!, DOM.$('div'));
		this._sectionLabel(this._networkSection, localize('prebase.maps.networkSection', "Network"));

		this._sectionLabel(this._networkSection, localize('prebase.maps.networkLayout', "Network Layout"));
		const layoutCol = DOM.append(this._networkSection, DOM.$('div'));
		layoutCol.style.display = 'flex';
		layoutCol.style.flexDirection = 'column';
		layoutCol.style.gap = '2px';
		layoutCol.style.marginBottom = '8px';
		const modes: { id: string; label: string }[] = [
			{ id: 'organic', label: localize('prebase.maps.net.organic', "Organic") },
			{ id: 'sphere', label: localize('prebase.maps.net.sphere', "Sphere") },
			{ id: 'constellation', label: localize('prebase.maps.net.constellation', "Constellation") },
			{ id: 'clustered', label: localize('prebase.maps.net.clustered', "Clustered") },
			{ id: 'radial', label: localize('prebase.maps.net.radial', "Radial") },
		];
		for (const m of modes) {
			const btn = this._chipBtn(layoutCol, m.label, () => {
				void this.configurationService.updateValue(PreBaseGraphConfigKeys.GraphNetworkLayoutMode, m.id);
			}, true, true);
			btn.dataset['networkLayout'] = m.id;
			this._networkLayoutButtons.set(m.id, btn);
		}

		const idleRow = DOM.append(this._networkSection, DOM.$('label'));
		idleRow.style.display = 'flex';
		idleRow.style.alignItems = 'center';
		idleRow.style.gap = '8px';
		idleRow.style.fontSize = '11px';
		idleRow.style.color = TEXT;
		idleRow.style.cursor = 'pointer';
		idleRow.style.marginBottom = '6px';
		this._idleRotateCheckbox = DOM.append(idleRow, DOM.$('input')) as HTMLInputElement;
		this._idleRotateCheckbox.type = 'checkbox';
		this._idleRotateCheckbox.style.accentColor = ACCENT;
		DOM.append(idleRow, DOM.$('span')).textContent = localize('prebase.maps.idleAutoRotate', "Idle auto-rotate");
		this._register(DOM.addDisposableListener(this._idleRotateCheckbox, 'change', () => {
			void this.configurationService.updateValue(
				PreBaseGraphConfigKeys.GraphNetworkIdleAutoRotate,
				!!this._idleRotateCheckbox?.checked
			);
		}));

		const netActions = DOM.append(this._networkSection, DOM.$('div'));
		netActions.style.display = 'flex';
		netActions.style.gap = '6px';
		netActions.style.flexWrap = 'wrap';
		this._chipBtn(netActions, localize('prebase.maps.resetView', "Reset View"), () => {
			this.commandService.executeCommand('prebase.graph.resetView');
		});
		this._chipBtn(netActions, localize('prebase.maps.fitView', "Fit View"), () => {
			this.commandService.executeCommand('prebase.graph.fitView');
		});
	}

	private _renderDisplay(): void {
		this._displaySection = DOM.append(this._scroll!, DOM.$('div'));
		const header = DOM.append(this._displaySection, DOM.$('button')) as HTMLButtonElement;
		header.type = 'button';
		header.textContent = localize('prebase.maps.display', "▸ Display");
		header.style.all = 'unset';
		header.style.fontSize = '10px';
		header.style.fontWeight = '600';
		header.style.letterSpacing = '0.06em';
		header.style.textTransform = 'uppercase';
		header.style.color = MUTED;
		header.style.cursor = 'pointer';
		header.style.marginBottom = '4px';
		header.style.display = 'block';

		this._displayBody = DOM.append(this._displaySection, DOM.$('div'));
		this._displayBody.style.display = 'none';
		this._displayBody.style.paddingLeft = '2px';

		const legendRow = DOM.append(this._displayBody, DOM.$('label'));
		legendRow.style.display = 'flex';
		legendRow.style.alignItems = 'center';
		legendRow.style.gap = '8px';
		legendRow.style.fontSize = '11px';
		legendRow.style.color = TEXT;
		legendRow.style.cursor = 'pointer';
		this._legendCheckbox = DOM.append(legendRow, DOM.$('input')) as HTMLInputElement;
		this._legendCheckbox.type = 'checkbox';
		this._legendCheckbox.style.accentColor = ACCENT;
		DOM.append(legendRow, DOM.$('span')).textContent = localize('prebase.maps.showLegend', "Show legend");
		this._register(DOM.addDisposableListener(this._legendCheckbox, 'change', () => {
			void this.configurationService.updateValue(
				PreBaseGraphConfigKeys.GraphShowLegend,
				!!this._legendCheckbox?.checked
			);
		}));

		this._legendContainer = DOM.append(this._displayBody, DOM.$('div'));
		this._legendContainer.style.marginTop = '8px';
		this._legendContainer.style.paddingTop = '6px';
		this._legendContainer.style.borderTop = `1px solid color-mix(in srgb, ${BORDER} 40%, transparent)`;

		this._register(DOM.addDisposableListener(header, 'click', () => {
			const open = this._displayBody?.style.display !== 'none';
			if (this._displayBody) {
				this._displayBody.style.display = open ? 'none' : 'block';
			}
			header.textContent = open
				? localize('prebase.maps.display', "▸ Display")
				: localize('prebase.maps.displayOpen', "▾ Display");
		}));
	}

	private _renderTemporal(): void {
		this._temporalSection = DOM.append(this._scroll!, DOM.$('div'));
		this._temporalSection.style.borderTop = `1px solid color-mix(in srgb, ${BORDER} 60%, transparent)`;
		this._temporalSection.style.paddingTop = '8px';

		const header = DOM.append(this._temporalSection, DOM.$('button')) as HTMLButtonElement;
		header.type = 'button';
		header.textContent = this._temporalExpanded
			? localize('prebase.maps.temporalOpen', "▾ Temporal & Compare")
			: localize('prebase.maps.temporalClosed', "▸ Temporal & Compare");
		header.style.all = 'unset';
		header.style.fontSize = '10px';
		header.style.fontWeight = '600';
		header.style.letterSpacing = '0.06em';
		header.style.textTransform = 'uppercase';
		header.style.color = MUTED;
		header.style.cursor = 'pointer';
		header.style.marginBottom = '6px';
		header.style.display = 'block';

		this._temporalBody = DOM.append(this._temporalSection, DOM.$('div'));
		this._temporalBody.style.display = this._temporalExpanded ? 'flex' : 'none';
		this._temporalBody.style.flexDirection = 'column';
		this._temporalBody.style.gap = '8px';
		this._temporalBody.style.paddingInline = '2px';

		// 1. Mode Toggles: Full Map vs Focus Changes
		const modeRow = DOM.append(this._temporalBody, DOM.$('div'));
		this._segmentTrack(modeRow);
		this._temporalModeStateBtn = this._segmentBtn(modeRow, localize('prebase.maps.fullMap', "Full Map"), () => {
			this.temporalViewService.setDisplayMode('state');
		});
		this._temporalModeChangesBtn = this._segmentBtn(modeRow, localize('prebase.maps.focusChanges', "Focus Changes"), () => {
			this.temporalViewService.setDisplayMode('changes');
		});

		// 2. Branch & Compare Selectors
		const selCol = DOM.append(this._temporalBody, DOM.$('div'));
		selCol.style.display = 'flex';
		selCol.style.flexDirection = 'column';
		selCol.style.gap = '6px';

		// Branch row
		const branchRow = DOM.append(selCol, DOM.$('div'));
		branchRow.style.display = 'flex';
		branchRow.style.alignItems = 'center';
		branchRow.style.justifyContent = 'space-between';
		branchRow.style.gap = '6px';

		const branchLbl = DOM.append(branchRow, DOM.$('span'));
		branchLbl.textContent = localize('prebase.maps.branch', "Branch:");
		branchLbl.style.fontSize = '11px';
		branchLbl.style.color = MUTED;

		this._temporalRefSelect = DOM.append(branchRow, DOM.$('select')) as HTMLSelectElement;
		this._temporalRefSelect.style.flex = '1';
		this._temporalRefSelect.style.fontSize = '11px';
		this._temporalRefSelect.style.padding = '3px 4px';
		this._temporalRefSelect.style.borderRadius = '4px';
		this._temporalRefSelect.style.border = `1px solid ${BORDER}`;
		this._temporalRefSelect.style.background = SURFACE;
		this._temporalRefSelect.style.color = TEXT;
		this._register(DOM.addDisposableListener(this._temporalRefSelect, 'change', () => {
			if (this._temporalRefSelect?.value) {
				void this.temporalViewService.selectRef(this._temporalRefSelect.value);
			}
		}));

		// Compare row
		const compRow = DOM.append(selCol, DOM.$('div'));
		compRow.style.display = 'flex';
		compRow.style.alignItems = 'center';
		compRow.style.justifyContent = 'space-between';
		compRow.style.gap = '6px';

		const compLbl = DOM.append(compRow, DOM.$('span'));
		compLbl.textContent = localize('prebase.maps.compare', "Compare:");
		compLbl.style.fontSize = '11px';
		compLbl.style.color = MUTED;

		this._temporalCompareSelect = DOM.append(compRow, DOM.$('select')) as HTMLSelectElement;
		this._temporalCompareSelect.style.flex = '1';
		this._temporalCompareSelect.style.fontSize = '11px';
		this._temporalCompareSelect.style.padding = '3px 4px';
		this._temporalCompareSelect.style.borderRadius = '4px';
		this._temporalCompareSelect.style.border = `1px solid ${BORDER}`;
		this._temporalCompareSelect.style.background = SURFACE;
		this._temporalCompareSelect.style.color = TEXT;
		this._register(DOM.addDisposableListener(this._temporalCompareSelect, 'change', () => {
			if (this._temporalCompareSelect) {
				void this.temporalViewService.setCompareBase(this._temporalCompareSelect.value);
			}
		}));

		// Follow HEAD checkbox row
		const followRow = DOM.append(this._temporalBody, DOM.$('label'));
		followRow.style.display = 'flex';
		followRow.style.alignItems = 'center';
		followRow.style.gap = '6px';
		followRow.style.fontSize = '11px';
		followRow.style.color = TEXT;
		followRow.style.cursor = 'pointer';

		this._temporalFollowHeadCheckbox = DOM.append(followRow, DOM.$('input')) as HTMLInputElement;
		this._temporalFollowHeadCheckbox.type = 'checkbox';
		this._temporalFollowHeadCheckbox.checked = true;
		this._register(DOM.addDisposableListener(this._temporalFollowHeadCheckbox, 'change', () => {
			this.temporalViewService.setFollowHead(this._temporalFollowHeadCheckbox?.checked ?? true);
		}));
		const followText = DOM.append(followRow, DOM.$('span'));
		followText.textContent = localize('prebase.maps.followHead', "Follow HEAD");

		// Entity Filter Input
		this._temporalFilterInput = DOM.append(this._temporalBody, DOM.$('input')) as HTMLInputElement;
		this._temporalFilterInput.type = 'search';
		this._temporalFilterInput.placeholder = localize('prebase.maps.filterEntities', "Filter entities…");
		this._temporalFilterInput.style.width = '100%';
		this._temporalFilterInput.style.boxSizing = 'border-box';
		this._temporalFilterInput.style.padding = '4px 6px';
		this._temporalFilterInput.style.fontSize = '11px';
		this._temporalFilterInput.style.borderRadius = '4px';
		this._temporalFilterInput.style.border = `1px solid ${BORDER}`;
		this._temporalFilterInput.style.background = SURFACE;
		this._temporalFilterInput.style.color = TEXT;
		this._temporalFilterInput.style.outline = 'none';
		this._register(DOM.addDisposableListener(this._temporalFilterInput, 'input', () => {
			this.temporalViewService.setFilterQuery(this._temporalFilterInput?.value || '');
		}));

		// Change Breakdown Badges Summary
		this._temporalChangeBadgesWrap = DOM.append(this._temporalBody, DOM.$('div'));
		this._temporalChangeBadgesWrap.style.display = 'flex';
		this._temporalChangeBadgesWrap.style.alignItems = 'center';
		this._temporalChangeBadgesWrap.style.gap = '4px';
		this._temporalChangeBadgesWrap.style.flexWrap = 'wrap';

		// Status Badge Row
		const statusRow = DOM.append(this._temporalBody, DOM.$('div'));
		statusRow.style.display = 'flex';
		statusRow.style.alignItems = 'center';
		statusRow.style.justifyContent = 'space-between';
		statusRow.style.marginTop = '2px';

		this._temporalStatusBadge = DOM.append(statusRow, DOM.$('span'));
		this._temporalStatusBadge.style.fontSize = '10px';
		this._temporalStatusBadge.style.fontWeight = '600';
		this._temporalStatusBadge.style.padding = '2px 6px';
		this._temporalStatusBadge.style.borderRadius = '4px';

		this._temporalSyncBtn = DOM.append(statusRow, DOM.$('button')) as HTMLButtonElement;
		this._temporalSyncBtn.type = 'button';
		this._temporalSyncBtn.textContent = localize('prebase.maps.syncRemote', "Sync Remote");
		this._temporalSyncBtn.style.fontSize = '10px';
		this._temporalSyncBtn.style.padding = '2px 6px';
		this._temporalSyncBtn.style.borderRadius = '4px';
		this._temporalSyncBtn.style.border = `1px solid ${BORDER}`;
		this._temporalSyncBtn.style.background = SURFACE_OVERLAY;
		this._temporalSyncBtn.style.color = TEXT;
		this._temporalSyncBtn.style.cursor = 'pointer';
		this._register(DOM.addDisposableListener(this._temporalSyncBtn, 'click', () => {
			void this.temporalViewService.refresh();
		}));

		this._register(DOM.addDisposableListener(header, 'click', () => {
			this._temporalExpanded = !this._temporalExpanded;
			if (this._temporalBody) {
				this._temporalBody.style.display = this._temporalExpanded ? 'flex' : 'none';
			}
			header.textContent = this._temporalExpanded
				? localize('prebase.maps.temporalOpen', "▾ Temporal & Compare")
				: localize('prebase.maps.temporalClosed', "▸ Temporal & Compare");
		}));
	}

	private _renderHistory(): void {
		this._historySection = DOM.append(this._scroll!, DOM.$('div'));
		this._historySection.style.borderTop = `1px solid color-mix(in srgb, ${BORDER} 60%, transparent)`;
		this._historySection.style.paddingTop = '8px';

		const header = DOM.append(this._historySection, DOM.$('button')) as HTMLButtonElement;
		header.type = 'button';
		header.textContent = this._historyExpanded
			? localize('prebase.maps.historyOpen', "▾ History")
			: localize('prebase.maps.historyClosed', "▸ History");
		header.style.all = 'unset';
		header.style.fontSize = '10px';
		header.style.fontWeight = '600';
		header.style.letterSpacing = '0.06em';
		header.style.textTransform = 'uppercase';
		header.style.color = MUTED;
		header.style.cursor = 'pointer';
		header.style.marginBottom = '6px';
		header.style.display = 'block';

		this._historyBody = DOM.append(this._historySection, DOM.$('div'));
		this._historyBody.style.display = this._historyExpanded ? 'flex' : 'none';
		this._historyBody.style.flexDirection = 'column';
		this._historyBody.style.width = 'calc(100% - 8px)';
		this._historyBody.style.marginInline = '4px';
		this._historyBody.style.boxSizing = 'border-box';
		this._historyBody.style.border = `1px solid color-mix(in srgb, ${BORDER} 40%, transparent)`;
		this._historyBody.style.borderRadius = '6px';
		this._historyBody.style.background = SURFACE_OVERLAY;
		this._historyBody.style.padding = '4px';

		// Dedicated Commit Search Container (NEVER SCROLLS)
		const searchWrap = DOM.append(this._historyBody, DOM.$('div'));
		searchWrap.style.display = 'flex';
		searchWrap.style.alignItems = 'center';
		searchWrap.style.marginBottom = '6px';
		searchWrap.style.position = 'relative';
		searchWrap.style.flexShrink = '0';

		this._commitSearchInput = DOM.append(searchWrap, DOM.$('input')) as HTMLInputElement;
		this._commitSearchInput.type = 'search';
		this._commitSearchInput.placeholder = localize('prebase.maps.searchCommits', "Search commits… (author:, msg:)");
		this._commitSearchInput.setAttribute('aria-label', localize('prebase.maps.searchCommitsAria', "Search commit history"));
		this._commitSearchInput.style.width = '100%';
		this._commitSearchInput.style.fontSize = '11px';
		this._commitSearchInput.style.padding = '4px 6px';
		this._commitSearchInput.style.borderRadius = '4px';
		this._commitSearchInput.style.border = `1px solid ${BORDER}`;
		this._commitSearchInput.style.background = SURFACE;
		this._commitSearchInput.style.color = TEXT;
		this._commitSearchInput.style.outline = 'none';
		this._commitSearchInput.style.boxSizing = 'border-box';

		this._register(DOM.addDisposableListener(this._commitSearchInput, 'input', () => {
			this._commitSearchQuery = this._commitSearchInput?.value || '';
			this._onCommitSearchInputChanged();
		}));

		this._register(DOM.addDisposableListener(this._commitSearchInput, 'keydown', (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				if (this._commitSearchInput) {
					this._commitSearchInput.value = '';
					this._commitSearchQuery = '';
					this._onCommitSearchInputChanged();
					this._commitSearchInput.blur();
				}
			} else if (e.key === 'ArrowDown') {
				const firstRow = this._historyList?.querySelector<HTMLElement>('.history-item');
				if (firstRow) {
					firstRow.focus();
					e.preventDefault();
				}
			}
		}));

		// Scrolling List Viewport (ONLY THIS SCROLLS)
		const listViewport = DOM.append(this._historyBody, DOM.$('div'));
		listViewport.style.maxHeight = '280px';
		listViewport.style.overflowY = 'auto';
		listViewport.style.boxSizing = 'border-box';
		listViewport.style.width = '100%';

		this._historyList = DOM.append(listViewport, DOM.$('div'));
		this._historyList.setAttribute('role', 'listbox');
		this._historyList.setAttribute('aria-label', localize('prebase.maps.historyListAria', "Commit History"));

		this._register(DOM.addDisposableListener(header, 'click', () => {
			this._historyExpanded = !this._historyExpanded;
			if (this._historyBody) {
				this._historyBody.style.display = this._historyExpanded ? 'flex' : 'none';
			}
			header.textContent = this._historyExpanded
				? localize('prebase.maps.historyOpen', "▾ History")
				: localize('prebase.maps.historyClosed', "▸ History");
		}));
	}

	private _onCommitSearchInputChanged(): void {
		if (this._searchDebounceTimer) {
			clearTimeout(this._searchDebounceTimer);
			this._searchDebounceTimer = null;
		}
		if (this._searchCts) {
			this._searchCts.cancel();
			this._searchCts.dispose();
			this._searchCts = null;
		}

		const query = (this._commitSearchQuery || '').trim();
		if (!query) {
			this._remoteSearchResults = null;
			this._isSearchingHistory = false;
			this._refreshHistory();
			return;
		}

		// Phase 1: Filter currently loaded commits immediately
		this._refreshHistory();

		// Phase 2: Debounced full repository history search across git
		this._searchDebounceTimer = setTimeout(() => {
			void this._performBackendCommitSearch(query);
		}, 250);
	}

	private async _performBackendCommitSearch(query: string): Promise<void> {
		const state = this.temporalViewService.getState();
		const rootPath = state.activeRepositoryRoot;
		if (!rootPath) {
			return;
		}

		this._searchCts = new CancellationTokenSource();
		this._isSearchingHistory = true;
		this._refreshHistory();

		try {
			const results = await this.gitHistoryService.searchHistory(rootPath, { query, limit: 50 }, this._searchCts.token);
			if (!this._searchCts.token.isCancellationRequested) {
				this._remoteSearchResults = results;
				this._isSearchingHistory = false;
				this._refreshHistory();
			}
		} catch (err: any) {
			if (!this._searchCts?.token.isCancellationRequested) {
				this._isSearchingHistory = false;
				this._refreshHistory();
			}
		}
	}

	private _refreshHistory(): void {
		if (!this._historyList) {
			return;
		}
		this._historyDisposables.clear();
		DOM.clearNode(this._historyList);

		const state = this.temporalViewService.getState();
		const loadedTimeline = state.pagedTimeline || [];
		const activeGraphType = this._getActiveGraphType();
		const isNetwork = activeGraphType === 'network';
		const historicalSha = this.graphService.getSelectedHistoricalCommitSha();
		const windowStart = state.timelineWindow ? state.timelineWindow.start : 0;
		const query = (this._commitSearchQuery || '').trim().toLowerCase();

		// Derive actual repository HEAD commit sha if known
		const headRef = state.repositoryRefs?.find(r => r.kind === 'head' || r.name === 'HEAD');
		const headSha = headRef?.targetSha || (state.selectedRef === 'HEAD' && loadedTimeline[0] ? loadedTimeline[0].sha : undefined);

		// Determine list of commits to display (either remote search results, locally filtered loaded timeline, or full timeline)
		interface CommitDisplayItem {
			readonly sha: string;
			readonly shortSha?: string;
			readonly message: string;
			readonly author: string;
			readonly timestamp?: number;
			readonly isMerge?: boolean;
			readonly originalIndex?: number;
		}

		let itemsToRender: CommitDisplayItem[] = [];

		if (query) {
			if (this._remoteSearchResults) {
				itemsToRender = this._remoteSearchResults.map(c => ({
					sha: c.sha,
					shortSha: c.sha.slice(0, 7),
					message: c.message,
					author: c.author?.name || '',
					timestamp: c.authorTimestamp,
					isMerge: c.parents && c.parents.length > 1,
				}));
			} else {
				// Instant Phase 1 filter on loaded timeline
				itemsToRender = loadedTimeline
					.map((c, i) => ({
						sha: c.sha,
						shortSha: c.shortSha || c.sha.slice(0, 7),
						message: c.message,
						author: c.author,
						timestamp: c.timestamp,
						isMerge: c.isMerge,
						originalIndex: windowStart + i,
					}))
					.filter(c =>
						c.message.toLowerCase().includes(query) ||
						c.sha.toLowerCase().includes(query) ||
						c.author.toLowerCase().includes(query)
					);
			}
		} else {
			itemsToRender = loadedTimeline.map((c, i) => ({
				sha: c.sha,
				shortSha: c.shortSha || c.sha.slice(0, 7),
				message: c.message,
				author: c.author,
				timestamp: c.timestamp,
				isMerge: c.isMerge,
				originalIndex: windowStart + i,
			}));
		}

		// 1. Mode-Adaptive Special Top Row (Code Graph only: Live Working Tree, shown when not searching)
		if (isNetwork && !query) {
			const isWtSelected = !historicalSha;
			const wtRow = DOM.append(this._historyList, DOM.$('div'));
			wtRow.tabIndex = 0;
			wtRow.setAttribute('role', 'option');
			wtRow.setAttribute('aria-selected', isWtSelected ? 'true' : 'false');
			wtRow.className = 'history-item history-working-tree' + (isWtSelected ? ' selected' : '');
			wtRow.dataset.commitSha = '__special_top_row__';
			wtRow.style.display = 'flex';
			wtRow.style.flexDirection = 'column';
			wtRow.style.gap = '2px';
			wtRow.style.padding = '4px 6px';
			wtRow.style.marginBottom = '2px';
			wtRow.style.borderRadius = '4px';
			wtRow.style.cursor = 'pointer';
			wtRow.style.boxSizing = 'border-box';
			wtRow.style.width = '100%';
			wtRow.style.background = isWtSelected ? ACCENT_SOFT : 'transparent';
			wtRow.style.border = isWtSelected ? `1px solid ${ACCENT}88` : '1px solid transparent';
			wtRow.style.outline = 'none';

			const wtLine1 = DOM.append(wtRow, DOM.$('div'));
			wtLine1.style.display = 'flex';
			wtLine1.style.alignItems = 'center';
			wtLine1.style.gap = '6px';

			const wtBadge = DOM.append(wtLine1, DOM.$('span'));
			wtBadge.textContent = '● Live';
			wtBadge.style.fontSize = '10px';
			wtBadge.style.fontWeight = '600';
			wtBadge.style.color = 'var(--vscode-gitDecoration-addedResourceForeground, #3fb950)';
			wtBadge.style.flexShrink = '0';

			const wtMsg = DOM.append(wtLine1, DOM.$('span'));
			wtMsg.textContent = localize('prebase.maps.workingTree', "Working Tree · Live Codebase");
			wtMsg.style.fontSize = '11px';
			wtMsg.style.fontWeight = '600';
			wtMsg.style.color = TEXT;
			wtMsg.style.overflow = 'hidden';
			wtMsg.style.textOverflow = 'ellipsis';
			wtMsg.style.whiteSpace = 'nowrap';
			wtMsg.style.flex = '1';

			const onSelectSpecialRow = () => {
				void this.graphService.loadHistoricalCommit(undefined);
				this._refreshHistorySelection();
			};

			this._historyDisposables.add(DOM.addDisposableListener(wtRow, 'click', (e) => {
				e.stopPropagation();
				onSelectSpecialRow();
			}));
			this._historyDisposables.add(DOM.addDisposableListener(wtRow, 'keydown', (e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					e.stopPropagation();
					onSelectSpecialRow();
				}
			}));
		}

		// Searching Status Indicator
		if (this._isSearchingHistory) {
			const searchStatus = DOM.append(this._historyList, DOM.$('div'));
			searchStatus.textContent = localize('prebase.maps.searchingHistory', "Searching full Git history…");
			searchStatus.style.fontSize = '10.5px';
			searchStatus.style.color = ACCENT;
			searchStatus.style.padding = '4px 6px';
			searchStatus.style.fontStyle = 'italic';
		}

		if (itemsToRender.length === 0 && !this._isSearchingHistory) {
			const empty = DOM.append(this._historyList, DOM.$('div'));
			empty.textContent = query
				? localize('prebase.maps.noCommitMatches', "No commits match \"{0}\".", query)
				: localize('prebase.maps.historyEmpty', "No commit history loaded.");
			empty.style.fontSize = '11px';
			empty.style.color = MUTED;
			empty.style.padding = '8px';
			return;
		}

		// 2. Commit Rows
		for (let i = 0; i < itemsToRender.length; i++) {
			const commit = itemsToRender[i];
			const isSelected = isNetwork
				? Boolean(historicalSha && commit.sha === historicalSha)
				: Boolean(commit.sha === state.selectedCommitSha || (!state.selectedCommitSha && !query && i === 0));

			const isHeadCommit = headSha ? commit.sha === headSha : (!query && state.selectedRef === 'HEAD' && i === 0);

			const row = DOM.append(this._historyList, DOM.$('div'));
			row.tabIndex = 0;
			row.setAttribute('role', 'option');
			row.setAttribute('aria-selected', isSelected ? 'true' : 'false');
			row.className = 'history-item' + (isSelected ? ' selected' : '');
			row.dataset.commitSha = commit.sha;
			row.style.display = 'flex';
			row.style.flexDirection = 'column';
			row.style.gap = '2px';
			row.style.padding = '4px 6px';
			row.style.marginBottom = '2px';
			row.style.borderRadius = '4px';
			row.style.cursor = 'pointer';
			row.style.boxSizing = 'border-box';
			row.style.width = '100%';
			row.style.background = isSelected ? ACCENT_SOFT : 'transparent';
			row.style.border = isSelected ? `1px solid ${ACCENT}88` : '1px solid transparent';
			row.style.outline = 'none';

			// Line 1: message (prominent) + HEAD badge + isMerge badge
			const line1 = DOM.append(row, DOM.$('div'));
			line1.style.display = 'flex';
			line1.style.alignItems = 'center';
			line1.style.gap = '6px';
			line1.style.overflow = 'hidden';

			if (isHeadCommit) {
				const headBadge = DOM.append(line1, DOM.$('span'));
				headBadge.textContent = 'HEAD';
				headBadge.style.fontSize = '9px';
				headBadge.style.fontWeight = '700';
				headBadge.style.padding = '0 4px';
				headBadge.style.borderRadius = '3px';
				headBadge.style.background = 'rgba(45, 212, 191, 0.2)';
				headBadge.style.color = '#2dd4bf';
				headBadge.style.flexShrink = '0';
			}

			if (commit.isMerge) {
				const mergeBadge = DOM.append(line1, DOM.$('span'));
				mergeBadge.textContent = 'M';
				mergeBadge.title = localize('prebase.maps.mergeCommit', "Merge Commit");
				mergeBadge.style.fontSize = '9px';
				mergeBadge.style.fontWeight = '700';
				mergeBadge.style.padding = '0 3px';
				mergeBadge.style.borderRadius = '2px';
				mergeBadge.style.background = 'rgba(163, 113, 247, 0.25)';
				mergeBadge.style.color = '#a371f7';
				mergeBadge.style.flexShrink = '0';
			}

			const msgSpan = DOM.append(line1, DOM.$('span'));
			msgSpan.textContent = commit.message || '(no message)';
			msgSpan.style.fontSize = '11px';
			msgSpan.style.fontWeight = '600';
			msgSpan.style.color = TEXT;
			msgSpan.style.overflow = 'hidden';
			msgSpan.style.textOverflow = 'ellipsis';
			msgSpan.style.whiteSpace = 'nowrap';
			msgSpan.style.flex = '1';

			// Line 2: short SHA + localized date + author
			const line2 = DOM.append(row, DOM.$('div'));
			line2.style.display = 'flex';
			line2.style.alignItems = 'center';
			line2.style.justifyContent = 'space-between';
			line2.style.fontSize = '9.5px';
			line2.style.color = MUTED;

			const leftMeta = DOM.append(line2, DOM.$('span'));
			leftMeta.style.display = 'flex';
			leftMeta.style.alignItems = 'center';
			leftMeta.style.gap = '6px';

			const shaBadge = DOM.append(leftMeta, DOM.$('span'));
			shaBadge.textContent = commit.shortSha || commit.sha.slice(0, 7);
			shaBadge.style.fontFamily = 'monospace';
			shaBadge.style.fontSize = '10px';
			shaBadge.style.color = isSelected ? ACCENT : 'var(--vscode-textLink-foreground, #58a6ff)';
			shaBadge.style.flexShrink = '0';

			const dateSpan = DOM.append(leftMeta, DOM.$('span'));
			dateSpan.textContent = commit.timestamp ? new Date(commit.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

			const authorSpan = DOM.append(line2, DOM.$('span'));
			authorSpan.textContent = commit.author || '';
			authorSpan.style.overflow = 'hidden';
			authorSpan.style.textOverflow = 'ellipsis';
			authorSpan.style.whiteSpace = 'nowrap';
			authorSpan.style.maxWidth = '90px';

			const onSelect = () => {
				const activeType = this._getActiveGraphType();
				if (activeType === 'network') {
					void this.graphService.loadHistoricalCommit(commit.sha);
				} else {
					if (typeof commit.originalIndex === 'number') {
						void this.temporalViewService.selectCommitIndex(commit.originalIndex, { immediate: true });
					} else {
						void this.temporalViewService.selectCommit(commit.sha);
					}
				}
				this._refreshHistorySelection();
			};

			this._historyDisposables.add(DOM.addDisposableListener(row, 'click', (e) => {
				e.stopPropagation();
				onSelect();
			}));

			this._historyDisposables.add(DOM.addDisposableListener(row, 'keydown', (e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					e.stopPropagation();
					onSelect();
				}
			}));
		}

		if (!query && state.historyHasMore) {
			const loadMoreBtn = DOM.append(this._historyList, DOM.$('button')) as HTMLButtonElement;
			loadMoreBtn.type = 'button';
			loadMoreBtn.textContent = state.isLoadingMoreHistory
				? localize('prebase.maps.historyLoading', "Loading older commits…")
				: localize('prebase.maps.historyLoadMore', "Load older commits…");
			loadMoreBtn.disabled = !!state.isLoadingMoreHistory;
			loadMoreBtn.style.display = 'block';
			loadMoreBtn.style.width = '100%';
			loadMoreBtn.style.padding = '6px';
			loadMoreBtn.style.marginTop = '4px';
			loadMoreBtn.style.fontSize = '10.5px';
			loadMoreBtn.style.borderRadius = '4px';
			loadMoreBtn.style.border = `1px solid ${BORDER}`;
			loadMoreBtn.style.background = SURFACE;
			loadMoreBtn.style.color = TEXT;
			loadMoreBtn.style.cursor = state.isLoadingMoreHistory ? 'not-allowed' : 'pointer';

			this._historyDisposables.add(DOM.addDisposableListener(loadMoreBtn, 'click', () => {
				void this.temporalViewService.loadMoreHistory();
			}));
		}
	}

	private _refreshHistorySelection(): void {
		if (!this._historyList) return;
		const isNetwork = this._getActiveGraphType() === 'network';
		const historicalSha = this.graphService.getSelectedHistoricalCommitSha();
		const state = this.temporalViewService.getState();
		const timeline = state.pagedTimeline || [];

		const targetSha = isNetwork
			? (historicalSha || '__special_top_row__')
			: state.selectedCommitSha;

		const isSpecialTopSelected = isNetwork ? !historicalSha : false;

		const rows = this._historyList.querySelectorAll<HTMLElement>('.history-item');
		rows.forEach(r => {
			const rowSha = r.dataset.commitSha;
			let isSel = false;
			if (rowSha === '__special_top_row__') {
				isSel = isSpecialTopSelected;
			} else {
				isSel = isNetwork
					? (Boolean(historicalSha && rowSha === historicalSha))
					: (Boolean(rowSha === targetSha || (!targetSha && rowSha === timeline[0]?.sha)));
			}
			r.setAttribute('aria-selected', isSel ? 'true' : 'false');
			r.style.background = isSel ? ACCENT_SOFT : 'transparent';
			r.style.border = isSel ? `1px solid ${ACCENT}88` : '1px solid transparent';
			const shaEl = r.querySelector('span[style*="monospace"]');
			if (shaEl) {
				(shaEl as HTMLElement).style.color = isSel ? ACCENT : 'var(--vscode-textLink-foreground, #58a6ff)';
			}
		});
	}

	private _getActiveGraphType(): 'network' | 'temporal' {
		const activeEditor = this.editorService.activeEditor;
		if (activeEditor instanceof PreBaseGraphEditorInput) {
			return activeEditor.graphType;
		}
		return this.graphService.getViewState().graphType === 'temporal' ? 'temporal' : 'network';
	}

	private _renderExplorer(): void {
		const section = DOM.append(this._scroll!, DOM.$('div'));
		section.style.borderTop = `1px solid color-mix(in srgb, ${BORDER} 60%, transparent)`;
		section.style.paddingTop = '8px';

		const header = DOM.append(section, DOM.$('div'));
		header.style.display = 'flex';
		header.style.alignItems = 'center';
		header.style.justifyContent = 'space-between';
		header.style.marginBottom = '6px';
		header.style.gap = '6px';

		const title = DOM.append(header, DOM.$('span'));
		title.textContent = localize('prebase.maps.explorer', "Project Explorer");
		title.style.fontSize = '10px';
		title.style.fontWeight = '600';
		title.style.letterSpacing = '0.06em';
		title.style.textTransform = 'uppercase';
		title.style.color = MUTED;

		const toggle = DOM.append(header, DOM.$('div'));
		this._segmentTrack(toggle);
		toggle.style.width = 'auto';
		for (const mode of ['flat', 'tree'] as ExplorerViewMode[]) {
			const label = mode === 'flat'
				? localize('prebase.maps.flat', "Flat")
				: localize('prebase.maps.tree', "Tree");
			const btn = this._segmentBtn(toggle, label, () => {
				void this.configurationService.updateValue(PreBaseGraphConfigKeys.GraphExplorerViewMode, mode);
			});
			btn.style.padding = '3px 8px';
			this._explorerModeButtons.set(mode, btn);
		}

		this._explorerList = DOM.append(section, DOM.$('div'));
		this._explorerList.style.maxHeight = '240px';
		this._explorerList.style.overflowY = 'auto';
		this._explorerList.style.border = `1px solid color-mix(in srgb, ${BORDER} 40%, transparent)`;
		this._explorerList.style.borderRadius = '6px';
		this._explorerList.style.background = SURFACE_OVERLAY;
		this._explorerList.style.padding = '4px';
	}

	private _renderActions(): void {
		const actions = DOM.append(this._scroll!, DOM.$('div'));
		actions.style.display = 'flex';
		actions.style.gap = '6px';
		actions.style.flexWrap = 'wrap';
		this._chipBtn(actions, localize('prebase.maps.rescan', "Rescan"), () => {
			this.commandService.executeCommand('prebase.graph.rescanWorkspace');
		});
		this._chipBtn(actions, localize('prebase.maps.cancel', "Cancel"), () => {
			this.commandService.executeCommand('prebase.graph.cancelScan');
		});
		this._chipBtn(actions, localize('prebase.maps.diagnostics', "Diagnostics"), () => {
			this.commandService.executeCommand('prebase.graph.showDiagnostics');
		});
		this._chipBtn(actions, localize('prebase.maps.openSettings', "PreBase Settings"), () => {
			if (CommandsRegistry.getCommand('prebase.settings.open')) {
				this.commandService.executeCommand('prebase.settings.open');
			} else {
				this.commandService.executeCommand('workbench.action.openSettings', 'prebase.');
			}
		});
	}

	private _renderDiagnostics(): void {
		this._diag = DOM.append(this._scroll!, DOM.$('.prebase-maps-diag'));
		this._diag.style.fontSize = '11px';
		this._diag.style.opacity = '0.9';
		this._diag.style.lineHeight = '1.45';
		this._diag.style.whiteSpace = 'pre-wrap';
		this._diag.style.color = MUTED;
	}

	private _refresh(): void {
		const diag = this.graphService.getDiagnostics();
		const activeGraphType = this._getActiveGraphType();
		const isTemporal = activeGraphType === 'temporal';
		const isNetwork = !isTemporal;
		const isOverview = false;
		const hasProject = this._hasOpenProject();
		const scanStatus = diag.status;

		this._styleSegmentActive(this._modeNetBtn, isNetwork);
		this._styleSegmentActive(this._modeTemporalBtn, isTemporal);
		this._setModeEnabled(this._modeNetBtn, hasProject);
		this._setModeEnabled(this._modeTemporalBtn, hasProject);

		if (this._graphModeHelper) {
			if (!hasProject) {
				this._graphModeHelper.style.display = 'block';
				this._graphModeHelper.textContent = localize(
					'prebase.maps.openProjectHint',
					"Open a project to choose a graph mode and generate its visualization."
				);
			} else if (scanStatus === 'scanning') {
				this._graphModeHelper.style.display = 'block';
				this._graphModeHelper.textContent = localize('prebase.maps.scanningHint', "Scanning this project…");
			} else if (scanStatus === 'error') {
				this._graphModeHelper.style.display = 'block';
				this._graphModeHelper.textContent = diag.message
					|| localize('prebase.maps.scanFailedHint', "Scan failed. Use Rescan to try again.");
			} else if (!this.graphService.getSnapshot() && scanStatus !== 'ready') {
				this._graphModeHelper.style.display = 'block';
				this._graphModeHelper.textContent = localize(
					'prebase.maps.scanProjectHint',
					"Scan this project to generate the graph."
				);
			} else {
				this._graphModeHelper.style.display = 'none';
			}
		}
		if (this._graphModeOpenBtn) {
			this._graphModeOpenBtn.style.display = hasProject ? 'none' : 'inline-block';
		}

		this._refreshLanguages();

		if (this._filterSection) {
			this._filterSection.style.display = isOverview || !hasProject ? 'none' : 'block';
		}
		const filter = this._getFilter();
		for (const [id, btn] of this._filterButtons) {
			this._styleChipActive(btn, id === filter);
		}

		if (this._networkSection) {
			this._networkSection.style.display = isNetwork && hasProject ? 'block' : 'none';
		}
		if (this._displaySection) {
			this._displaySection.style.display = hasProject ? 'block' : 'none';
		}
		if (this._historySection) {
			this._historySection.style.display = hasProject ? 'block' : 'none';
		}

		if (this._idleRotateCheckbox) {
			this._idleRotateCheckbox.checked = !!this.configurationService.getValue<boolean>(PreBaseGraphConfigKeys.GraphNetworkIdleAutoRotate);
		}
		if (this._legendCheckbox) {
			this._legendCheckbox.checked = this.configurationService.getValue<boolean>(PreBaseGraphConfigKeys.GraphShowLegend) !== false;
		}

		const networkLayout = this.configurationService.getValue<string>(PreBaseGraphConfigKeys.GraphNetworkLayoutMode) || 'organic';
		for (const [mode, btn] of this._networkLayoutButtons) {
			this._styleChipActive(btn, mode === networkLayout, true);
			btn.disabled = !hasProject;
			btn.style.opacity = hasProject ? '1' : '0.45';
			btn.style.cursor = hasProject ? 'pointer' : 'not-allowed';
		}

		const explorerMode = this._getExplorerViewMode();
		for (const [mode, btn] of this._explorerModeButtons) {
			this._styleSegmentActive(btn, mode === explorerMode);
		}

		this._refreshExplorerList();
		this._refreshHistory();
		this._refreshTemporal();
		this._refreshLegend();

		if (this._diag) {
			this._diag.textContent = [
				localize('prebase.maps.status', "Status: {0}", diag.status),
				diag.message || '',
				localize('prebase.maps.counts', "Files {0} · Nodes {1} · Edges {2}", diag.fileCount, diag.nodeCount, diag.edgeCount)
			].filter(Boolean).join('\n');
		}
	}

	private _refreshTemporal(): void {
		if (!this._temporalSection) return;
		const activeGraphType = this._getActiveGraphType();
		const isTemporal = activeGraphType === 'temporal';
		const hasProject = this._hasOpenProject();

		this._temporalSection.style.display = isTemporal && hasProject ? 'block' : 'none';
		if (!isTemporal || !hasProject) return;

		const state = this.temporalViewService.getState();
		const diff = state.diff;
		const summary = diff?.summary;

		// 1. Mode Buttons
		const isChanges = state.displayMode === 'changes';
		this._styleSegmentActive(this._temporalModeStateBtn, !isChanges);
		this._styleSegmentActive(this._temporalModeChangesBtn, isChanges);

		// 2. Ref Select
		if (this._temporalRefSelect) {
			DOM.clearNode(this._temporalRefSelect);
			const refs = state.repositoryRefs || [];
			const optHead = DOM.append(this._temporalRefSelect, DOM.$('option')) as HTMLOptionElement;
			optHead.value = 'HEAD';
			optHead.textContent = 'HEAD';
			optHead.selected = state.selectedRef === 'HEAD';

			for (const r of refs) {
				if (r.name === 'HEAD') continue;
				const opt = DOM.append(this._temporalRefSelect, DOM.$('option')) as HTMLOptionElement;
				opt.value = r.name;
				opt.textContent = `${r.kind === 'branch' ? '⑂ ' : '🏷 '}${r.name}`;
				opt.selected = state.selectedRef === r.name;
			}
		}

		// 3. Compare Select
		if (this._temporalCompareSelect) {
			DOM.clearNode(this._temporalCompareSelect);
			const curCommit = state.pagedTimeline?.find(c => c.sha === state.selectedCommitSha);
			const parents = curCommit?.parents || [];

			const optFirst = DOM.append(this._temporalCompareSelect, DOM.$('option')) as HTMLOptionElement;
			optFirst.value = '__first_parent__';
			const firstParentShort = parents[0] ? ` (${parents[0].slice(0, 7)})` : '';
			optFirst.textContent = `First Parent${firstParentShort}`;
			optFirst.selected = state.comparisonSelection?.mode === 'first-parent';

			if (parents.length > 1) {
				const optSecond = DOM.append(this._temporalCompareSelect, DOM.$('option')) as HTMLOptionElement;
				optSecond.value = parents[1];
				optSecond.textContent = `Merge Parent (${parents[1].slice(0, 7)})`;
				optSecond.selected = state.comparisonSelection?.mode === 'parent';
			}

			if (state.comparisonSelection?.mode === 'pinned' && state.comparisonSelection.baseSha) {
				const optPinned = DOM.append(this._temporalCompareSelect, DOM.$('option')) as HTMLOptionElement;
				optPinned.value = state.comparisonSelection.baseSha;
				optPinned.textContent = `Pinned · ${state.comparisonSelection.baseSha.slice(0, 7)}`;
				optPinned.selected = true;
			}
		}

		// 4. Follow HEAD Checkbox
		if (this._temporalFollowHeadCheckbox) {
			this._temporalFollowHeadCheckbox.checked = state.followHead;
		}

		// 5. Change Badges Summary
		if (this._temporalChangeBadgesWrap) {
			DOM.clearNode(this._temporalChangeBadgesWrap);
			const addBadge = (text: string, color: string, bg: string, title: string, queryFilter: string) => {
				const badge = DOM.append(this._temporalChangeBadgesWrap!, DOM.$('span'));
				badge.textContent = text;
				badge.title = title;
				badge.style.fontSize = '10.5px';
				badge.style.fontWeight = '600';
				badge.style.padding = '2px 6px';
				badge.style.borderRadius = '4px';
				badge.style.color = color;
				badge.style.background = bg;
				badge.style.cursor = 'pointer';
				this._register(DOM.addDisposableListener(badge, 'click', () => {
					const cur = this._temporalFilterInput?.value || '';
					const next = cur === queryFilter ? '' : queryFilter;
					if (this._temporalFilterInput) this._temporalFilterInput.value = next;
					this.temporalViewService.setFilterQuery(next);
				}));
			};

			const added = summary?.addedCount ?? 0;
			const removed = summary?.removedCount ?? 0;
			const modified = summary?.modifiedCount ?? 0;
			const renamed = summary?.renamedCount ?? 0;

			addBadge(`+${added}`, '#2ea043', 'rgba(46, 160, 67, 0.15)', 'Added nodes (click to filter)', 'added');
			addBadge(`-${removed}`, '#f85149', 'rgba(248, 81, 73, 0.15)', 'Removed nodes (click to filter)', 'removed');
			addBadge(`~${modified}`, '#d29922', 'rgba(210, 153, 34, 0.15)', 'Modified nodes (click to filter)', 'modified');
			addBadge(`⇄${renamed}`, '#1f6feb', 'rgba(31, 111, 235, 0.15)', 'Renamed nodes (click to filter)', 'renamed');
		}

		// 6. Truthful Status Badge
		if (this._temporalStatusBadge) {
			if (state.isLoadingSelection) {
				this._temporalStatusBadge.textContent = localize('prebase.maps.indexing', "Indexing…");
				this._temporalStatusBadge.style.color = 'var(--vscode-editorWarning-foreground, #d29922)';
				this._temporalStatusBadge.style.background = 'rgba(210, 153, 34, 0.15)';
			} else if (state.selectionError) {
				this._temporalStatusBadge.textContent = localize('prebase.maps.error', "Error");
				this._temporalStatusBadge.style.color = 'var(--vscode-errorForeground, #f85149)';
				this._temporalStatusBadge.style.background = 'rgba(248, 81, 73, 0.15)';
			} else if (state.isPartialLineage) {
				this._temporalStatusBadge.textContent = localize('prebase.maps.partialHistory', "Partial History");
				this._temporalStatusBadge.title = localize('prebase.maps.partialHistoryTitle', "Lineage coverage is partial; structural comparison is truthful.");
				this._temporalStatusBadge.style.color = 'var(--vscode-descriptionForeground, #a1a1aa)';
				this._temporalStatusBadge.style.background = 'rgba(161, 161, 170, 0.15)';
			} else {
				this._temporalStatusBadge.textContent = localize('prebase.maps.ready', "Ready");
				this._temporalStatusBadge.title = localize('prebase.maps.readyTitle', "Comparison fully indexed and reconciled");
				this._temporalStatusBadge.style.color = 'var(--vscode-gitDecoration-addedResourceForeground, #3fb950)';
				this._temporalStatusBadge.style.background = 'rgba(63, 185, 80, 0.15)';
			}
		}
	}

	private _refreshLegend(): void {
		if (!this._legendContainer) {
			return;
		}
		DOM.clearNode(this._legendContainer);

		const activeType = this._getActiveGraphType();
		const isTemporal = activeType === 'temporal';

		const title = DOM.append(this._legendContainer, DOM.$('div'));
		title.textContent = isTemporal
			? localize('prebase.maps.temporalLegendTitle', "Change Semantics")
			: localize('prebase.maps.networkLegendTitle', "Node Types");
		title.style.fontSize = '9.5px';
		title.style.fontWeight = '600';
		title.style.textTransform = 'uppercase';
		title.style.letterSpacing = '0.05em';
		title.style.color = MUTED;
		title.style.marginBottom = '4px';

		const itemsGrid = DOM.append(this._legendContainer, DOM.$('div'));
		itemsGrid.style.display = 'grid';
		itemsGrid.style.gridTemplateColumns = '1fr 1fr';
		itemsGrid.style.gap = '4px 8px';
		itemsGrid.style.fontSize = '10px';

		const legendItems = isTemporal
			? [
				{ label: localize('prebase.maps.added', "Added"), color: '#2ea043' },
				{ label: localize('prebase.maps.removed', "Removed"), color: '#f85149' },
				{ label: localize('prebase.maps.modified', "Modified"), color: '#d29922' },
				{ label: localize('prebase.maps.renamed', "Renamed"), color: '#1f6feb' },
				{ label: localize('prebase.maps.surviving', "Unchanged"), color: '#6e7681' },
			]
			: [
				{ label: localize('prebase.maps.components', "Components"), color: '#38bdf8' },
				{ label: localize('prebase.maps.files', "Files"), color: '#818cf8' },
				{ label: localize('prebase.maps.dependencies', "Dependencies"), color: '#fb923c' },
				{ label: localize('prebase.maps.other', "Other"), color: '#94a3b8' },
			];

		for (const item of legendItems) {
			const row = DOM.append(itemsGrid, DOM.$('div'));
			row.style.display = 'flex';
			row.style.alignItems = 'center';
			row.style.gap = '5px';

			const dot = DOM.append(row, DOM.$('span'));
			dot.style.width = '7px';
			dot.style.height = '7px';
			dot.style.borderRadius = '50%';
			dot.style.background = item.color;
			dot.style.display = 'inline-block';
			dot.style.flexShrink = '0';

			const label = DOM.append(row, DOM.$('span'));
			label.textContent = item.label;
			label.style.color = TEXT;
			label.style.overflow = 'hidden';
			label.style.textOverflow = 'ellipsis';
			label.style.whiteSpace = 'nowrap';
		}
	}

	private _hasOpenProject(): boolean {
		return this.workspaceContextService.getWorkspace().folders.length > 0;
	}

	private _setModeEnabled(btn: HTMLButtonElement | undefined, enabled: boolean): void {
		if (!btn) {
			return;
		}
		btn.disabled = !enabled;
		btn.style.opacity = enabled ? '1' : '0.45';
		btn.style.cursor = enabled ? 'pointer' : 'not-allowed';
		btn.setAttribute('aria-disabled', enabled ? 'false' : 'true');
	}

	private _refreshLanguages(): void {
		if (!this._langSection) {
			return;
		}
		DOM.clearNode(this._langSection);
		const snapshot = this.graphService.getSnapshot();
		const stats = computeLanguageStats(snapshot?.nodes);
		if (!snapshot || stats.length === 0) {
			return;
		}

		const totalFiles = stats.reduce((s, x) => s + x.count, 0);
		if (totalFiles <= 0) {
			return;
		}

		this._sectionLabel(this._langSection, localize('prebase.maps.languages', "Languages"));
		const top = stats.slice(0, 8);
		const otherCount = stats.slice(8).reduce((s, x) => s + x.count, 0);
		const display = otherCount > 0
			? [...top, {
				id: 'other-group',
				name: 'Other',
				count: otherCount,
				percent: Math.round((otherCount / totalFiles) * 1000) / 10,
				color: '#52525b',
			}]
			: top;

		const meta = DOM.append(this._langSection, DOM.$('div'));
		meta.style.display = 'flex';
		meta.style.justifyContent = 'flex-end';
		meta.style.marginBottom = '4px';
		meta.style.fontSize = '9px';
		meta.style.color = MUTED;
		meta.textContent = localize('prebase.maps.langFiles', "{0} files", totalFiles);

		const bar = DOM.append(this._langSection, DOM.$('div'));
		bar.style.display = 'flex';
		bar.style.height = '10px';
		bar.style.borderRadius = '999px';
		bar.style.overflow = 'hidden';
		bar.style.background = `color-mix(in srgb, ${SURFACE} 80%, transparent)`;
		bar.style.border = `1px solid color-mix(in srgb, ${BORDER} 40%, transparent)`;
		for (const seg of display) {
			const slice = DOM.append(bar, DOM.$('div'));
			slice.style.width = `${Math.max(seg.percent, seg.count > 0 ? 2 : 0)}%`;
			slice.style.backgroundColor = seg.color;
			slice.title = `${seg.name}: ${seg.percent}% · ${seg.count}`;
		}

		const legend = DOM.append(this._langSection, DOM.$('div'));
		legend.style.display = 'flex';
		legend.style.flexWrap = 'wrap';
		legend.style.gap = '2px 10px';
		legend.style.marginTop = '6px';
		for (const seg of top.slice(0, 5)) {
			const item = DOM.append(legend, DOM.$('span'));
			item.style.fontSize = '9px';
			item.style.color = MUTED;
			const swatch = DOM.append(item, DOM.$('span'));
			swatch.style.display = 'inline-block';
			swatch.style.width = '6px';
			swatch.style.height = '6px';
			swatch.style.borderRadius = '50%';
			swatch.style.backgroundColor = seg.color;
			swatch.style.marginRight = '4px';
			swatch.style.verticalAlign = 'middle';
			DOM.append(item, DOM.$('span')).textContent = `${seg.name} ${seg.percent}%`;
		}
	}

	private _refreshExplorerList(): void {
		if (!this._explorerList) {
			return;
		}
		this._explorerDisposables.clear();
		DOM.clearNode(this._explorerList);
		const snapshot = this.graphService.getSnapshot();
		if (!snapshot) {
			const empty = DOM.append(this._explorerList, DOM.$('div'));
			empty.textContent = localize('prebase.maps.explorerEmpty', "Scan a workspace to browse files.");
			empty.style.fontSize = '11px';
			empty.style.color = MUTED;
			empty.style.padding = '8px';
			return;
		}

		const filter = this._getFilter();
		const query = this._searchQuery;
		const nodes = (snapshot.nodes ?? []).filter(n => {
			if (!n || n.kind === 'folder') {
				return false;
			}
			if (!n.path) {
				return false;
			}
			if (filter === 'files' && n.kind !== 'file') {
				return false;
			}
			if (filter === 'components' && n.kind !== 'component' && !n.meta?.isComponent) {
				return false;
			}
			if (filter === 'dependencies' && n.kind !== 'module' && n.kind !== 'service') {
				return false;
			}
			if (query) {
				const hay = `${n.label} ${n.path}`.toLowerCase();
				if (!hay.includes(query)) {
					return false;
				}
			}
			return true;
		});

		const mode = this._getExplorerViewMode();
		if (mode === 'flat') {
			nodes
				.slice()
				.sort((a, b) => (a.path || a.label).localeCompare(b.path || b.label))
				.forEach(node => this._appendFileRow(this._explorerList!, node, 0));
			if (nodes.length === 0) {
				this._appendEmptyExplorer();
			}
			return;
		}

		const tree = this._buildTree(nodes);
		if (tree.length === 0) {
			this._appendEmptyExplorer();
			return;
		}
		for (const entry of tree) {
			this._appendTreeEntry(this._explorerList!, entry, 0);
		}
	}

	private _appendEmptyExplorer(): void {
		const empty = DOM.append(this._explorerList!, DOM.$('div'));
		empty.textContent = localize('prebase.maps.explorerNoMatch', "No matching files.");
		empty.style.fontSize = '11px';
		empty.style.color = MUTED;
		empty.style.padding = '8px';
	}

	private _buildTree(nodes: GraphNode[]): ExplorerTreeNode[] {
		const root: ExplorerDirNode = { type: 'dir', name: '', fullPath: '', children: [] };
		const dirs = new Map<string, ExplorerDirNode>();
		dirs.set('', root);

		const ensureDir = (fullPath: string): ExplorerDirNode => {
			const existing = dirs.get(fullPath);
			if (existing) {
				return existing;
			}
			const parts = fullPath.split('/');
			const name = parts[parts.length - 1] || fullPath;
			const parentPath = parts.slice(0, -1).join('/');
			const parent = ensureDir(parentPath);
			const dir: ExplorerDirNode = { type: 'dir', name, fullPath, children: [] };
			parent.children.push(dir);
			dirs.set(fullPath, dir);
			return dir;
		};

		for (const node of nodes) {
			const rel = (node.path || node.label).replace(/\\/g, '/');
			const parts = rel.split('/');
			const fileName = parts.pop() || rel;
			const dirPath = parts.join('/');
			const parent = ensureDir(dirPath);
			parent.children.push({ type: 'file', name: fileName, node });
		}

		const sortChildren = (entries: ExplorerTreeNode[]) => {
			entries.sort((a, b) => {
				if (a.type !== b.type) {
					return a.type === 'dir' ? -1 : 1;
				}
				return a.name.localeCompare(b.name);
			});
			for (const e of entries) {
				if (e.type === 'dir') {
					sortChildren(e.children);
				}
			}
		};
		sortChildren(root.children);
		return root.children;
	}

	private _appendTreeEntry(parent: HTMLElement, entry: ExplorerTreeNode, depth: number): void {
		if (entry.type === 'file') {
			this._appendFileRow(parent, entry.node, depth);
			return;
		}
		const row = DOM.append(parent, DOM.$('button')) as HTMLButtonElement;
		row.type = 'button';
		const expanded = this._expandedDirs.has(entry.fullPath) || this._searchQuery.length > 0;
		row.textContent = `${expanded ? '▾' : '▸'} ${entry.name || '/'}`;
		row.style.display = 'block';
		row.style.width = '100%';
		row.style.textAlign = 'left';
		row.style.padding = `3px 6px 3px ${6 + depth * 12}px`;
		row.style.fontSize = '11px';
		row.style.color = TEXT;
		row.style.background = 'transparent';
		row.style.border = 'none';
		row.style.borderRadius = '4px';
		row.style.cursor = 'pointer';
		this._explorerDisposables.add(DOM.addDisposableListener(row, 'click', () => {
			if (this._expandedDirs.has(entry.fullPath)) {
				this._expandedDirs.delete(entry.fullPath);
			} else {
				this._expandedDirs.add(entry.fullPath);
			}
			this._refreshExplorerList();
		}));
		if (expanded) {
			for (const child of entry.children) {
				this._appendTreeEntry(parent, child, depth + 1);
			}
		}
	}

	private _appendFileRow(parent: HTMLElement, node: GraphNode, depth: number): void {
		const row = DOM.append(parent, DOM.$('button')) as HTMLButtonElement;
		row.type = 'button';
		const selected = this.graphService.getSelectedNodeId() === node.id;
		row.textContent = node.label || (node.path?.split(/[/\\]/).pop() ?? node.id);
		row.title = node.path || node.label;
		row.style.display = 'block';
		row.style.width = '100%';
		row.style.textAlign = 'left';
		row.style.padding = `3px 6px 3px ${6 + depth * 12}px`;
		row.style.fontSize = '11px';
		row.style.color = selected ? ACCENT : TEXT;
		row.style.fontWeight = selected ? '600' : '400';
		row.style.background = selected ? ACCENT_SOFT : 'transparent';
		row.style.border = 'none';
		row.style.borderRadius = '4px';
		row.style.cursor = 'pointer';
		row.style.overflow = 'hidden';
		row.style.textOverflow = 'ellipsis';
		row.style.whiteSpace = 'nowrap';
		this._explorerDisposables.add(DOM.addDisposableListener(row, 'click', () => {
			this.graphService.setSelectedNodeId(node.id);
			void this._openNode(node);
			this._refreshExplorerList();
		}));
	}

	private async _openNode(node: GraphNode): Promise<void> {
		const path = node.path;
		if (!path) {
			return;
		}
		const snapshot = this.graphService.getSnapshot();
		const folder = snapshot?.projectPath
			|| this.workspaceContextService.getWorkspace().folders[0]?.uri.fsPath;
		let uri: URI;
		if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) {
			uri = URI.file(path);
		} else if (folder) {
			uri = URI.joinPath(URI.file(folder), path);
		} else {
			uri = URI.file(path.replace(/^file:/, ''));
		}
		try {
			await this.editorService.openEditor({ resource: uri, options: { pinned: false } });
		} catch {
			// ignore missing files
		}
	}

	private _getFilter(): GraphFilterId {
		const v = this.configurationService.getValue<string>(PreBaseGraphConfigKeys.GraphFilter);
		const match = FILTERS.find(f => f.id === v);
		return match?.id ?? 'all';
	}

	private _getExplorerViewMode(): ExplorerViewMode {
		const v = this.configurationService.getValue<string>(PreBaseGraphConfigKeys.GraphExplorerViewMode);
		return v === 'flat' ? 'flat' : 'tree';
	}

	private _sectionLabel(parent: HTMLElement, text: string): HTMLElement {
		const label = DOM.append(parent, DOM.$('div'));
		label.textContent = text;
		label.style.fontSize = '10px';
		label.style.fontWeight = '600';
		label.style.letterSpacing = '0.06em';
		label.style.textTransform = 'uppercase';
		label.style.color = MUTED;
		label.style.marginBottom = '4px';
		label.style.paddingLeft = '2px';
		return label;
	}

	private _segmentTrack(row: HTMLElement): void {
		row.style.display = 'flex';
		row.style.gap = '2px';
		row.style.padding = '2px';
		row.style.background = SURFACE_OVERLAY;
		row.style.borderRadius = '8px';
		row.style.border = `1px solid ${BORDER}`;
	}

	private _segmentBtn(parent: HTMLElement, label: string, onClick: () => void): HTMLButtonElement {
		const btn = DOM.append(parent, DOM.$('button')) as HTMLButtonElement;
		btn.type = 'button';
		btn.textContent = label;
		btn.style.flex = '1';
		btn.style.padding = '5px 8px';
		btn.style.fontSize = '10px';
		btn.style.fontWeight = '500';
		btn.style.borderRadius = '6px';
		btn.style.cursor = 'pointer';
		btn.style.border = 'none';
		btn.style.background = 'transparent';
		btn.style.color = MUTED;
		this._register(DOM.addDisposableListener(btn, 'click', onClick));
		return btn;
	}

	private _chipBtn(parent: HTMLElement, label: string, onClick: () => void, block = false, center = false): HTMLButtonElement {
		const btn = DOM.append(parent, DOM.$('button')) as HTMLButtonElement;
		btn.type = 'button';
		btn.textContent = label;
		if (block) {
			btn.style.display = center ? 'flex' : 'block';
			btn.style.width = '100%';
			btn.style.boxSizing = 'border-box';
			if (center) {
				btn.style.alignItems = 'center';
				btn.style.justifyContent = 'center';
				btn.style.textAlign = 'center';
				btn.style.minHeight = '28px';
			} else {
				btn.style.textAlign = 'left';
			}
		}
		btn.style.padding = '5px 8px';
		btn.style.fontSize = '10px';
		btn.style.borderRadius = '6px';
		btn.style.cursor = 'pointer';
		btn.style.border = `1px solid ${BORDER}`;
		btn.style.background = SURFACE;
		btn.style.color = TEXT;
		this._register(DOM.addDisposableListener(btn, 'click', onClick));
		return btn;
	}

	private _styleSegmentActive(btn: HTMLButtonElement | undefined, active: boolean): void {
		if (!btn) {
			return;
		}
		if (active) {
			btn.style.background = ACCENT_SOFT;
			btn.style.color = ACCENT;
			btn.style.boxShadow = `0 0 0 1px ${ACCENT}55`;
		} else {
			btn.style.background = 'transparent';
			btn.style.color = MUTED;
			btn.style.boxShadow = 'none';
		}
	}

	private _styleChipActive(btn: HTMLButtonElement | undefined, active: boolean, block = false): void {
		if (!btn) {
			return;
		}
		if (active) {
			btn.style.background = ACCENT_SOFT;
			btn.style.borderColor = ACCENT;
			btn.style.color = ACCENT;
			btn.style.boxShadow = block ? `0 0 0 1px ${ACCENT}55` : 'none';
		} else {
			btn.style.background = SURFACE;
			btn.style.borderColor = BORDER;
			btn.style.color = TEXT;
			btn.style.boxShadow = 'none';
		}
	}
}
