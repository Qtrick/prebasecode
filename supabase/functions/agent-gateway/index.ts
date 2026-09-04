/**
 * PreBase agent-gateway.
 * Authenticated gateway for Gemini model discovery and generation.
 * Provider credentials stay strictly in Edge Function secrets.
 * Prompts, response bodies, and API keys are never logged.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const MAX_BODY_BYTES = 65_536; // 64 KiB
const MAX_OUTPUT_BYTES = 1_048_576; // 1 MiB

const ALLOWED_MODELS = new Set([
	"gemini-3.8-flash",
	"gemini-3.7-flash",
	"gemini-2.5-flash",
	"gemini-2.5-pro",
]);

function isHostedEnabled(): boolean {
	return Deno.env.get("PREBASE_HOSTED_MAGNUS_ENABLED") === "true";
}

const DESKTOP_ORIGIN_EXACT = new Set(["null"]);

function isAllowedOrigin(origin: string | null): boolean {
	if (!origin) {
		return false;
	}
	if (DESKTOP_ORIGIN_EXACT.has(origin)) {
		return true;
	}
	try {
		const u = new URL(origin);
		return u.protocol === "http:" &&
			(u.hostname === "localhost" || u.hostname === "127.0.0.1");
	} catch {
		return false;
	}
}

type JsonRecord = Record<string, unknown>;

function requestIdFrom(req: Request): string {
	const headerId = req.headers.get("x-request-id");
	if (headerId && /^[A-Za-z0-9-]{1,128}$/.test(headerId)) {
		return headerId;
	}
	return crypto.randomUUID();
}

function corsHeaders(req: Request): HeadersInit {
	const origin = req.headers.get("Origin");
	const allowOrigin =
		origin && isAllowedOrigin(origin) ? origin : "http://127.0.0.1";
	return {
		"Access-Control-Allow-Origin": allowOrigin,
		"Access-Control-Allow-Headers":
			"authorization, apikey, content-type, x-client-info, x-request-id, accept",
		"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
		"Vary": "Origin",
	};
}

function json(
	req: Request,
	requestId: string,
	status: number,
	body: JsonRecord,
): Response {
	return new Response(JSON.stringify({ request_id: requestId, ...body }), {
		status,
		headers: {
			...corsHeaders(req),
			"Content-Type": "application/json",
			"x-request-id": requestId,
		},
	});
}

function bearerToken(req: Request): string | null {
	const header = req.headers.get("Authorization");
	if (!header?.startsWith("Bearer ")) {
		return null;
	}
	const token = header.slice("Bearer ".length).trim();
	return token.length > 0 ? token : null;
}

async function requireUser(req: Request, requestId: string) {
	const token = bearerToken(req);
	if (!token) {
		return {
			error: json(req, requestId, 401, {
				error: "unauthorized",
				message: "Missing or invalid Authorization bearer token.",
			}),
		};
	}

	const url = Deno.env.get("SUPABASE_URL");
	const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
	if (!url || !anonKey) {
		return {
			error: json(req, requestId, 503, {
				error: "misconfigured",
				message: "Gateway auth environment is not configured.",
			}),
		};
	}

	const supabase = createClient(url, anonKey, {
		global: { headers: { Authorization: `Bearer ${token}` } },
		auth: { persistSession: false, autoRefreshToken: false },
	});

	const { data, error } = await supabase.auth.getUser(token);
	if (error || !data.user) {
		return {
			error: json(req, requestId, 401, {
				error: "unauthorized",
				message: "Invalid or expired session.",
			}),
		};
	}

	return { user: data.user };
}

Deno.serve(async (req) => {
	const requestId = requestIdFrom(req);

	if (req.method === "OPTIONS") {
		return new Response(null, { status: 204, headers: corsHeaders(req) });
	}

	const url = new URL(req.url);
	const geminiApiKey = Deno.env.get("GEMINI_API_KEY");

	// Health and provider status endpoint
	if (req.method === "GET") {
		if (url.pathname.endsWith("/health") || url.pathname.endsWith("/providers")) {
			const enabled = isHostedEnabled();
			return json(req, requestId, 200, {
				status: "ok",
				service: "agent-gateway",
				enabled,
				providers: [
					{
						id: "gemini",
						displayName: "Google Gemini",
						configured: enabled && !!geminiApiKey,
						modelsAvailable: enabled && !!geminiApiKey,
					},
				],
			});
		}

		// Authenticated models discovery endpoint
		if (url.pathname.endsWith("/models")) {
			if (!isHostedEnabled()) {
				return json(req, requestId, 501, {
					error: "hosted_disabled",
					message: "Hosted Magnus is disabled for public beta.",
				});
			}

			const auth = await requireUser(req, requestId);
			if ("error" in auth && auth.error) {
				return auth.error;
			}

			if (!geminiApiKey) {
				return json(req, requestId, 503, {
					error: "not_configured",
					message: "Gemini provider secret is not configured on the server.",
				});
			}

			try {
				const geminiRes = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=50", {
					method: "GET",
					headers: {
						"Content-Type": "application/json",
						"x-goog-api-key": geminiApiKey,
					},
				});

				if (!geminiRes.ok) {
					return json(req, requestId, 502, {
						error: "provider_error",
						message: "Failed to discover models from Gemini API.",
					});
				}

				const data = await geminiRes.json() as { models?: Array<{ name?: string; displayName?: string; description?: string; inputTokenLimit?: number; outputTokenLimit?: number; supportedGenerationMethods?: string[] }> };
				const models = (data.models ?? [])
					.map(m => {
						const rawName = m.name ?? "";
						const id = rawName.startsWith("models/") ? rawName.slice("models/".length) : rawName;
						const methods = m.supportedGenerationMethods ?? [];
						const supportsGenerate = methods.includes("generateContent");
						const isDeprecated = id.includes("1.0") || id.includes("1.5") || id.includes("experimental");
						const isAllowed = ALLOWED_MODELS.has(id);
						return {
							id,
							displayName: m.displayName || id,
							description: m.description || "",
							inputTokenLimit: m.inputTokenLimit || 1_000_000,
							outputTokenLimit: m.outputTokenLimit || 65_536,
							agentCompatible: supportsGenerate && !isDeprecated && isAllowed,
							descriptionCompatible: supportsGenerate && isAllowed,
						};
					})
					.filter(m => m.id && (m.agentCompatible || m.descriptionCompatible));

				return json(req, requestId, 200, { models });
			} catch {
				return json(req, requestId, 502, {
					error: "provider_error",
					message: "Error communicating with Gemini models API.",
				});
			}
		}

		return json(req, requestId, 405, { error: "method_not_allowed" });
	}

	if (req.method !== "POST") {
		return json(req, requestId, 405, { error: "method_not_allowed" });
	}

	if (!isHostedEnabled()) {
		return json(req, requestId, 501, {
			error: "hosted_disabled",
			message: "Hosted Magnus is disabled for public beta.",
		});
	}

	const contentLength = req.headers.get("Content-Length");
	if (contentLength && Number(contentLength) > MAX_BODY_BYTES) {
		return json(req, requestId, 413, { error: "payload_too_large" });
	}

	const auth = await requireUser(req, requestId);
	if ("error" in auth && auth.error) {
		return auth.error;
	}

	let body: JsonRecord;
	try {
		const raw = await req.text();
		if (raw.length > MAX_BODY_BYTES) {
			return json(req, requestId, 413, { error: "payload_too_large" });
		}
		body = raw.length > 0 ? (JSON.parse(raw) as JsonRecord) : {};
	} catch {
		return json(req, requestId, 400, { error: "invalid_json" });
	}

	const model = typeof body.model === "string" ? body.model : "gemini-2.5-flash";
	if (!ALLOWED_MODELS.has(model)) {
		return json(req, requestId, 400, {
			error: "model_not_allowed",
			message: `Model ${model} is not allowed on the hosted gateway.`,
		});
	}

	if (!geminiApiKey) {
		return json(req, requestId, 503, {
			error: "not_configured",
			message: "Gemini provider is not configured on the hosted gateway.",
		});
	}

	// Reserve quota atomically via admin client
	const supabaseUrl = Deno.env.get("SUPABASE_URL");
	const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
	if (!supabaseUrl || !serviceKey) {
		return json(req, requestId, 503, {
			error: "usage_check_unavailable",
			message: "Usage ledger unavailable; gateway is closed.",
		});
	}

	const admin = createClient(supabaseUrl, serviceKey, {
		auth: { persistSession: false, autoRefreshToken: false },
	});

	const { error: quotaError } = await admin.rpc("reserve_agent_quota", {
		p_user_id: auth.user.id,
		p_request_id: requestId,
		p_model: model,
		p_estimated_units: 1000,
	});

	if (quotaError) {
		return json(req, requestId, 429, {
			error: "quota_exceeded",
			message: "Usage rate limit or daily quota exceeded for hosted agents.",
		});
	}

	const isStream = body.stream === true || req.headers.get("Accept") === "text/event-stream";

	// Execute Gemini generation
	try {
		const geminiPayload = {
			contents: body.contents ?? [{ role: "user", parts: [{ text: "Hello" }] }],
			systemInstruction: body.systemInstruction,
			generationConfig: body.generationConfig ?? { maxOutputTokens: 2048, temperature: 0.2 },
			tools: body.tools,
		};

		if (isStream) {
			const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-goog-api-key": geminiApiKey,
					"Accept": "text/event-stream",
				},
				body: JSON.stringify(geminiPayload),
			});

			if (!geminiRes.ok || !geminiRes.body) {
				await admin.from("agent_usage").update({ status: "voided" }).eq("request_id", requestId);
				return json(req, requestId, 502, {
					error: "provider_error",
					message: `Hosted Gemini stream failed (HTTP ${geminiRes.status}).`,
				});
			}

			let streamedBytes = 0;
			let streamFinished = false;
			const transform = new TransformStream<Uint8Array, Uint8Array>({
				transform(chunk, controller) {
					streamedBytes += chunk.byteLength;
					controller.enqueue(chunk);
				},
				async flush() {
					streamFinished = true;
					const estimatedUnits = Math.max(1, Math.ceil(streamedBytes / 16));
					try {
						await admin.from("agent_usage").update({
							output_units: estimatedUnits,
							status: "recorded",
						}).eq("request_id", requestId);
					} catch {
						// Stream completed, settlement logging is best effort
					}
				},
			});

			req.signal.addEventListener("abort", async () => {
				if (!streamFinished) {
					try {
						await admin.from("agent_usage").update({ status: "voided" }).eq("request_id", requestId);
					} catch {
						// Abort voiding is best effort
					}
				}
			});

			return new Response(geminiRes.body.pipeThrough(transform), {
				status: 200,
				headers: {
					...corsHeaders(req),
					"Content-Type": "text/event-stream",
					"Cache-Control": "no-cache",
					"x-request-id": requestId,
				},
			});
		}

		const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-goog-api-key": geminiApiKey,
			},
			body: JSON.stringify(geminiPayload),
		});

		if (!geminiRes.ok) {
			const status = geminiRes.status;
			await admin.from("agent_usage").update({ status: "voided" }).eq("request_id", requestId);
			if (status === 400 || status === 401 || status === 403) {
				return json(req, requestId, 502, {
					error: "provider_auth_error",
					message: "Hosted provider credential was rejected.",
				});
			}
			if (status === 429) {
				return json(req, requestId, 429, {
					error: "provider_rate_limited",
					message: "Hosted Gemini provider is rate limited. Please retry.",
				});
			}
			return json(req, requestId, 502, {
				error: "provider_error",
				message: `Hosted Gemini returned HTTP ${status}.`,
			});
		}

		const geminiData = await geminiRes.json() as JsonRecord;
		const candidates = Array.isArray(geminiData.candidates) ? geminiData.candidates : [];
		const firstCandidate = candidates[0] as JsonRecord | undefined;
		const content = firstCandidate && typeof firstCandidate.content === "object" ? firstCandidate.content as JsonRecord : undefined;
		const parts = content && Array.isArray(content.parts) ? content.parts : [];
		const text = parts.map(p => (typeof p === "object" && p !== null && "text" in p ? String(p.text) : "")).join("");

		if (text.length > MAX_OUTPUT_BYTES) {
			await admin.from("agent_usage").update({ status: "voided" }).eq("request_id", requestId);
			return json(req, requestId, 502, {
				error: "response_too_large",
				message: "Model response exceeded output limit.",
			});
		}

		// Settle usage record
		await admin.from("agent_usage").update({
			output_units: Math.ceil(text.length / 4),
			status: "recorded",
		}).eq("request_id", requestId);

		return json(req, requestId, 200, {
			model,
			text: text.slice(0, 16_000),
			candidate: firstCandidate,
		});
	} catch {
		await admin.from("agent_usage").update({ status: "voided" }).eq("request_id", requestId);
		return json(req, requestId, 502, {
			error: "provider_error",
			message: "Error executing hosted agent generation.",
		});
	}
});
