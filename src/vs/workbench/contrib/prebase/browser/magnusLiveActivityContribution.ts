/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { RunOnceScheduler } from '../../../../base/common/async.js';
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
import { IChatService, IChatToolInvocation, ToolConfirmKind } from '../../chat/common/chatService/chatService.js';
import type { IChatModel, IChatRequestModel } from '../../chat/common/model/chatModel.js';
import {
	MAGNUS_LIVE_ACTIVITY_CHANNEL,
	type IMagnusLiveActivityMainService,
} from '../../../../platform/prebaseLiveActivity/common/prebaseLiveActivity.js';
import {
	acceptLiveActivityCommand,
	buildMagnusLiveActivitySnapshot,
	isMagnusParticipantId,
	redactLiveActivityText,
	selectPrimaryMagnusSession,
	shouldShowLiveActivity,
	type LiveActivityCommand,
	type MagnusLiveActivityAction,
	type MagnusLiveActivityMode,
	type MagnusLiveActivityDisplay,
	type MagnusLiveActivityPendingInteraction,
	type MagnusLiveActivitySessionInput,
	type MagnusLiveActivitySnapshot,
} from '../../../../platform/prebaseLiveActivity/common/magnusLiveActivity.js';

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

function extractPending(request: IChatRequestModel | undefined): MagnusLiveActivityPendingInteraction | undefined {
	const parts = request?.response?.entireResponse.value ?? [];
	for (const part of parts) {
		if (part.kind === 'toolInvocation') {
			const invocation = part as IChatToolInvocation;
			const state = invocation.state.get();
			if (state.type === IChatToolInvocation.StateKind.WaitingForConfirmation || state.type === IChatToolInvocation.StateKind.WaitingForPostApproval) {
				const confirmation = 'confirmationMessages' in state ? state.confirmationMessages : undefined;
				return {
					kind: 'approval',
					interactionId: invocation.toolCallId,
					title: redactLiveActivityText(asPlainText(confirmation?.title) || asPlainText(invocation.invocationMessage) || 'Approve tool'),
					message: redactLiveActivityText(asPlainText(confirmation?.message) || asPlainText(invocation.originMessage)),
					destructive: false,
				};
			}
		}
		if (part.kind === 'questionCarousel' && !part.isUsed) {
			const first = part.questions?.[0];
			const options = first?.options?.slice(0, 4).map(option => ({ id: option.id, label: option.label }));
			return {
				kind: 'question',
				interactionId: part.resolveId || request!.id,
				requestId: request!.id,
				resolveId: part.resolveId,
				title: redactLiveActivityText(first?.title || asPlainText(part.message) || 'Magnus has a question'),
				message: redactLiveActivityText(asPlainText(first?.message) || asPlainText(part.message)),
				options,
			};
		}
	}
	return undefined;
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

function extractSessionInput(model: IChatModel | undefined): MagnusLiveActivitySessionInput | undefined {
	if (!model) {
		return undefined;
	}
	const last = model.lastRequest;
	const pending = extractPending(last);
	const failed = last?.response?.isCanceled === false && last?.response?.isComplete && Boolean(last.response.result?.errorDetails);
	const completed = Boolean(last?.response?.isComplete && !last.response.isCanceled && !failed && !model.requestInProgress.get());
	const files = new Set<string>();
	for (const request of model.getRequests()) {
		for (const event of request.editedFileEvents ?? []) {
			if (event.uri) {
				files.add(String(event.uri));
			}
		}
	}
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
		workspaceDiff: files.size > 0 ? { files: files.size, attributedToMagnus: true } : undefined,
	};
}

export class MagnusLiveActivityContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.prebase.magnusLiveActivity';
	static diagnostics: {
		backend: 'native-appkit' | 'unavailable' | 'non-mac';
		revision: number;
		sessionId?: string;
		sessionResource?: string;
		status?: string;
	} = { backend: isMacintosh && !isWeb ? 'unavailable' : 'non-mac', revision: 0 };

	private readonly _main: IMagnusLiveActivityMainService | undefined;
	private _revision = 0;
	private _pinned = false;
	private _screenLocked = false;
	private _nativeConnected = false;
	private _lastSnapshot: MagnusLiveActivitySnapshot | undefined;
	private readonly _modelListeners = this._register(new DisposableStore());
	private readonly _push: RunOnceScheduler;

	constructor(
		@IChatService private readonly chatService: IChatService,
		@IHostService private readonly hostService: IHostService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ILogService private readonly logService: ILogService,
		@ICommandService private readonly commandService: ICommandService,
		@IMainProcessService mainProcessService: IMainProcessService,
		@IAccessibilityService private readonly accessibilityService: IAccessibilityService,
		@INativeHostService private readonly nativeHostService: INativeHostService,
	) {
		super();
		this._push = this._register(new RunOnceScheduler(() => this._publish(), 120));
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
		this._bindModels();
		this._push.schedule();
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
		const hideDetails = this._screenLocked || Boolean(this.configurationService.getValue<boolean>('prebase.magnus.liveActivity.hideDetails'));
		const snapshot = buildMagnusLiveActivitySnapshot(extractSessionInput(model), {
			revision: this._revision,
			prebaseForeground: this.hostService.hasFocus,
			connected: this._nativeConnected,
			screenLocked: hideDetails,
		});
		this._lastSnapshot = snapshot;
		MagnusLiveActivityContribution.diagnostics = {
			backend: !isMacintosh || isWeb ? 'non-mac' : (this._nativeConnected ? 'native-appkit' : 'unavailable'),
			revision: snapshot.revision,
			sessionId: snapshot.sessionId,
			sessionResource: snapshot.sessionResource,
			status: snapshot.status,
		};
		const visible = shouldShowLiveActivity(this._mode(), snapshot);
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
			this._push.schedule();
			return;
		}
		if (command.kind === 'unpin') {
			this._pinned = false;
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
		if (!snapshot.sessionResource) {
			return;
		}
		const sessionResource = URI.parse(snapshot.sessionResource);
		if (command.kind === 'followUp') {
			await this.chatService.sendRequest(sessionResource, (command.text ?? '').trim());
			return;
		}
		const model = this.chatService.getSession(sessionResource);
		const last = model?.lastRequest;
		if (command.kind === 'approve' || command.kind === 'deny') {
			const parts = last?.response?.entireResponse.value ?? [];
			for (const part of parts) {
				if (part.kind === 'toolInvocation' && (part as IChatToolInvocation).toolCallId === command.interactionId) {
					IChatToolInvocation.confirmWith(part as IChatToolInvocation, {
						type: command.kind === 'approve' ? ToolConfirmKind.UserAction : ToolConfirmKind.Denied,
					});
					this._push.schedule();
					return;
				}
			}
			this.logService.info('[MagnusLiveActivity] approval failed closed: invocation missing');
			return;
		}
		if (command.kind === 'answer' && snapshot.pendingInteraction?.resolveId && last) {
			this.chatService.notifyQuestionCarouselAnswer(last.id, snapshot.pendingInteraction.resolveId, command.optionId ? { [snapshot.pendingInteraction.interactionId]: { selectedValue: command.optionId } } : undefined);
			this._push.schedule();
		}
	}

	override dispose(): void {
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
	run() {
		return MagnusLiveActivityContribution.diagnostics;
	}
});
