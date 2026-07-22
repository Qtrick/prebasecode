/**
 * PreBase agent-gateway (skeleton).
 * Auth required; provider routing not wired. Never log Authorization or tokens.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const MAX_BODY_BYTES = 32_768;
const MODEL_ALLOWLIST = new Set([
	"gpt-4.1-mini",
	"gpt-4.1",
	"claude-sonnet-4",
	"gemini-2.0-flash",
]);

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
	return req.headers.get("x-request-id") ?? crypto.randomUUID();
}

function corsHeaders(req: Request): HeadersInit {
	const origin = req.headers.get("Origin");
	const allowOrigin =
		origin && isAllowedOrigin(origin) ? origin : "http://127.0.0.1";
	return {
		"Access-Control-Allow-Origin": allowOrigin,
		"Access-Control-Allow-Headers":
			"authorization, apikey, content-type, x-client-info, x-request-id",
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

function parseModel(body: JsonRecord): string | null {
	const model = body.model;
	return typeof model === "string" && model.length > 0 ? model : null;
}

Deno.serve(async (req) => {
	const requestId = requestIdFrom(req);

	if (req.method === "OPTIONS") {
		return new Response(null, { status: 204, headers: corsHeaders(req) });
	}

	const url = new URL(req.url);
	if (req.method === "GET") {
		if (url.pathname.endsWith("/health")) {
			return json(req, requestId, 200, {
				status: "ok",
				service: "agent-gateway",
				wired: false,
			});
		}
		return json(req, requestId, 405, { error: "method_not_allowed" });
	}

	if (req.method !== "POST") {
		return json(req, requestId, 405, { error: "method_not_allowed" });
	}

	const contentLength = req.headers.get("Content-Length");
	if (contentLength) {
		const n = Number(contentLength);
		if (Number.isFinite(n) && n > MAX_BODY_BYTES) {
			return json(req, requestId, 413, { error: "payload_too_large" });
		}
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

	const model = parseModel(body);
	if (!model || !MODEL_ALLOWLIST.has(model)) {
		return json(req, requestId, 400, {
			error: "model_not_allowed",
			message: "Model is missing or not on the gateway allowlist.",
		});
	}

	// Stub: fail closed if usage ledger cannot be queried (rate-limit hook point).
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
	const { error: usageProbeError } = await admin
		.from("agent_usage")
		.select("id")
		.limit(1);
	if (usageProbeError) {
		return json(req, requestId, 503, {
			error: "usage_check_unavailable",
			message: "Usage ledger unavailable; gateway is closed.",
		});
	}

	return json(req, requestId, 501, {
		error: "not_implemented",
		message: "Agent gateway is authenticated but not fully wired to providers.",
		model,
	});
});
