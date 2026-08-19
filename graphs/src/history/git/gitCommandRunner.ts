/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { spawn } from 'node:child_process';
import type { CancellationTokenLike } from '../../core/canonical/contentSource.js';

export interface GitExecOptions {
	readonly cwd: string;
	readonly args: readonly string[];
	readonly timeoutMs?: number;
	readonly maxBufferBytes?: number;
	readonly token?: CancellationTokenLike;
	readonly env?: Record<string, string>;
}

export interface GitExecResult {
	readonly stdout: string;
	readonly stdoutBuffer: Buffer;
	readonly stderr: string;
	readonly exitCode: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BUFFER_BYTES = 50 * 1024 * 1024; // 50MB

export class GitCommandRunner {
	private readonly _gitBinary: string;

	constructor(gitBinary = 'git') {
		this._gitBinary = gitBinary;
	}

	async exec(options: GitExecOptions): Promise<GitExecResult> {
		if (options.token?.isCancellationRequested) {
			throw new Error('Git operation cancelled before execution.');
		}

		return new Promise<GitExecResult>((resolve, reject) => {
			const sanitizedArgs = this._sanitizeArgs(options.args);
			const child = spawn(this._gitBinary, sanitizedArgs, {
				cwd: options.cwd,
				stdio: ['ignore', 'pipe', 'pipe'],
				env: {
					...process.env,
					...options.env,
					GIT_OPTIONAL_LOCKS: '0', // Don't take background locks
					LC_ALL: 'C', // Deterministic ASCII/English output for stable parsing
				},
			});

			const stdoutChunks: Buffer[] = [];
			const stderrChunks: Buffer[] = [];
			let totalStdoutBytes = 0;
			let isResolved = false;

			const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
			const maxBuffer = options.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES;

			const timer = setTimeout(() => {
				if (!isResolved) {
					isResolved = true;
					child.kill('SIGKILL');
					reject(new Error(`Git command timed out after ${timeoutMs}ms: git ${sanitizedArgs.join(' ')}`));
				}
			}, timeoutMs);

			let cancellationCheckInterval: ReturnType<typeof setInterval> | undefined;
			if (options.token) {
				cancellationCheckInterval = setInterval(() => {
					if (options.token?.isCancellationRequested && !isResolved) {
						isResolved = true;
						clearInterval(cancellationCheckInterval);
						clearTimeout(timer);
						child.kill('SIGKILL');
						reject(new Error('Git operation cancelled.'));
					}
				}, 50);
			}

			child.stdout.on('data', (chunk: Buffer) => {
				totalStdoutBytes += chunk.length;
				if (totalStdoutBytes > maxBuffer) {
					if (!isResolved) {
						isResolved = true;
						clearTimeout(timer);
						if (cancellationCheckInterval) clearInterval(cancellationCheckInterval);
						child.kill('SIGKILL');
						reject(new Error(`Git command stdout exceeded maximum buffer of ${maxBuffer} bytes`));
					}
					return;
				}
				stdoutChunks.push(chunk);
			});

			child.stderr.on('data', (chunk: Buffer) => {
				stderrChunks.push(chunk);
			});

			child.on('error', (err: Error) => {
				if (!isResolved) {
					isResolved = true;
					clearTimeout(timer);
					if (cancellationCheckInterval) clearInterval(cancellationCheckInterval);
					reject(err);
				}
			});

			child.on('close', (code: number | null) => {
				if (!isResolved) {
					isResolved = true;
					clearTimeout(timer);
					if (cancellationCheckInterval) clearInterval(cancellationCheckInterval);

					const stdoutBuf = Buffer.concat(stdoutChunks);
					const stderrBuf = Buffer.concat(stderrChunks);
					const stderrStr = stderrBuf.toString('utf8');

					if (code === 0) {
						resolve({
							stdout: stdoutBuf.toString('utf8'),
							stdoutBuffer: stdoutBuf,
							stderr: stderrStr,
							exitCode: 0,
						});
					} else {
						resolve({
							stdout: stdoutBuf.toString('utf8'),
							stdoutBuffer: stdoutBuf,
							stderr: stderrStr,
							exitCode: code ?? 1,
						});
					}
				}
			});
		});
	}

	private _sanitizeArgs(args: readonly string[]): string[] {
		// Return array copy; spawn avoids shell execution
		return [...args];
	}
}
