/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { RunOnceScheduler } from '../../../../base/common/async.js';
import { Event } from '../../../../base/common/event.js';
import { isMacintosh, isWeb } from '../../../../base/common/platform.js';
import { ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INativeHostService } from '../../../../platform/native/common/native.js';
import { FocusMode } from '../../../../platform/native/common/native.js';
import { IAccessibilityService } from '../../../../platform/accessibility/common/accessibility.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { localize2 } from '../../../../nls.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IChatService, IChatToolInvocation } from '../../chat/common/chatService/chatService.js';
import type { IChatModel, IChatRequestModel } from '../../chat/common/model/chatModel.js';
import { IWorkbenchEnvironmentService } from '../../../services/environment/common/environmentService.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { requireSmokeTestDriver } from '../common/smokeTestGuard.js';
import { ITerminalChatService, ITerminalService } from '../../terminal/browser/terminal.js';
import { ILanguageModelToolsService } from '../../chat/common/tools/languageModelToolsService.js';
import { AskQuestionsToolId } from '../../chat/common/tools/builtinTools/askQuestionsTool.js';
import { IChatToolRiskAssessmentService, ToolRiskLevel } from '../../chat/browser/tools/chatToolRiskAssessmentService.js';
import {
	MAGNUS_LIVE_ACTIVITY_CHANNEL,
	type IMagnusLiveActivityMainService,
} from '../../../../platform/prebaseLiveActivity/common/prebaseLiveActivity.js';
import {
	acceptLiveActivityCommand,
	buildMagnusLiveActivitySnapshot,
	calculateNextElapsedBoundaryDelayMs,
	deriveMagnusTestStateFromInvocations,
	isMagnusParticipantId,
	LIVE_ACTIVITY_COMPLETED_HOLD_MS,
	redactLiveActivityText,
	selectPrimaryMagnusSession,
	canonicalizeLiveActivityPanelState,
	resolveLiveActivityPanelState,
	shouldShowLiveActivity,
	summarizeMagnusWorkspaceDiff,
	type LiveActivityCommand,
	type MagnusLiveActivityAction,
	type MagnusLiveActivityMode,
	type MagnusLiveActivityDisplay,
	type MagnusLiveActivitySessionInput,
	type MagnusLiveActivitySnapshot,
} from '../../../../platform/prebaseLiveActivity/common/magnusLiveActivity.js';
import { applyMagnusLiveActivitySessionCommand, extractPendingFromModel } from './magnusLiveActivitySession.js';

function asPlainText(value: unknown): string {
	if (!value) {
		return '';
	}
	if (typeof value === 'string') {
		return value;
	}
	if (typeof value === 'object' && value !== null && 'value' in value && typeof (value as { value: unknown }).value === 'string') {
		return (value as { value: string }).value;
	}
	return String(value);
}

function isMagnusModel(model: IChatModel): boolean {
	const requests = model.getRequests();
	for (let i = requests.length - 1; i >= 0; i--) {
		const agentId = requests[i].response?.agent?.id;
		if (isMagnusParticipantId(agentId)) {
			return true;
		}
	}
	return false;
}

function selectPrimaryMagnusModel(models: Iterable<IChatModel>): IChatModel | undefined {
	const sessions: { model: IChatModel; isMagnus: boolean; isBusy: boolean; lastMessageDate: number }[] = [];
	for (const model of models) {
		sessions.push({
			model,
			isMagnus: isMagnusModel(model),
			isBusy: model.requestInProgress.get() || model.hasActiveRequest.get() || Boolean(model.requestNeedsInput.get()),
			lastMessageDate: model.lastMessageDate,
		});
	}
	return selectPrimaryMagnusSession(sessions)?.model;
}

function toolInvocationState(invocation: IChatToolInvocation): 'running' | 'passed' | 'failed' | 'other' {
	const state = invocation.state.get();
	if (state.type === IChatToolInvocation.StateKind.Executing || state.type === IChatToolInvocation.StateKind.Streaming) {
		return 'running';
	}
	if (state.type === IChatToolInvocation.StateKind.Cancelled) {
		return 'failed';
	}
	if (state.type === IChatToolInvocation.StateKind.Completed) {
		const details = state.resultDetails;
		if (details && typeof details === 'object' && 'isError' in details && (details as { isError?: boolean }).isError) {
			return 'failed';
		}
		return 'passed';
	}
	return 'other';
}

