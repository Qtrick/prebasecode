# PreBase AI Assurance Report (ai-run-2026-08-16T17-29-59-832Z)

**Timestamp**: 2026-08-16T17:29:59.832Z
**Overall Status**: **PASS**
**Source Root**: Verified PreBase Root

## Provider Status

| Provider | Status | Source | Models Available |
| --- | --- | --- | --- |
| **Google Gemini** | 🟢 Connected | `root-env` | 37 models |
| **LinkUp Search** | 🟢 Connected | `root-env` | Direct Web Search |

## Verification Tests

| Test Case | Status | Duration | Details |
| --- | --- | --- | --- |
| PreBase root repository verification | **PASS** | N/A | Verified product.json, package.json, and AGENTS.md markers. |
| PreBase Magnus compiled runtime readiness | **PASS** | N/A | Verified out/extension.js and compiled runtime modules. |
| Arbitrary workspace folder isolation | **PASS** | N/A | Verified that non-PreBase folders cannot be scanned for .env credentials. |
| Gemini live model discovery | **PASS** | 171ms | Discovered 50 models, 37 compatible with Agents. |
| Gemini live content generation (gemini-2.5-flash) | **PASS** | 444ms | Received response (0 chars). |
| Gemini function-calling protocol (parametersJsonSchema + additionalProperties) | **PASS** | 936ms | Generated tool call 'get_current_time' (thoughtSignature present: true). |
| Gemini multi-turn tool response continuation with thoughtSignature | **PASS** | 565ms | Synthesized tool result into final response (54 chars). |
| LinkUp live search query execution | **PASS** | 1275ms | Returned 3 sources successfully. |

## Discovered Compatible Gemini Models

| Model ID | Display Name | Context Window (Input) | Output Tokens |
| --- | --- | --- | --- |
| `gemini-2.5-flash` | Gemini 2.5 Flash | 1,048,576 tokens | 65,536 tokens |
| `gemini-2.5-pro` | Gemini 2.5 Pro | 1,048,576 tokens | 65,536 tokens |
| `gemini-2.5-flash-preview-tts` | Gemini 2.5 Flash Preview TTS | 8,192 tokens | 16,384 tokens |
| `gemini-2.5-pro-preview-tts` | Gemini 2.5 Pro Preview TTS | 8,192 tokens | 16,384 tokens |
| `gemma-4-26b-a4b-it` | Gemma 4 26B A4B IT | 262,144 tokens | 32,768 tokens |
| `gemma-4-31b-it` | Gemma 4 31B IT | 262,144 tokens | 32,768 tokens |
| `gemini-flash-latest` | Gemini Flash Latest | 1,048,576 tokens | 65,536 tokens |
| `gemini-flash-lite-latest` | Gemini Flash-Lite Latest | 1,048,576 tokens | 65,536 tokens |
| `gemini-pro-latest` | Gemini Pro Latest | 1,048,576 tokens | 65,536 tokens |
| `gemini-2.5-flash-lite` | Gemini 2.5 Flash-Lite | 1,048,576 tokens | 65,536 tokens |
| `gemini-2.5-flash-image` | Nano Banana | 32,768 tokens | 32,768 tokens |
| `gemini-3-flash-preview` | Gemini 3 Flash Preview | 1,048,576 tokens | 65,536 tokens |
| `gemini-3.1-pro-preview` | Gemini 3.1 Pro Preview | 1,048,576 tokens | 65,536 tokens |
| `gemini-3.1-pro-preview-customtools` | Gemini 3.1 Pro Preview Custom Tools | 1,048,576 tokens | 65,536 tokens |
| `gemini-3.1-flash-lite-preview` | Gemini 3.1 Flash Lite Preview | 1,048,576 tokens | 65,536 tokens |
| `gemini-3.1-flash-lite` | Gemini 3.1 Flash Lite | 1,048,576 tokens | 65,536 tokens |
| `gemini-3-pro-image-preview` | Nano Banana Pro | 131,072 tokens | 32,768 tokens |
| `gemini-3-pro-image` | Nano Banana Pro | 131,072 tokens | 32,768 tokens |
| `nano-banana-pro-preview` | Nano Banana Pro | 131,072 tokens | 32,768 tokens |
| `gemini-3.1-flash-image-preview` | Nano Banana 2 | 65,536 tokens | 65,536 tokens |
| `gemini-3.1-flash-image` | Nano Banana 2 | 65,536 tokens | 65,536 tokens |
| `gemini-3.1-flash-lite-image` | Nano Banana 2 Lite | 65,536 tokens | 65,536 tokens |
| `gemini-3.5-flash` | Gemini 3.5 Flash | 1,048,576 tokens | 65,536 tokens |
| `gemini-3.5-flash-lite` | Gemini 3.5 Flash Lite | 1,048,576 tokens | 65,536 tokens |
| `gemini-omni-flash-preview` | Gemini Omni Flash Preview | 131,072 tokens | 65,536 tokens |
| `gemini-3.6-flash` | Gemini 3.6 Flash | 1,048,576 tokens | 65,536 tokens |
| `gemini-3.7-flash` | Gemini 3.7 Flash | 1,048,576 tokens | 65,536 tokens |
| `lyria-3-clip-preview` | Lyria 3 Clip Preview | 1,048,576 tokens | 65,536 tokens |
| `lyria-3-pro-preview` | Lyria 3 Pro Preview | 1,048,576 tokens | 65,536 tokens |
| `gemini-3.1-flash-tts-preview` | Gemini 3.1 Flash TTS Preview | 8,192 tokens | 16,384 tokens |
| `gemini-robotics-er-1.6-preview` | Gemini Robotics-ER 1.6 Preview | 131,072 tokens | 65,536 tokens |
| `gemini-robotics-er-2-preview` | Gemini Robotics-ER 2 Preview | 131,072 tokens | 65,536 tokens |
| `gemini-2.5-computer-use-preview-10-2025` | Gemini 2.5 Computer Use Preview 10-2025 | 131,072 tokens | 65,536 tokens |
| `antigravity-preview-05-2026` | Antigravity Agent Preview | 131,072 tokens | 65,536 tokens |
| `deep-research-max-preview-04-2026` | Deep Research Max Preview (Apr-21-2026) | 131,072 tokens | 65,536 tokens |
| `deep-research-preview-04-2026` | Deep Research Preview (Apr-21-2026) | 131,072 tokens | 65,536 tokens |
| `deep-research-pro-preview-12-2025` | Deep Research Pro Preview (Dec-12-2025) | 131,072 tokens | 65,536 tokens |

---
*Privacy & Zero-Leakage Notice: No API keys, prompts, or sensitive credentials are stored in this report.*