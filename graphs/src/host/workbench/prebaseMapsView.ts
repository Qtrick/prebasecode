/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../../../base/browser/dom.js';
import { DisposableStore } from '../../../../../../base/common/lifecycle.js';
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
import { INotificationService } from '../../../../../../platform/notification/common/notification.js';
import { IThemeService } from '../../../../../../platform/theme/common/themeService.js';
import { IWorkspaceContextService } from '../../../../../../platform/workspace/common/workspace.js';
import { ViewPane } from '../../../../../browser/parts/views/viewPane.js';
import { IViewletViewOptions } from '../../../../../browser/parts/views/viewsViewlet.js';
import { IViewDescriptorService } from '../../../../../common/views.js';
import { IEditorService } from '../../../../../services/editor/common/editorService.js';
import { listCommunitySummaries, normalizeHiddenCommunityIds } from '../../core/analysis/communities.js';
import { computeLanguageStats } from '../../core/analysis/languageStats.js';
import type { GraphNode } from '../../common/types/graphTypes.js';
import { PreBaseGraphCommandIds } from '../../commands/graphCommandIds.js';
import { PreBaseGraphConfigKeys } from '../../common/configuration/graphConfigKeys.js';
import { isCodeGraphCanvas } from '../../common/types/graphProduct.js';
import { IPreBaseGraphService } from './prebaseGraphService.js';

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
const MUTED = '#94a3b8';
const SURFACE = '#1e293b';
const SURFACE_OVERLAY = '#0f172a';
const BORDER = '#334155';

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
	private _communitySection: HTMLElement | undefined;
	private _filterSection: HTMLElement | undefined;
	private _networkSection: HTMLElement | undefined;
	private _displaySection: HTMLElement | undefined;
	private _explorerList: HTMLElement | undefined;
	private _diag: HTMLElement | undefined;

	private _openCodeGraphBtn: HTMLButtonElement | undefined;
	private _graphModeHelper: HTMLElement | undefined;
	private _graphModeOpenBtn: HTMLButtonElement | undefined;
	private _searchInput: HTMLInputElement | undefined;
	private _idleRotateCheckbox: HTMLInputElement | undefined;
	private _legendCheckbox: HTMLInputElement | undefined;
	private _displayBody: HTMLElement | undefined;

	private readonly _filterButtons = new Map<GraphFilterId, HTMLButtonElement>();
	private readonly _networkLayoutButtons = new Map<string, HTMLButtonElement>();
	private readonly _explorerModeButtons = new Map<ExplorerViewMode, HTMLButtonElement>();
	private readonly _expandedDirs = new Set<string>(['src']);
	private readonly _explorerDisposables = this._register(new DisposableStore());
	private readonly _communityDisposables = this._register(new DisposableStore());

	private _searchQuery = '';
	/** First endpoint for Maps Find Path (cleared after a successful path or cancel). */
	private _pathFromId: string | undefined;

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
		@ICommandService private readonly commandService: ICommandService,
		@IEditorService private readonly editorService: IEditorService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@INotificationService private readonly notificationService: INotificationService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
		this._register(this.graphService.onDidChangeDiagnostics(() => this._refresh()));
		this._register(this.graphService.onDidChangeViewState(() => this._refresh()));
		this._register(this.graphService.onDidChangeSnapshot(() => this._refresh()));
		this._register(this.graphService.onDidChangeHiddenCommunities(() => {
			this._refreshCommunities();
			this._refreshExplorerList();
		}));
		this._register(this.workspaceContextService.onDidChangeWorkbenchState(() => this._refresh()));
		this._register(this.workspaceContextService.onDidChangeWorkspaceFolders(() => this._refresh()));
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (
				e.affectsConfiguration(PreBaseGraphConfigKeys.GraphNetworkIdleAutoRotate) ||
				e.affectsConfiguration(PreBaseGraphConfigKeys.GraphShowLegend) ||
				e.affectsConfiguration(PreBaseGraphConfigKeys.GraphFilter) ||
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
		// Architecture product chrome not rendered (sources preserved under graphs/src/preserved/architecture/).
		this._renderLanguages();
		this._renderSearch();
		this._renderAnalysis();
		this._renderCommunities();
		this._renderFilter();
		this._renderNetwork();
		this._renderDisplay();
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
		this._sectionLabel(section, localize('prebase.maps.codeGraph', "Code Graph"));
		const openBtn = DOM.append(section, DOM.$('button')) as HTMLButtonElement;
		openBtn.type = 'button';
		openBtn.textContent = localize('prebase.maps.openCodeGraph', "Open Code Graph");
		openBtn.style.marginTop = '4px';
		openBtn.style.padding = '6px 10px';
		openBtn.style.fontSize = '11px';
		openBtn.style.fontWeight = '600';
		openBtn.style.borderRadius = '6px';
		openBtn.style.cursor = 'pointer';
		openBtn.style.border = `1px solid ${ACCENT}66`;
		openBtn.style.background = ACCENT_SOFT;
		openBtn.style.color = ACCENT;
		openBtn.style.width = '100%';
		this._openCodeGraphBtn = openBtn;
		this._register(DOM.addDisposableListener(openBtn, 'click', () => {
			if (!this._hasOpenProject()) {
				return;
			}
			void this.commandService.executeCommand(PreBaseGraphCommandIds.open);
		}));

		this._graphModeHelper = DOM.append(section, DOM.$('p'));
		this._graphModeHelper.style.fontSize = '10px';
		this._graphModeHelper.style.color = MUTED;
		this._graphModeHelper.style.margin = '6px 2px 0';
		this._graphModeHelper.style.lineHeight = '1.4';
		this._graphModeHelper.textContent = localize(
			'prebase.maps.openProjectHint',
			"Open a project to generate the Code Graph visualization."
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
		this._searchInput.setAttribute('aria-label', localize('prebase.maps.searchFilesAria', "Search Code Graph files"));
		this._searchInput.style.width = '100%';
		this._searchInput.style.boxSizing = 'border-box';
		this._searchInput.style.padding = '6px 8px';
		this._searchInput.style.fontSize = '11px';
		this._searchInput.style.borderRadius = '6px';
		this._searchInput.style.border = `1px solid ${BORDER}`;
		this._searchInput.style.background = SURFACE_OVERLAY;
		this._searchInput.style.color = '#e2e8f0';
		this._register(DOM.addDisposableListener(this._searchInput, 'input', () => {
			this._searchQuery = this._searchInput?.value.trim().toLowerCase() ?? '';
			this._refreshExplorerList();
		}));
	}

	/** Analysis shortcuts — inspired by Graphify MIT concepts, PreBase reimplementation */
	private _renderAnalysis(): void {
		const section = DOM.append(this._scroll!, DOM.$('div'));
		this._sectionLabel(section, localize('prebase.maps.analysis', "Analysis"));
		const row = DOM.append(section, DOM.$('div'));
		row.style.display = 'flex';
		row.style.flexWrap = 'wrap';
		row.style.gap = '4px';

		const mk = (label: string, onClick: () => void) => {
			const btn = DOM.append(row, DOM.$('button')) as HTMLButtonElement;
			btn.type = 'button';
			btn.textContent = label;
			btn.setAttribute('aria-label', label);
			btn.style.padding = '4px 8px';
			btn.style.fontSize = '10px';
			btn.style.borderRadius = '6px';
			btn.style.cursor = 'pointer';
			btn.style.border = `1px solid ${BORDER}`;
			btn.style.background = SURFACE;
			btn.style.color = '#e2e8f0';
			this._register(DOM.addDisposableListener(btn, 'click', onClick));
			return btn;
		};

		mk(localize('prebase.maps.analysisImportant', "Important Nodes"), () => {
			void this.commandService.executeCommand(PreBaseGraphCommandIds.showImportantNodes);
		});
		mk(localize('prebase.maps.analysisBridge', "Bridge Nodes"), () => {
			void this.commandService.executeCommand(PreBaseGraphCommandIds.showBridgeNodes);
		});
		mk(localize('prebase.maps.analysisCommunities', "Communities"), () => {
			if (this._communitySection) {
				this._communitySection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
			}
			void this.commandService.executeCommand(PreBaseGraphCommandIds.showCommunities);
		});
		mk(localize('prebase.maps.analysisFindPath', "Find Path"), () => {
			this._runFindPath();
		});
		mk(localize('prebase.maps.analysisAffected', "Potentially Affected"), () => {
			const id = this.graphService.getSelectedNodeId();
			if (!id) {
				this.notificationService.info(localize('prebase.graph.noSelectedNode', "No graph node selected."));
				return;
			}
			const raw = this.graphService.getAffectedForMagnus(id, 30);
			if (!raw) {
				this.notificationService.info(localize('prebase.graph.noSelectedNode', "No graph node selected."));
				return;
			}
			try {
				const parsed = JSON.parse(raw) as { nodeIds?: string[]; truncated?: boolean; notice?: string };
				const count = parsed.nodeIds?.length ?? 0;
				this.notificationService.info(localize(
					'prebase.maps.affectedSummary',
					"Potentially affected: {0} reverse dependent(s){1}",
					count,
					parsed.truncated ? ' (truncated)' : ''
				));
			} catch {
				this.notificationService.info(localize('prebase.maps.affectedSummary', "Potentially affected: {0} reverse dependent(s){1}", 0, ''));
			}
		});
		mk(localize('prebase.maps.analysisExplain', "Explain Selection"), () => {
			const id = this.graphService.getSelectedNodeId();
			if (!id) {
				this.notificationService.info(localize('prebase.graph.noSelectedNode', "No graph node selected."));
				return;
			}
			const raw = this.graphService.explainNodeForMagnus(id);
			if (!raw) {
				this.notificationService.info(localize('prebase.graph.noSelectedNode', "No graph node selected."));
				return;
			}
			try {
				const parsed = JSON.parse(raw) as {
					label?: string;
					communityLabel?: string;
					degrees?: { degree?: number };
					confidence?: { EXTRACTED?: number; INFERRED?: number; AMBIGUOUS?: number; unknown?: number };
				};
				const conf = parsed.confidence;
				// Non-color text labels (not E/I/A abbreviations) for accessibility.
				const confBit = conf
					? localize(
						'prebase.maps.explainConfidenceNamed',
						"EXTRACTED {0} · INFERRED {1} · AMBIGUOUS {2} · unknown {3}",
						conf.EXTRACTED ?? 0,
						conf.INFERRED ?? 0,
						conf.AMBIGUOUS ?? 0,
						conf.unknown ?? 0
					)
					: '—';
				this.notificationService.info(localize(
					'prebase.maps.explainSummaryConfidence',
					"Explain: {0} · community {1} · degree {2} · confidence {3}",
					parsed.label || id,
					parsed.communityLabel || '—',
					parsed.degrees?.degree ?? 0,
					confBit
				));
			} catch {
				this.notificationService.info(localize('prebase.maps.explainSummaryConfidence', "Explain: {0} · community {1} · degree {2} · confidence {3}", id, '—', 0, '—'));
			}
		});
		mk(localize('prebase.maps.analysisCrossCommunity', "Cross-community"), () => {
			void this.commandService.executeCommand(PreBaseGraphCommandIds.showSurprisingConnections);
		});
	}

	/** Two-step Find Path: first click sets start from selection; second runs directed BFS with hop confidence. */
	private _runFindPath(): void {
		const selected = this.graphService.getSelectedNodeId();
		if (!selected) {
			this.notificationService.info(localize('prebase.graph.noSelectedNode', "No graph node selected."));
			return;
		}
		if (!this._pathFromId || this._pathFromId === selected) {
			this._pathFromId = selected;
			const label = this.graphService.getSnapshot()?.nodes.find(n => n.id === selected)?.label || selected;
			this.notificationService.info(localize(
				'prebase.maps.findPathStart',
				"Path start: {0}. Select a different node, then Find Path again.",
				label
			));
			return;
		}
		const fromId = this._pathFromId;
		this._pathFromId = undefined;
		const raw = this.graphService.findPathForMagnus(fromId, selected);
		if (!raw) {
			this.notificationService.info(localize('prebase.maps.findPathMissing', "Could not resolve both path endpoints in the Code Graph."));
			return;
		}
		try {
			const parsed = JSON.parse(raw) as {
				found?: boolean;
				budgetExceeded?: boolean;
				notice?: string;
				nodeIds?: string[];
				edges?: Array<{ from: string; to: string; kind: string; confidence?: string; sourceFile?: string; sourceLine?: number }>;
			};
			if (!parsed.found) {
				this.notificationService.info(
					parsed.budgetExceeded || parsed.notice
						? localize('prebase.maps.findPathBudget', "No path found (visit budget). {0}", parsed.notice || '')
						: localize('prebase.maps.findPathNone', "No directed import/dependency path between the selected nodes.")
				);
				return;
			}
			const hops = (parsed.edges ?? []).slice(0, 12).map((e, i) => {
				const evidence = e.sourceFile
					? `${e.sourceFile}${typeof e.sourceLine === 'number' ? `:${e.sourceLine}` : ''}`
					: '';
				return `${i + 1}. ${e.from} → ${e.to} (${e.kind}, ${e.confidence || 'unknown'}${evidence ? `; ${evidence}` : ''})`;
			});
			const via = (parsed.nodeIds ?? []).join(' → ');
			this.notificationService.info(localize(
				'prebase.maps.findPathResult',
				"Path ({0} hop(s)): {1}\n{2}",
				parsed.edges?.length ?? 0,
				via,
				hops.join('\n') || '(direct)'
			));
		} catch {
			this.notificationService.info(localize('prebase.maps.findPathNone', "No directed import/dependency path between the selected nodes."));
		}
	}

	private _renderCommunities(): void {
		this._communitySection = DOM.append(this._scroll!, DOM.$('div'));
		this._communitySection.style.display = 'none';
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
		this._sectionLabel(this._networkSection, localize('prebase.maps.layoutSection', "Layout"));
		const layoutCol = DOM.append(this._networkSection, DOM.$('div'));
		layoutCol.style.display = 'flex';
		layoutCol.style.flexDirection = 'column';
		layoutCol.style.gap = '2px';
		layoutCol.style.marginBottom = '8px';
		const modes: { id: string; label: string }[] = [
			{ id: 'community', label: localize('prebase.maps.net.community', "Community Force") },
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
		idleRow.style.color = '#cbd5e1';
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
			void this.commandService.executeCommand(PreBaseGraphCommandIds.resetView);
		});
		this._chipBtn(netActions, localize('prebase.maps.fitView', "Fit View"), () => {
			void this.commandService.executeCommand(PreBaseGraphCommandIds.fitView);
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
		legendRow.style.color = '#cbd5e1';
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

	private _renderExplorer(): void {
		const section = DOM.append(this._scroll!, DOM.$('div'));
		section.style.borderTop = `1px solid ${BORDER}99`;
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
		this._explorerList.style.border = `1px solid ${BORDER}66`;
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
			void this.commandService.executeCommand(PreBaseGraphCommandIds.rescanWorkspace);
		});
		this._chipBtn(actions, localize('prebase.maps.cancel', "Cancel"), () => {
			void this.commandService.executeCommand(PreBaseGraphCommandIds.cancelScan);
		});
		this._chipBtn(actions, localize('prebase.maps.diagnostics', "Diagnostics"), () => {
			void this.commandService.executeCommand(PreBaseGraphCommandIds.showDiagnostics);
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
		const state = this.graphService.getViewState();
		const diag = this.graphService.getDiagnostics();
		const isCodeCanvas = isCodeGraphCanvas(state.graphType);
		const hasProject = this._hasOpenProject();
		const scanStatus = diag.status;

		this._setModeEnabled(this._openCodeGraphBtn, hasProject);

		if (this._graphModeHelper) {
			if (!hasProject) {
				this._graphModeHelper.style.display = 'block';
				this._graphModeHelper.textContent = localize(
					'prebase.maps.openProjectHint',
					"Open a project to generate the Code Graph visualization."
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
		this._refreshCommunities();

		if (this._filterSection) {
			this._filterSection.style.display = hasProject ? 'block' : 'none';
		}
		const filter = this._getFilter();
		for (const [id, btn] of this._filterButtons) {
			this._styleChipActive(btn, id === filter);
		}

		if (this._networkSection) {
			this._networkSection.style.display = isCodeCanvas && hasProject ? 'block' : 'none';
		}
		if (this._displaySection) {
			this._displaySection.style.display = hasProject ? 'block' : 'none';
		}

		if (this._idleRotateCheckbox) {
			this._idleRotateCheckbox.checked = !!this.configurationService.getValue<boolean>(PreBaseGraphConfigKeys.GraphNetworkIdleAutoRotate);
		}
		if (this._legendCheckbox) {
			this._legendCheckbox.checked = this.configurationService.getValue<boolean>(PreBaseGraphConfigKeys.GraphShowLegend) !== false;
		}

		const networkLayout = this.configurationService.getValue<string>(PreBaseGraphConfigKeys.GraphNetworkLayoutMode) || 'community';
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

		if (this._diag) {
			const snapshot = this.graphService.getSnapshot();
			const communityCount = snapshot
				? new Set(
					snapshot.nodes
						.map(n => n.meta?.communityId)
						.filter((id): id is number => typeof id === 'number')
				).size
				: 0;
			this._diag.textContent = [
				localize('prebase.maps.status', "Status: {0}", diag.status),
				diag.message || '',
				localize('prebase.maps.counts', "Files {0} · Nodes {1} · Edges {2}", diag.fileCount, diag.nodeCount, diag.edgeCount),
				communityCount > 0
					? localize('prebase.maps.communities', "Communities {0}", communityCount)
					: ''
			].filter(Boolean).join('\n');
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
		bar.style.background = `${SURFACE}cc`;
		bar.style.border = `1px solid ${BORDER}66`;
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

	private _hiddenCommunitySet(): Set<number> {
		return new Set(this.graphService.getHiddenCommunityIds());
	}

	private _setHiddenCommunityIds(ids: Iterable<number>): void {
		this.graphService.setHiddenCommunityIds(normalizeHiddenCommunityIds([...ids]));
	}

	private _refreshCommunities(): void {
		if (!this._communitySection) {
			return;
		}
		this._communityDisposables.clear();
		DOM.clearNode(this._communitySection);
		const snapshot = this.graphService.getSnapshot();
		const summaries = listCommunitySummaries(snapshot?.nodes ?? []);
		const known = new Set(summaries.map(s => s.id));
		let hidden = this._hiddenCommunitySet();
		if ([...hidden].some(id => !known.has(id))) {
			hidden = new Set([...hidden].filter(id => known.has(id)));
			this._setHiddenCommunityIds(hidden);
		}
		if (summaries.length === 0 || !this._hasOpenProject()) {
			this._communitySection.style.display = 'none';
			return;
		}
		this._communitySection.style.display = 'block';

		const header = DOM.append(this._communitySection, DOM.$('div'));
		header.style.display = 'flex';
		header.style.alignItems = 'center';
		header.style.gap = '6px';
		header.style.marginBottom = '4px';

		const allCb = DOM.append(header, DOM.$('input')) as HTMLInputElement;
		allCb.type = 'checkbox';
		allCb.style.accentColor = ACCENT;
		allCb.title = localize('prebase.maps.communitiesSelectAll', "Show all communities on canvas and explorer");
		allCb.setAttribute('aria-label', localize('prebase.maps.communitiesSelectAllAria', "Show all communities on canvas and explorer"));
		const syncSelectAll = () => {
			const hiddenNow = this._hiddenCommunitySet();
			const hiddenCount = summaries.filter(s => hiddenNow.has(s.id)).length;
			allCb.checked = hiddenCount === 0;
			allCb.indeterminate = hiddenCount > 0 && hiddenCount < summaries.length;
		};
		syncSelectAll();
		const rowCheckboxes: HTMLInputElement[] = [];
		this._communityDisposables.add(DOM.addDisposableListener(allCb, 'change', () => {
			if (allCb.checked) {
				this._setHiddenCommunityIds([]);
			} else {
				this._setHiddenCommunityIds(summaries.map(s => s.id));
			}
			const hiddenNow = this._hiddenCommunitySet();
			for (let i = 0; i < rowCheckboxes.length; i++) {
				rowCheckboxes[i]!.checked = !hiddenNow.has(summaries[i]!.id);
			}
			syncSelectAll();
			this._refreshExplorerList();
		}));

		const title = DOM.append(header, DOM.$('span'));
		title.textContent = localize('prebase.maps.communitiesSection', "Communities");
		title.style.fontSize = '10px';
		title.style.fontWeight = '600';
		title.style.letterSpacing = '0.06em';
		title.style.textTransform = 'uppercase';
		title.style.color = MUTED;

		const hint = DOM.append(this._communitySection, DOM.$('div'));
		hint.textContent = localize('prebase.maps.communitiesCanvasFilter', "Unchecked communities are hidden on the Code Graph canvas and in the explorer.");
		hint.style.fontSize = '10px';
		hint.style.color = MUTED;
		hint.style.marginBottom = '6px';
		hint.style.lineHeight = '1.3';

		const list = DOM.append(this._communitySection, DOM.$('div'));
		list.style.maxHeight = '140px';
		list.style.overflowY = 'auto';
		list.style.display = 'flex';
		list.style.flexDirection = 'column';
		list.style.gap = '2px';
		list.setAttribute('role', 'group');
		list.setAttribute('aria-label', localize('prebase.maps.communitiesListAria', "Code Graph communities"));

		for (const summary of summaries) {
			const row = DOM.append(list, DOM.$('div'));
			row.style.display = 'flex';
			row.style.alignItems = 'center';
			row.style.gap = '6px';
			row.style.padding = '2px 4px';
			row.style.borderRadius = '4px';

			const swatch = DOM.append(row, DOM.$('span'));
			swatch.style.display = 'inline-block';
			swatch.style.width = '8px';
			swatch.style.height = '8px';
			swatch.style.borderRadius = '2px';
			swatch.style.flexShrink = '0';
			swatch.style.backgroundColor = this._communityColor(summary.id);
			swatch.setAttribute('aria-hidden', 'true');

			const cb = DOM.append(row, DOM.$('input')) as HTMLInputElement;
			cb.type = 'checkbox';
			cb.style.accentColor = ACCENT;
			cb.checked = !hidden.has(summary.id);
			cb.title = localize('prebase.maps.communityToggle', "Show on canvas and explorer");
			cb.setAttribute('aria-label', localize('prebase.maps.communityToggleAria', "Show community {0} on canvas and explorer", summary.label));
			rowCheckboxes.push(cb);
			this._communityDisposables.add(DOM.addDisposableListener(cb, 'change', () => {
				const next = this._hiddenCommunitySet();
				if (cb.checked) {
					next.delete(summary.id);
				} else {
					next.add(summary.id);
				}
				this._setHiddenCommunityIds(next);
				// ponytail: sync select-all in place — full rebuild steals checkbox focus.
				syncSelectAll();
				this._refreshExplorerList();
			}));

			const labelBtn = DOM.append(row, DOM.$('button')) as HTMLButtonElement;
			labelBtn.type = 'button';
			labelBtn.textContent = summary.label;
			labelBtn.title = localize('prebase.maps.communityFocus', "Focus community hub on Code Graph");
			labelBtn.setAttribute('aria-label', localize('prebase.maps.communityFocusAria', "Focus community {0} on Code Graph", summary.label));
			labelBtn.style.all = 'unset';
			labelBtn.style.flex = '1';
			labelBtn.style.minWidth = '0';
			labelBtn.style.fontSize = '11px';
			labelBtn.style.color = '#e2e8f0';
			labelBtn.style.cursor = 'pointer';
			labelBtn.style.overflow = 'hidden';
			labelBtn.style.textOverflow = 'ellipsis';
			labelBtn.style.whiteSpace = 'nowrap';
			this._communityDisposables.add(DOM.addDisposableListener(labelBtn, 'click', () => {
				void this._focusCommunity(summary.id);
			}));

			const count = DOM.append(row, DOM.$('span'));
			count.textContent = String(summary.count);
			count.style.fontSize = '10px';
			count.style.color = MUTED;
			count.style.flexShrink = '0';
			count.setAttribute('aria-label', localize('prebase.maps.communityCountAria', "{0} nodes", summary.count));
		}
	}

	private _communityColor(id: number): string {
		const hue = (Math.abs(id) * 47) % 360;
		return `hsl(${hue} 62% 52%)`;
	}

	private async _focusCommunity(communityId: number): Promise<void> {
		const hidden = this._hiddenCommunitySet();
		if (hidden.has(communityId)) {
			hidden.delete(communityId);
			this._setHiddenCommunityIds(hidden);
			this._refreshCommunities();
		}
		const nodes = this.graphService.getSnapshot()?.nodes ?? [];
		const members = nodes.filter(n => n.meta?.communityId === communityId);
		if (members.length === 0) {
			return;
		}
		members.sort((a, b) => {
			const degA = a.meta?.degree ?? 0;
			const degB = b.meta?.degree ?? 0;
			if (degB !== degA) {
				return degB - degA;
			}
			return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
		});
		const hub = members[0]!;
		if (this._hasOpenProject()) {
			await this.commandService.executeCommand(PreBaseGraphCommandIds.open);
		}
		this.graphService.setSelectedNodeId(hub.id);
		this.graphService.requestFitView();
		this._refreshExplorerList();
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
			const communityId = n.meta?.communityId;
			if (typeof communityId === 'number' && this._hiddenCommunitySet().has(communityId)) {
				return false;
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
		row.style.color = '#cbd5e1';
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
		row.style.color = selected ? ACCENT : '#e2e8f0';
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
		btn.style.color = '#e2e8f0';
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
			btn.style.color = '#e2e8f0';
			btn.style.boxShadow = 'none';
		}
	}
}