function extractActions(request: IChatRequestModel | undefined): MagnusLiveActivityAction[] {
	const parts = request?.response?.entireResponse.value ?? [];
	const actions: MagnusLiveActivityAction[] = [];
	for (const part of parts) {
		if (part.kind === 'toolInvocation') {
			const invocation = part as IChatToolInvocation;
			const label = asPlainText(invocation.pastTenseMessage) || asPlainText(invocation.invocationMessage);
			if (label) {
				actions.push({ id: invocation.toolCallId, label: redactLiveActivityText(label), at: Date.now() });
			}
		}
	}
	return actions.slice(-4);
}

function extractCurrentActivity(request: IChatRequestModel | undefined): string | undefined {
	const parts = request?.response?.entireResponse.value ?? [];
	for (let i = parts.length - 1; i >= 0; i--) {
		const part = parts[i];
		if (part.kind === 'toolInvocation') {
			const invocation = part as IChatToolInvocation;
			const state = invocation.state.get();
			if (state.type === IChatToolInvocation.StateKind.Executing || state.type === IChatToolInvocation.StateKind.Streaming) {
				return redactLiveActivityText(asPlainText(invocation.invocationMessage));
			}
		}
		if (part.kind === 'progressMessage') {
			return redactLiveActivityText(asPlainText((part as { content?: unknown }).content));
		}
	}
	return undefined;
}

function collectEditedFileUris(model: IChatModel): string[] {
	const files = new Set<string>();
	for (const request of model.getRequests()) {
		for (const event of request.editedFileEvents ?? []) {
			if (event.uri) {
				files.add(String(event.uri));
			}
		}
	}
	return [...files];
}

function editingSessionLineStats(model: IChatModel): { fileCount: number; additions: number; deletions: number } | undefined {
	const session = model.editingSession;
	if (!session) {
		return undefined;
	}
	const sessionDiff = session.getDiffForSession().get();
	const entries = session.entries.get();
	let additions = 0;
	let deletions = 0;
	const uris = new Set<string>();
	for (const entry of entries) {
		uris.add(String(entry.modifiedURI));
		additions += entry.linesAdded?.get() ?? 0;
		deletions += entry.linesRemoved?.get() ?? 0;
	}
	if (sessionDiff && (sessionDiff.added > 0 || sessionDiff.removed > 0)) {
		additions = sessionDiff.added;
		deletions = sessionDiff.removed;
	}
	if (uris.size === 0 && additions === 0 && deletions === 0) {
		return undefined;
	}
	return { fileCount: uris.size, additions, deletions };
}

function collectToolInvocations(model: IChatModel): { toolId: string; state: 'running' | 'passed' | 'failed' | 'other' }[] {
	const out: { toolId: string; state: 'running' | 'passed' | 'failed' | 'other' }[] = [];
	for (const request of model.getRequests()) {
		for (const part of request.response?.entireResponse.value ?? []) {
			if (part.kind === 'toolInvocation') {
				const invocation = part as IChatToolInvocation;
				out.push({ toolId: invocation.toolId, state: toolInvocationState(invocation) });
			}
		}
	}
	return out;
}

function countSessionTerminals(terminalChat: ITerminalChatService | undefined, sessionResource: URI): number | undefined {
	if (!terminalChat) {
		return undefined;
	}
	const target = sessionResource.toString();
	let count = 0;
	for (const instance of terminalChat.getToolSessionTerminalInstances()) {
		const resource = terminalChat.getChatSessionResourceForInstance(instance);
		if (resource?.toString() === target) {
			count++;
		}
	}
	return count > 0 ? count : undefined;
}

