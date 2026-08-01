/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

function result(value: string): vscode.LanguageModelToolResult {
	return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(value.slice(0, 80_000))]);
}

function jsonResult(value: unknown): vscode.LanguageModelToolResult {
	return result(JSON.stringify(value ?? { ok: false }, null, 2));
}

class DesktopListSessionsTool implements vscode.LanguageModelTool<Record<string, never>> {
	async invoke(_options: vscode.LanguageModelToolInvocationOptions<Record<string, never>>, token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
		if (token.isCancellationRequested) {
			throw new Error('Cancelled');
		}
		return jsonResult(await vscode.commands.executeCommand('prebase.runtime.desktopListSessionsForMagnus'));
	}
}

class DesktopGetSessionTool implements vscode.LanguageModelTool<{ sessionId?: string }> {
	async invoke(options: vscode.LanguageModelToolInvocationOptions<{ sessionId?: string }>, token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
		if (token.isCancellationRequested) {
			throw new Error('Cancelled');
		}
		return jsonResult(await vscode.commands.executeCommand('prebase.runtime.desktopGetSessionForMagnus', options.input.sessionId));
	}
}

class DesktopInspectTool implements vscode.LanguageModelTool<{ sessionId?: string }> {
	async invoke(options: vscode.LanguageModelToolInvocationOptions<{ sessionId?: string }>, token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
		if (token.isCancellationRequested) {
			throw new Error('Cancelled');
		}
		return jsonResult(await vscode.commands.executeCommand('prebase.runtime.desktopInspectForMagnus', options.input.sessionId));
	}
}

class DesktopReloadTool implements vscode.LanguageModelTool<{ sessionId?: string }> {
	async invoke(options: vscode.LanguageModelToolInvocationOptions<{ sessionId?: string }>, token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
		if (token.isCancellationRequested) {
			throw new Error('Cancelled');
		}
		return jsonResult(await vscode.commands.executeCommand('prebase.runtime.desktopReloadForMagnus', options.input.sessionId));
	}
}

class DesktopRestartTool implements vscode.LanguageModelTool<{ sessionId?: string }> {
	async invoke(options: vscode.LanguageModelToolInvocationOptions<{ sessionId?: string }>, token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
		if (token.isCancellationRequested) {
			throw new Error('Cancelled');
		}
		return jsonResult(await vscode.commands.executeCommand('prebase.runtime.desktopRestartForMagnus', options.input.sessionId));
	}
}

class DesktopStopTool implements vscode.LanguageModelTool<{ sessionId?: string; force?: boolean }> {
	async invoke(options: vscode.LanguageModelToolInvocationOptions<{ sessionId?: string; force?: boolean }>, token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
		if (token.isCancellationRequested) {
			throw new Error('Cancelled');
		}
		return jsonResult(await vscode.commands.executeCommand('prebase.runtime.desktopStopForMagnus', options.input.sessionId, options.input.force === true));
	}
}

/** Longest expression shown verbatim in the confirmation dialog. */
const CDP_EXPRESSION_PREVIEW_LIMIT = 2_000;

class DesktopCdpEvalTool implements vscode.LanguageModelTool<{ sessionId?: string; expression: string }> {
	/**
	 * This runs model-authored JavaScript inside the application under test, so
	 * it needs the same explicit approval as editing files or controlling the
	 * server — and the user must be able to read the exact expression first.
	 */
	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<{ sessionId?: string; expression: string }>): vscode.PreparedToolInvocation {
		const expression = options.input.expression?.trim() ?? '';
		const preview = expression.length > CDP_EXPRESSION_PREVIEW_LIMIT
			? `${expression.slice(0, CDP_EXPRESSION_PREVIEW_LIMIT)}\n… (truncated)`
			: expression;
		return {
			invocationMessage: 'Evaluate JavaScript in the desktop session',
			confirmationMessages: {
				title: 'Run JavaScript in the desktop app?',
				message: new vscode.MarkdownString(
					'Agents wants to evaluate this expression in the running desktop session. It has full access to that page.\n\n'
					+ '```js\n' + preview.replace(/```/g, '`\u200b``') + '\n```',
				),
			},
		};
	}

	async invoke(options: vscode.LanguageModelToolInvocationOptions<{ sessionId?: string; expression: string }>, token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
		if (token.isCancellationRequested) {
			throw new Error('Cancelled');
		}
		if (!vscode.workspace.isTrusted) {
			throw new Error('Workspace Trust is required before Agents can evaluate JavaScript in a desktop session.');
		}
		const expression = options.input.expression?.trim();
		if (!expression) {
			throw new Error('expression is required');
		}
		return jsonResult(await vscode.commands.executeCommand('prebase.runtime.desktopCdpEvaluateForMagnus', options.input.sessionId, expression));
	}
}

export function registerMagnusDesktopTools(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.lm.registerTool('prebase_desktop_list_sessions', new DesktopListSessionsTool()),
		vscode.lm.registerTool('prebase_desktop_get_session', new DesktopGetSessionTool()),
		vscode.lm.registerTool('prebase_desktop_inspect_window', new DesktopInspectTool()),
		vscode.lm.registerTool('prebase_desktop_reload_window', new DesktopReloadTool()),
		vscode.lm.registerTool('prebase_desktop_restart_session', new DesktopRestartTool()),
		vscode.lm.registerTool('prebase_desktop_stop_session', new DesktopStopTool()),
		vscode.lm.registerTool('prebase_desktop_cdp_evaluate', new DesktopCdpEvalTool()),
	);
}
