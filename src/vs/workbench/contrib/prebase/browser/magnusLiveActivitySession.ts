/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IChatService, IChatToolInvocation, ToolConfirmKind } from '../../chat/common/chatService/chatService.js';
import type { IChatModel, IChatRequestModel } from '../../chat/common/model/chatModel.js';
import {
	redactLiveActivityText,
	type LiveActivityCommand,
	type MagnusLiveActivityPendingInteraction,
	type MagnusLiveActivitySnapshot,
	type MagnusLiveActivityTranscriptTurn,
} from '../../../../platform/prebaseLiveActivity/common/magnusLiveActivity.js';

export function asPlainText(value: unknown): string {
	if (!value) {
		return '';
	}
	if (typeof value === 'string') {
		return value;
	}
	if (typeof value === 'object' && value !== null && typeof (value as Record<string, unknown>).value === 'string') {
		return (value as { value: string }).value;
	}
	return String(value);
}

export function extractPending(
	request: IChatRequestModel | undefined,
	risk?: { isDestructive(toolId: string, parameters: unknown): boolean },
): MagnusLiveActivityPendingInteraction | undefined {
	const parts = request?.response?.entireResponse.value ?? [];
	for (const part of parts) {
		if (part.kind === 'toolInvocation') {
			const invocation = part as IChatToolInvocation;
			const state = invocation.state.get();
			if (state.type === IChatToolInvocation.StateKind.WaitingForConfirmation || state.type === IChatToolInvocation.StateKind.WaitingForPostApproval) {
				const confirmation = IChatToolInvocation.getConfirmationMessages(invocation);
				const parameters = IChatToolInvocation.getParameters(invocation);
				const destructive = risk?.isDestructive(invocation.toolId, parameters);
				return {
					kind: 'approval',
					interactionId: invocation.toolCallId,
					title: redactLiveActivityText(asPlainText(confirmation?.title) || asPlainText(invocation.invocationMessage) || 'Approve tool'),
					message: redactLiveActivityText(asPlainText(confirmation?.message) || asPlainText(invocation.originMessage)),
					...(destructive === true ? { destructive: true } : {}),
				};
			}
		}
		if (part.kind === 'questionCarousel' && !part.isUsed) {
			const first = part.questions?.[0];
			if (!first || !request?.id) {
				continue;
			}
			// AskQuestions equates option id/value/label; answer map keys by question.id; optionId = value.
			const options = first.options
				?.map(option => ({
					id: option.value || option.id,
					label: redactLiveActivityText(option.label || option.value || option.id) || (option.value || option.id),
				}))
				.filter(option => Boolean(option.id));
			return {
				kind: 'question',
				interactionId: first.id,
				requestId: request.id,
				resolveId: part.resolveId,
				title: redactLiveActivityText(first.title || asPlainText(part.message) || 'Magnus has a question'),
				message: redactLiveActivityText(asPlainText(first.message) || asPlainText(part.message)),
				options: options?.length ? options : undefined,
			};
		}
	}
	return undefined;
}

/** Pending approval/question may remain on an earlier request while a newer follow-up exists. */
export function extractPendingFromModel(
	model: IChatModel | undefined,
	risk?: { isDestructive(toolId: string, parameters: unknown): boolean },
): MagnusLiveActivityPendingInteraction | undefined {
	if (!model) {
		return undefined;
	}
	const requests = model.getRequests();
	for (let i = requests.length - 1; i >= 0; i--) {
		const pending = extractPending(requests[i], risk);
		if (pending) {
			return pending;
		}
	}
	return undefined;
}

export function extractTranscriptFromModel(
	model: IChatModel | undefined,
	maxTurns = 3,
	maxChars = 140,
): readonly MagnusLiveActivityTranscriptTurn[] {
	if (!model) {
		return [];
	}
	const requests = model.getRequests();
	const turns: MagnusLiveActivityTranscriptTurn[] = [];
	const startIdx = Math.max(0, requests.length - maxTurns);
	for (let i = startIdx; i < requests.length; i++) {
		const req = requests[i];
		const userMsg = (req.message.text ?? '').trim();
		if (userMsg) {
			const sanitized = redactLiveActivityText(userMsg).slice(0, maxChars);
			turns.push({ role: 'user', text: sanitized });
		}
		if (req.response) {
			let responseText = '';
			for (const part of req.response.entireResponse.value ?? []) {
				if (part.kind === 'markdownContent') {
					responseText += part.content.value;
				}
			}
			responseText = responseText.trim();
			if (responseText) {
				const sanitized = redactLiveActivityText(responseText).slice(0, maxChars);
				turns.push({ role: 'agent', text: sanitized });
			}
		}
	}
	return turns.slice(-maxTurns * 2);
}

