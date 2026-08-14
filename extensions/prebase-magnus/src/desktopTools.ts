/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { formatProcessOutputForTool } from './processOutputFormatter';

const MAX_TOOL_RESULT_CHARACTERS = 80_000;

function result(value: string): vscode.LanguageModelToolResult {
	return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(value.slice(0, MAX_TOOL_RESULT_CHARACTERS))]);
}

function jsonResult(value: unknown): vscode.LanguageModelToolResult {
	const serialized = JSON.stringify(value ?? { ok: false }, null, 2);
	return result(serialized.length <= MAX_TOOL_RESULT_CHARACTERS
		? serialized
		: JSON.stringify({ ok: false, truncated: true, reason: 'Tool result exceeds the response limit.' }));
}

function processOutputResult(value: unknown): vscode.LanguageModelToolResult {
	return jsonResult(formatProcessOutputForTool(value));
}

function screenshotResult(value: unknown): vscode.LanguageModelToolResult {
	if (!value || typeof value !== 'object' || (value as { ok?: unknown }).ok !== true || typeof (value as { pngBase64?: unknown }).pngBase64 !== 'string') {
		return jsonResult(value);
	}
	const screenshot = value as { mimeType?: unknown; pngBase64: string; scope?: unknown; limitations?: unknown };
	if (screenshot.mimeType !== 'image/png') {
		return jsonResult({ ok: false, reason: 'Desktop screenshot did not return a PNG image.' });
	}
	const png = Buffer.from(screenshot.pngBase64, 'base64');
	if (png.byteLength === 0 || png.byteLength > 10 * 1024 * 1024) {
		return jsonResult({ ok: false, reason: 'Desktop screenshot exceeds the 10 MiB image limit.' });
	}
	return new vscode.LanguageModelToolResult([
		new vscode.LanguageModelTextPart(JSON.stringify({ ok: true, mimeType: screenshot.mimeType, scope: screenshot.scope, limitations: screenshot.limitations, imageIncluded: true })),
		vscode.LanguageModelDataPart.image(new Uint8Array(png), screenshot.mimeType),
	]);
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

class DesktopProcessOutputTool implements vscode.LanguageModelTool<{ sessionId?: string }> {
	async invoke(options: vscode.LanguageModelToolInvocationOptions<{ sessionId?: string }>, token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
		if (token.isCancellationRequested) {
			throw new Error('Cancelled');
		}
		return processOutputResult(await vscode.commands.executeCommand('prebase.runtime.desktopGetProcessOutputForMagnus', options.input.sessionId));
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

class DesktopStopTool implements vscode.LanguageModelTool<{ sessionId?: string }> {
	async invoke(options: vscode.LanguageModelToolInvocationOptions<{ sessionId?: string }>, token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
		if (token.isCancellationRequested) {
			throw new Error('Cancelled');
		}
		return jsonResult(await vscode.commands.executeCommand('prebase.runtime.desktopStopForMagnus', options.input.sessionId));
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

class DesktopScreenshotTool implements vscode.LanguageModelTool<{ sessionId?: string }> {
	async invoke(options: vscode.LanguageModelToolInvocationOptions<{ sessionId?: string }>, token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
		if (token.isCancellationRequested) {
			throw new Error('Cancelled');
		}
		const screenshot = await vscode.commands.executeCommand('prebase.runtime.desktopCaptureScreenshotForMagnus', options.input.sessionId);
		if (token.isCancellationRequested) {
			throw new Error('Cancelled');
		}
		return screenshotResult(screenshot);
	}
}

export function registerMagnusDesktopTools(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.lm.registerTool('prebase_desktop_list_sessions', new DesktopListSessionsTool()),
		vscode.lm.registerTool('prebase_desktop_get_session', new DesktopGetSessionTool()),
		vscode.lm.registerTool('prebase_desktop_inspect_window', new DesktopInspectTool()),
		vscode.lm.registerTool('prebase_desktop_get_process_output', new DesktopProcessOutputTool()),
		vscode.lm.registerTool('prebase_desktop_reload_window', new DesktopReloadTool()),
		vscode.lm.registerTool('prebase_desktop_restart_session', new DesktopRestartTool()),
		vscode.lm.registerTool('prebase_desktop_stop_session', new DesktopStopTool()),
		vscode.lm.registerTool('prebase_desktop_cdp_evaluate', new DesktopCdpEvalTool()),
		vscode.lm.registerTool('prebase_desktop_capture_screenshot', new DesktopScreenshotTool()),
	);
}