function extractSessionInput(
	model: IChatModel | undefined,
	deps: {
		terminalChat?: ITerminalChatService;
		risk?: { isDestructive(toolId: string, parameters: unknown): boolean };
	} = {},
): MagnusLiveActivitySessionInput | undefined {
	if (!model) {
		return undefined;
	}
	const last = model.lastRequest;
	const pending = extractPendingFromModel(model, deps.risk);
	const failed = last?.response?.isCanceled === false && last?.response?.isComplete && Boolean(last.response.result?.errorDetails);
	const completed = Boolean(last?.response?.isComplete && !last.response.isCanceled && !failed && !model.requestInProgress.get());
	const editedUris = collectEditedFileUris(model);
	const lineStats = editingSessionLineStats(model);
	const workspaceDiff = summarizeMagnusWorkspaceDiff({
		editedFileUris: editedUris,
		sessionFileCount: lineStats?.fileCount,
		additions: lineStats?.additions,
		deletions: lineStats?.deletions,
	});
	const testState = deriveMagnusTestStateFromInvocations(collectToolInvocations(model));
	const terminalCount = countSessionTerminals(deps.terminalChat, model.sessionResource);
	return {
		sessionId: model.sessionId,
		sessionResource: model.sessionResource.toString(),
		startedAt: model.timestamp,
		title: model.title,
		isInProgress: model.requestInProgress.get() || model.hasActiveRequest.get(),
		needsInput: Boolean(model.requestNeedsInput.get() || pending),
		currentActivity: extractCurrentActivity(last),
		recentActions: extractActions(last),
		latestShortMessage: redactLiveActivityText(last?.response?.entireResponse.getFinalResponse?.() || last?.message.text),
		completed,
		failed: Boolean(failed || last?.response?.isCanceled),
		pendingInteraction: pending,
		workspaceDiff,
		terminalCount,
		testState,
	};
}

