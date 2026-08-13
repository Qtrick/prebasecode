# Gemini Authentication and Model Security Research — August 2026

Research date: **2026-08-13**. Sources: [Google Gemini API key
guide](https://ai.google.dev/gemini-api/docs/api-key), [model
catalog](https://ai.google.dev/gemini-api/docs/models), and [function-calling
guide](https://ai.google.dev/gemini-api/docs/function-calling).

## Current provider guidance

Google distinguishes standard API keys from authorization keys. New AI Studio
keys default to authorization keys; unrestricted standard keys are rejected now,
and Google states that standard keys will be rejected in September 2026. The
current REST examples authenticate with `x-goog-api-key`; no query-string key is
needed by the supported PreBase `generateContent` REST path.

## PreBase decision

- Store the desktop credential in VS Code SecretStorage, not workspace `.env`.
- Send it only in `x-goog-api-key` over HTTPS. Query-string authentication is
  removed so keys cannot enter request URLs, proxy URLs, or URL-shaped errors.
- Existing standard or authorization keys use the same header. Users with a
  rejected legacy key must create/restrict an AI Studio authorization key and
  update it in PreBase provider settings; PreBase never logs the credential.
- The raw client remains for this pass: it avoids an additional activation-time
  SDK dependency, but it must preserve the exact function-calling protocol for
  every advertised model.

## Model inventory decision

The current catalog lists `gemini-2.5-flash` and `gemini-2.5-pro` as current
models, and identifies `gemini-2.0-flash` as shut down. Gemini 1.5 models are
not in the current catalog. PreBase removes the obsolete picker entries and
retains the two 2.5 models. It intentionally does not advertise Gemini 3
thinking models: Google documents thought-signature handling for those models,
and the current raw REST conversation adapter does not preserve that context.

## Residual risk

Gemini credentials still authorize direct user-selected provider traffic from
the desktop extension. SecretStorage protects at rest; users must also apply
provider-side key restrictions and rotate suspected leaks. The client needs
ongoing protocol review before any Gemini 3 model is exposed.
