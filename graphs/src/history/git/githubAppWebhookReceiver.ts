/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/
import { computePureHmacSha256, timingSafeEqualStrings } from '../../core/canonical/pureSha256.js';

export interface IGitHubWebhookHeaders {
	readonly 'x-hub-signature-256'?: string;
	readonly 'x-github-delivery'?: string;
	readonly 'x-github-event'?: string;
	readonly [header: string]: string | undefined;
}

export interface IGitHubPushEventCommit {
	readonly id: string;
	readonly tree_id?: string;
	readonly message: string;
	readonly timestamp: string;
	readonly author: { readonly name: string; readonly email: string };
	readonly added?: readonly string[];
	readonly removed?: readonly string[];
	readonly modified?: readonly string[];
}

export interface IGitHubPushEventPayload {
	readonly ref: string;
	readonly before: string;
	readonly after: string;
	readonly created?: boolean;
	readonly deleted?: boolean;
	readonly forced?: boolean;
	readonly repository?: {
		readonly id: number;
		readonly name: string;
		readonly full_name: string;
		readonly clone_url?: string;
		readonly default_branch?: string;
	};
	readonly pusher?: { readonly name: string; readonly email?: string };
	readonly commits?: readonly IGitHubPushEventCommit[];
	readonly head_commit?: IGitHubPushEventCommit;
}

export interface IWebhookProcessResult {
	readonly status: number;
	readonly ok: boolean;
	readonly message: string;
	readonly deliveryId?: string;
	readonly isDuplicate?: boolean;
	readonly pushEvent?: IGitHubPushEventPayload;
}

export class GitHubAppWebhookReceiver {
	private readonly _processedDeliveries = new Set<string>();
	private readonly _maxDeliveryHistory = 1000;
	private readonly _webhookSecret: string;
	private readonly _onPushReceived?: (payload: IGitHubPushEventPayload) => void | Promise<void>;

	constructor(
		webhookSecret: string,
		onPushReceived?: (payload: IGitHubPushEventPayload) => void | Promise<void>
	) {
		this._webhookSecret = webhookSecret;
		this._onPushReceived = onPushReceived;
	}

	/**
	 * Timing-safe HMAC-SHA256 signature verification.
	 */
	verifySignature(rawBody: string | Buffer | Uint8Array, signatureHeader: string | undefined): boolean {
		if (!signatureHeader || !this._webhookSecret) {
			return false;
		}

		const prefix = 'sha256=';
		if (!signatureHeader.startsWith(prefix)) {
			return false;
		}

		const expectedHex = signatureHeader.slice(prefix.length).toLowerCase();
		const bodyStr = typeof rawBody === 'string' ? rawBody : Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : new TextDecoder().decode(rawBody);
		const computedHex = computePureHmacSha256(this._webhookSecret, bodyStr).toLowerCase();

		return timingSafeEqualStrings(expectedHex, computedHex);
	}

	/**
	 * Process an incoming webhook request.
	 * Returns 200/400/401 HTTP result immediately, and triggers async push handling if valid.
	 */
	processWebhook(
		headers: IGitHubWebhookHeaders,
		rawBody: string | Buffer,
		parsedPayload?: any
	): IWebhookProcessResult {
		const signature = headers['x-hub-signature-256'] || headers['X-Hub-Signature-256'];
		const deliveryId = headers['x-github-delivery'] || headers['X-GitHub-Delivery'];
		const eventType = headers['x-github-event'] || headers['X-GitHub-Event'] || 'push';

		// 1. Verify Signature
		if (!this.verifySignature(rawBody, signature)) {
			return {
				status: 401,
				ok: false,
				message: 'Invalid or missing signature (X-Hub-Signature-256)',
				deliveryId,
			};
		}

		// 2. Deduplicate Delivery
		if (deliveryId) {
			if (this._processedDeliveries.has(deliveryId)) {
				return {
					status: 200,
					ok: true,
					message: 'Delivery already processed (deduplicated)',
					deliveryId,
					isDuplicate: true,
				};
			}
			this._recordDelivery(deliveryId);
		}

		// 3. Handle Event Type
		if (eventType === 'ping') {
			return {
				status: 200,
				ok: true,
				message: 'Pong (ping acknowledged)',
				deliveryId,
			};
		}

		if (eventType !== 'push') {
			return {
				status: 200,
				ok: true,
				message: `Event type '${eventType}' received (non-push ignored)`,
				deliveryId,
			};
		}

		// 4. Parse Push Payload
		let pushPayload: IGitHubPushEventPayload;
		try {
			pushPayload = parsedPayload || JSON.parse(typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8'));
		} catch (err: any) {
			return {
				status: 400,
				ok: false,
				message: 'Malformed JSON payload',
				deliveryId,
			};
		}

		// 5. Fire callback asynchronously (fast 200 OK ACK)
		if (this._onPushReceived) {
			try {
				const result = this._onPushReceived(pushPayload);
				if (result && typeof (result as any).catch === 'function') {
					(result as any).catch((err: any) => {
						console.error('[GitHubAppWebhookReceiver] Error in push handler callback:', err);
					});
				}
			} catch (err) {
				console.error('[GitHubAppWebhookReceiver] Error in push handler sync callback:', err);
			}
		}

		return {
			status: 200,
			ok: true,
			message: 'Push event accepted',
			deliveryId,
			pushEvent: pushPayload,
		};
	}

	private _recordDelivery(id: string): void {
		this._processedDeliveries.add(id);
		if (this._processedDeliveries.size > this._maxDeliveryHistory) {
			const iter = this._processedDeliveries.values();
			const first = iter.next().value;
			if (first) {
				this._processedDeliveries.delete(first);
			}
		}
	}
}