export class MagnusLiveActivityContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.prebase.magnusLiveActivity';
	static instance: MagnusLiveActivityContribution | undefined;
	static diagnostics: {
		backend: 'native-appkit' | 'unavailable' | 'non-mac';
		revision: number;
		sessionId?: string;
		sessionResource?: string;
		status?: string;
		visible?: boolean;
		pendingKind?: string;
		workspaceDiff?: MagnusLiveActivitySnapshot['workspaceDiff'];
		terminalCount?: number;
		testState?: MagnusLiveActivitySnapshot['testState'];
		presentationLabel?: string;
		panelState?: string;
		/** Honest provenance: renderer projection never claims native hover/peek fidelity. */
		panelStateSource?: 'renderer-projection';
		screenLocked?: boolean;
	} = { backend: isMacintosh && !isWeb ? 'unavailable' : 'non-mac', revision: 0 };

	private readonly _main: IMagnusLiveActivityMainService | undefined;
	private _revision = 0;
	private _pinned = false;
	private _screenLocked = false;
	private _nativeConnected = false;
	private _completionHoldUntil: number | undefined;
	private _completionHidden = false;
	private _lastSnapshot: MagnusLiveActivitySnapshot | undefined;
	private readonly _modelListeners = this._register(new DisposableStore());
	private readonly _push: RunOnceScheduler;
	private readonly _completionTimer: RunOnceScheduler;
	private readonly _elapsedTimer: RunOnceScheduler;

	constructor(
		@IChatService private readonly chatService: IChatService,
		@IHostService private readonly hostService: IHostService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ILogService private readonly logService: ILogService,
		@ICommandService private readonly commandService: ICommandService,

		@IMainProcessService mainProcessService: IMainProcessService,
		@IAccessibilityService private readonly accessibilityService: IAccessibilityService,
		@INativeHostService private readonly nativeHostService: INativeHostService,
		@ITerminalChatService private readonly terminalChatService: ITerminalChatService,
		@ITerminalService private readonly terminalService: ITerminalService,
		@ILanguageModelToolsService private readonly toolsService: ILanguageModelToolsService,
		@IChatToolRiskAssessmentService private readonly riskAssessmentService: IChatToolRiskAssessmentService,
	) {
		super();
		this._push = this._register(new RunOnceScheduler(() => this._publish(), 120));
		this._completionTimer = this._register(new RunOnceScheduler(() => this._publish(), LIVE_ACTIVITY_COMPLETED_HOLD_MS));
		this._elapsedTimer = this._register(new RunOnceScheduler(() => this._publish(), 5_000));
		if (isWeb || !isMacintosh) {
			return;
		}
		try {
			this._main = ProxyChannel.toService<IMagnusLiveActivityMainService>(mainProcessService.getChannel(MAGNUS_LIVE_ACTIVITY_CHANNEL));
		} catch (err) {
			this.logService.warn('[MagnusLiveActivity] main channel unavailable', err);
			return;
		}

		this._register(this.chatService.onDidCreateModel(() => this._bindModels()));
		this._register(this.chatService.onDidDisposeSession(() => this._bindModels()));
		this._register(this.hostService.onDidChangeFocus(() => this._push.schedule()));
		// Register + dispose/change: tool-session terminals drop out of the map on dispose without a dedicated chat event.
		this._register(Event.any(
			this.terminalChatService.onDidRegisterTerminalInstanceWithToolSession,
			this.terminalService.onDidDisposeInstance,
			this.terminalService.onDidChangeInstances,
		)(() => this._push.schedule()));
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('prebase.magnus.liveActivity')) {
				this._push.schedule();
			}
		}));
		if (this.nativeHostService) {
			this._register(this.nativeHostService.onDidLockScreen(() => {
				this._screenLocked = true;
				this._push.schedule();
			}));
			this._register(this.nativeHostService.onDidUnlockScreen(() => {
				this._screenLocked = false;
				this._push.schedule();
			}));
		}
		this._register(this._main.onDidCommand(command => void this._handleCommand(command)));
		void this._main.getNativeBackend().then(backend => {
			this._nativeConnected = backend === 'native-appkit';
			MagnusLiveActivityContribution.diagnostics.backend = this._nativeConnected ? 'native-appkit' : 'unavailable';
			this._push.schedule();
		});
		MagnusLiveActivityContribution.instance = this;
		this._bindModels();
		this._push.schedule();
	}

	async getNativeDiagnostics(): Promise<Record<string, unknown> | undefined> {
		return this._main?.getNativeDiagnostics();
	}

	async simulateAction(action: string, extras?: unknown): Promise<boolean> {
		return (await this._main?.simulateAction(action, extras)) ?? false;
	}

	flushSnapshotForSmoke(): void {
		this._publish();
	}

	private _isDestructive(toolId: string, parameters: unknown): boolean {
		const tool = this.toolsService.getTool(toolId);
		if (!tool) {
			return false;
		}
		const cached = this.riskAssessmentService.getCached(tool, parameters);
		return cached?.risk === ToolRiskLevel.Red;
	}

	private _bindModels(): void {
		this._modelListeners.clear();
		for (const model of this.chatService.chatModels.get()) {
			this._modelListeners.add(model.onDidChange(() => this._push.schedule()));
		}
		this._push.schedule();
	}

	private _mode(): MagnusLiveActivityMode {
		const value = this.configurationService.getValue<string>('prebase.magnus.liveActivity.mode');
		if (value === 'alwaysWorking' || value === 'attentionOnly' || value === 'off' || value === 'background') {
			return value;
		}
		return 'background';
	}

	private _display(): MagnusLiveActivityDisplay {
		return this.configurationService.getValue<string>('prebase.magnus.liveActivity.display') === 'active' ? 'active' : 'builtin';
	}

	private _publish(): void {
		if (!this._main) {
			return;
		}
		const model = selectPrimaryMagnusModel(this.chatService.chatModels.get());
		this._revision += 1;
		const userHideDetails = Boolean(this.configurationService.getValue<boolean>('prebase.magnus.liveActivity.hideDetails'));
		const snapshot = buildMagnusLiveActivitySnapshot(extractSessionInput(model, {
			terminalChat: this.terminalChatService,
			risk: { isDestructive: (toolId, parameters) => this._isDestructive(toolId, parameters) },
		}), {
			revision: this._revision,
			prebaseForeground: this.hostService.hasFocus,
			connected: this._nativeConnected,
			screenLocked: this._screenLocked,
			hideDetails: userHideDetails,
		});
		const prevStatus = this._lastSnapshot?.status;
		this._lastSnapshot = snapshot;
		const terminalStatus = snapshot.status === 'completed' || snapshot.status === 'failed';
		if (terminalStatus && prevStatus !== snapshot.status) {
			this._completionHoldUntil = Date.now() + LIVE_ACTIVITY_COMPLETED_HOLD_MS;
			this._completionHidden = false;
			this._completionTimer.schedule(LIVE_ACTIVITY_COMPLETED_HOLD_MS + 25);
		} else if (!terminalStatus) {
			this._completionHoldUntil = undefined;
			this._completionHidden = false;
			this._completionTimer.cancel();
		} else if (this._completionHoldUntil !== undefined && Date.now() >= this._completionHoldUntil && !this._pinned) {
			this._completionHidden = true;
		}
		const visible = !this._completionHidden && shouldShowLiveActivity(this._mode(), snapshot);
		// Renderer panelState is a projection from pin + snapshot only.
		// Native hover/peek/attentionCompact truth lives in native diagnostics.activePresentationState.
		const panelState = canonicalizeLiveActivityPanelState(resolveLiveActivityPanelState({
			visible,
			hovering: false,
			pinned: this._pinned && visible,
			snapshot,
			now: Date.now(),
		}));
		if (visible && (snapshot.status === 'working' || snapshot.status === 'waiting' || snapshot.status === 'attention')) {
			const delay = calculateNextElapsedBoundaryDelayMs(Date.now(), snapshot.startedAt);
			if (delay !== undefined) {
				this._elapsedTimer.schedule(delay);
			} else {
				this._elapsedTimer.cancel();
			}
		} else {
			this._elapsedTimer.cancel();
		}
		MagnusLiveActivityContribution.diagnostics = {
			backend: !isMacintosh || isWeb ? 'non-mac' : (this._nativeConnected ? 'native-appkit' : 'unavailable'),
			revision: snapshot.revision,
			sessionId: snapshot.sessionId,
			sessionResource: snapshot.sessionResource,
			status: snapshot.status,
			visible,
			pendingKind: snapshot.pendingInteraction?.kind,
			workspaceDiff: snapshot.workspaceDiff,
			terminalCount: snapshot.terminalCount,
			testState: snapshot.testState,
			presentationLabel: snapshot.presentationLabel,
			panelState,
			panelStateSource: 'renderer-projection',
			screenLocked: Boolean(snapshot.screenLocked),
		};
		const reducedMotion = this.accessibilityService.isMotionReduced()
			|| Boolean(this.configurationService.getValue<boolean>('prebase.graph.reduceMotion'));
		void this._main.setSnapshot(snapshot);
		void this._main.setPresentation({
			visible,
			pinned: this._pinned && visible,
			reducedMotion,
			display: this._display(),
		});
	}

	private async _handleCommand(command: LiveActivityCommand): Promise<void> {
		const snapshot = this._lastSnapshot;
		if (!snapshot) {
			return;
		}
		const accepted = acceptLiveActivityCommand(snapshot, command);
		if (!accepted.ok) {
			this.logService.info(`[MagnusLiveActivity] command rejected: ${accepted.reason}`);
			return;
		}
		if (command.kind === 'pin') {
			this._pinned = true;
			this._completionHidden = false;
			this._completionTimer.cancel();
			this._push.schedule();
			return;
		}
		if (command.kind === 'unpin') {
			this._pinned = false;
			if (this._completionHoldUntil !== undefined) {
				const remaining = this._completionHoldUntil - Date.now();
				if (remaining > 0) {
					this._completionTimer.schedule(remaining + 25);
				} else {
					this._completionHidden = true;
				}
			}
			this._push.schedule();
			return;
		}
		if (command.kind === 'openInPrebase') {
			this._pinned = false;
			await this.hostService.focus(mainWindow, { mode: FocusMode.Force });
			await this.commandService.executeCommand('prebase.magnus.open');
			this._push.schedule();
			return;
		}
		await applyMagnusLiveActivitySessionCommand(snapshot, command, {
			chatService: this.chatService,
			logService: this.logService,
			onInteractionApplied: () => this._push.schedule(),
		});
	}

	override dispose(): void {
		if (MagnusLiveActivityContribution.instance === this) {
			MagnusLiveActivityContribution.instance = undefined;
		}
		this._nativeConnected = false;
		void this._main?.disposeNative();
		super.dispose();
	}
}

