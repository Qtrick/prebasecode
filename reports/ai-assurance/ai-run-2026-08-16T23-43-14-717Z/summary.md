# PreBase AI Assurance Report (ai-run-2026-08-16T23-43-14-717Z)

**Timestamp**: 2026-08-16T23:43:14.719Z
**Overall Status**: **FAIL**
**Source Root**: Verified PreBase Root

## Provider Status

| Provider | Status | Source | Models Available |
| --- | --- | --- | --- |
| **Google Gemini** | 🟢 Connected | `root-env` | 8 models |
| **LinkUp Search** | 🟢 Connected | `root-env` | Direct Web Search |

## Verification Tests

| Test Case | Status | Duration | Details |
| --- | --- | --- | --- |
| PreBase root repository verification | **PASS** | N/A | Verified product.json, package.json, and AGENTS.md markers. |
| PreBase Magnus compiled runtime readiness | **PASS** | N/A | Verified out/extension.js and compiled runtime modules. |
| Arbitrary workspace folder isolation | **PASS** | N/A | Verified that non-PreBase folders cannot be scanned for .env credentials. |
| Gemini live model discovery & consumer curation | **PASS** | 281ms | Discovered 50 raw models; curated to 8 stable consumer models (0 preview, 0 experimental). |
| Gemini live content generation (gemini-2.5-flash) | **FAIL** | 430ms | Model returned HTTP 200 but 0-length text content. |
| Gemini function-calling protocol (parametersJsonSchema + additionalProperties) | **PASS** | 695ms | Generated tool call 'get_current_time' (thoughtSignature present: true). |
| Gemini multi-turn tool response continuation with thoughtSignature | **PASS** | 470ms | Synthesized tool result into final response (54 chars). |
| LinkUp live search query execution | **PASS** | 2313ms | Returned 20 sources successfully. |

## Curated Gemini Models

| Model ID | Display Name | Context Window (Input) | Output Tokens |
| --- | --- | --- | --- |
| `gemini-2.5-flash` | Gemini 2.5 Flash | 1,048,576 tokens | 65,536 tokens |
| `gemini-2.5-pro` | Gemini 2.5 Pro | 1,048,576 tokens | 65,536 tokens |
| `gemini-2.5-flash-image` | Nano Banana | 32,768 tokens | 32,768 tokens |
| `gemini-3-pro-image` | Nano Banana Pro | 131,072 tokens | 32,768 tokens |
| `gemini-3.1-flash-image` | Nano Banana 2 | 65,536 tokens | 65,536 tokens |
| `gemini-3.5-flash` | Gemini 3.5 Flash | 1,048,576 tokens | 65,536 tokens |
| `gemini-3.6-flash` | Gemini 3.6 Flash | 1,048,576 tokens | 65,536 tokens |
| `gemini-3.7-flash` | Gemini 3.7 Flash | 1,048,576 tokens | 65,536 tokens |

---
*Privacy & Zero-Leakage Notice: No API keys, prompts, or sensitive credentials are stored in this report.*