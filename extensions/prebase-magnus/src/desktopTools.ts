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

class DesktopCdpEvalTool implements vscode.LanguageModelTool<{ sessionId?: string; expression: string }> {
	async invoke(options: vscode.LanguageModelToolInvocationOptions<{ sessionId?: string; expression: string }>, token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
		if (token.isCancellationRequested) {
			throw new Error('Cancelled');
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