registerWorkbenchContribution2(MagnusLiveActivityContribution.ID, MagnusLiveActivityContribution, WorkbenchPhase.AfterRestored);

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'prebase.magnus.liveActivity.diagnostics',
			title: localize2('prebase.magnus.liveActivity.diagnostics', "Magnus Live Activity Diagnostics"),
			f1: false,
		});
	}
	async run() {
		const native = await MagnusLiveActivityContribution.instance?.getNativeDiagnostics();
		return {
			...MagnusLiveActivityContribution.diagnostics,
			...(native ? { native } : {}),
		};
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'prebase.magnus.liveActivity.nativeDiagnostics',
			title: localize2('prebase.magnus.liveActivity.nativeDiagnostics', "Magnus Live Activity Native Diagnostics"),
			f1: false,
		});
	}
	async run() {
		return MagnusLiveActivityContribution.instance?.getNativeDiagnostics();
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'prebase.magnus.liveActivity.simulate',
			title: localize2('prebase.magnus.liveActivity.simulate', "Magnus Live Activity Simulate Action (Smoke Test)"),
			f1: false,
		});
	}
	async run(accessor: ServicesAccessor, action: string, extras?: unknown) {
		requireSmokeTestDriver(accessor.get(IWorkbenchEnvironmentService).enableSmokeTestDriver, 'prebase.magnus.liveActivity.simulate');
		return MagnusLiveActivityContribution.instance?.simulateAction(action, extras);
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'prebase.test.seedMagnusLiveActivityPending',
			title: localize2('prebase.test.seedMagnusLiveActivityPending', "Seed Magnus Live Activity Pending Interaction (Smoke Test)"),
			f1: false,
		});
	}
	async run(accessor: ServicesAccessor, options?: { kind?: 'approval' | 'question' }) {
		requireSmokeTestDriver(accessor.get(IWorkbenchEnvironmentService).enableSmokeTestDriver, 'prebase.test.seedMagnusLiveActivityPending');
		const kind = options?.kind === 'question' ? 'question' : 'approval';
		const chatService = accessor.get(IChatService);
		const commandService = accessor.get(ICommandService);
		const toolsService = accessor.get(ILanguageModelToolsService);
		const riskAssessmentService = accessor.get(IChatToolRiskAssessmentService);
		const configurationService = accessor.get(IConfigurationService);
		await commandService.executeCommand('_setContext', 'vscode.chat.tools.global.autoApprove.testMode', false);
		await configurationService.updateValue('chat.autoReply', false);
		const model = selectPrimaryMagnusModel(chatService.chatModels.get());
		const requestId = model?.lastRequest?.id;
		const targetSessionId = model?.sessionId;
		if (!model || !requestId || !targetSessionId) {
			return { ok: false, reason: 'no-magnus-session' };
		}
		const callId = `smoke-la-${kind}-${Date.now()}`;
		const isQuestion = kind === 'question';
		let invokeError: string | undefined;
		void toolsService.invokeTool({
			callId,
			toolId: isQuestion ? AskQuestionsToolId : 'prebase_edit_delete_file',
			parameters: isQuestion ? {
				questions: [{
					header: 'Smoke',
					question: 'Live Activity smoke question?',
					options: [{ label: 'Option A' }, { label: 'Option B' }],
					allowFreeformInput: false,
				}],
			} : {
				path: 'package.json',
			},
			context: { sessionResource: model.sessionResource },
			chatRequestId: requestId,
		}, async () => 0, CancellationToken.None).catch(error => {
			invokeError = error instanceof Error ? error.message : String(error);
		});
		const risk = {
			isDestructive: (toolId: string, parameters: unknown) => {
				const tool = toolsService.getTool(toolId);
				if (!tool) {
					return false;
				}
				return riskAssessmentService.getCached(tool, parameters)?.risk === ToolRiskLevel.Red;
			},
		};
		const deadline = Date.now() + 8_000;
		while (Date.now() < deadline) {
			await new Promise(resolve => setTimeout(resolve, 200));
			const activeModel = selectPrimaryMagnusModel(chatService.chatModels.get());
			if (!activeModel || activeModel.sessionId !== targetSessionId) {
				continue;
			}
			const pending = extractPendingFromModel(activeModel, risk);
			if (pending?.kind === kind) {
				MagnusLiveActivityContribution.instance?.flushSnapshotForSmoke();
				const diag = MagnusLiveActivityContribution.diagnostics;
				return {
					ok: true,
					kind: pending.kind,
					interactionId: pending.interactionId,
					optionId: pending.options?.[0]?.id,
					sessionId: activeModel.sessionId,
					revision: diag.revision,
					liveActivityPendingKind: diag.pendingKind,
					liveActivityStatus: diag.status,
				};
			}
		}
		return { ok: false, reason: 'pending-timeout', kind, invokeError };
	}
});