export async function applyMagnusLiveActivitySessionCommand(
	snapshot: MagnusLiveActivitySnapshot,
	command: LiveActivityCommand,
	deps: {
		chatService: Pick<IChatService, 'sendRequest' | 'getSession' | 'notifyQuestionCarouselAnswer'>;
		logService: Pick<ILogService, 'info'>;
		onInteractionApplied?: () => void;
	},
): Promise<void> {
	if (!snapshot.sessionResource) {
		return;
	}
	const sessionResource = URI.parse(snapshot.sessionResource);
	const model = deps.chatService.getSession(sessionResource);
	if (snapshot.sessionId && (!model || model.sessionId !== snapshot.sessionId)) {
		deps.logService.info('[MagnusLiveActivity] command failed closed: session mismatch');
		return;
	}
	if (command.kind === 'followUp') {
		const text = (command.text ?? '').trim();
		if (!text) {
			deps.logService.info('[MagnusLiveActivity] followUp ignored: empty text');
			return;
		}
		const requests = model?.getRequests() ?? [];
		const isInitialRequest = requests.length === 0;
		const options = isInitialRequest ? { agentId: 'prebase.magnus.agent' } : undefined;
		await deps.chatService.sendRequest(sessionResource, text, options);
		deps.onInteractionApplied?.();
		return;
	}
	const last = model?.lastRequest;
	if (command.kind === 'approve' || command.kind === 'deny') {
		const pendingApproval = snapshot.pendingInteraction;
		if (pendingApproval?.kind !== 'approval' || pendingApproval.interactionId !== command.interactionId) {
			deps.logService.info('[MagnusLiveActivity] approval failed closed: stale interaction');
			return;
		}
		for (const request of model?.getRequests() ?? []) {
			for (const part of request.response?.entireResponse.value ?? []) {
				if (part.kind !== 'toolInvocation' || (part as IChatToolInvocation).toolCallId !== command.interactionId) {
					continue;
				}
				const invocation = part as IChatToolInvocation;
				const state = invocation.state.get();
				if (state.type !== IChatToolInvocation.StateKind.WaitingForConfirmation && state.type !== IChatToolInvocation.StateKind.WaitingForPostApproval) {
					deps.logService.info('[MagnusLiveActivity] approval failed closed: invocation no longer pending');
					return;
				}
				IChatToolInvocation.confirmWith(invocation, {
					type: command.kind === 'approve' ? ToolConfirmKind.UserAction : ToolConfirmKind.Denied,
				});
				deps.onInteractionApplied?.();
				return;
			}
		}
		deps.logService.info('[MagnusLiveActivity] approval failed closed: invocation missing');
		return;
	}
	const pending = snapshot.pendingInteraction;
	if (command.kind === 'answer') {
		if (pending?.kind !== 'question' || pending.interactionId !== command.interactionId || !pending.resolveId || !command.optionId) {
			deps.logService.info('[MagnusLiveActivity] answer failed closed: stale interaction');
			return;
		}
		const requestId = pending.requestId ?? last?.id;
		if (!requestId) {
			deps.logService.info('[MagnusLiveActivity] answer failed closed: missing question/option');
			return;
		}
		const request = model?.getRequests().find(r => r.id === requestId);
		const carousel = (request?.response?.entireResponse.value ?? []).find(part =>
			part.kind === 'questionCarousel' && part.resolveId === pending.resolveId && !part.isUsed);
		if (!carousel || carousel.kind !== 'questionCarousel') {
			deps.logService.info('[MagnusLiveActivity] answer failed closed: carousel missing/used');
			return;
		}
		const question = carousel.questions?.find(q => q.id === pending.interactionId);
		const optionIds = question?.options?.map(option => option.value || option.id).filter(Boolean) ?? [];
		if (optionIds.length > 0 && !optionIds.includes(command.optionId)) {
			deps.logService.info('[MagnusLiveActivity] answer failed closed: stale option');
			return;
		}
		deps.chatService.notifyQuestionCarouselAnswer(
			requestId,
			pending.resolveId,
			{ [pending.interactionId]: { selectedValue: command.optionId } },
		);
		deps.onInteractionApplied?.();
	}
}
