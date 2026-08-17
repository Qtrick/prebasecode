# PreBase AI Assurance Report (ai-run-2026-08-17T01-25-00-920Z)

**Timestamp**: 2026-08-17T01:25:00.921Z
**Overall Status**: **FAIL**
**Source Root**: Verified PreBase Root

## Provider Status

| Provider | Status | Source | Models Available |
| --- | --- | --- | --- |
| **Google Gemini** | 🟢 Connected | `root-env` | 0 models |
| **LinkUp Search** | 🟢 Connected | `root-env` | Direct Web Search |

## Verification Tests

| Test Case | Status | Duration | Details |
| --- | --- | --- | --- |
| PreBase root repository verification | **PASS** | N/A | Verified product.json, package.json, and AGENTS.md markers. |
| PreBase Magnus compiled runtime readiness | **FAIL** | N/A | compiled Magnus output is older than sources (stale by 131s) |
| Arbitrary workspace folder isolation | **PASS** | N/A | Verified that non-PreBase folders cannot be scanned for .env credentials. |
| Gemini live model discovery & consumer curation | **FAIL** | N/A | fetch failed |
| Gemini live content generation (gemini-2.5-flash) | **FAIL** | N/A | fetch failed |
| Gemini function-calling protocol (parametersJsonSchema + additionalProperties) | **FAIL** | N/A | fetch failed |
| LinkUp live search query execution | **FAIL** | N/A | fetch failed |

## Curated Gemini Models

| Model ID | Display Name | Context Window (Input) | Output Tokens |
| --- | --- | --- | --- |

---
*Privacy & Zero-Leakage Notice: No API keys, prompts, or sensitive credentials are stored in this report.*