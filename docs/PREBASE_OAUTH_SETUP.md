# PreBase OAuth setup and threat model

## Operator setup

1. Configure `prebase.cloud.url` and `prebase.cloud.publishableKey` with an HTTPS Supabase project URL and its publishable/anon key.
2. In Supabase Auth, enable only GitHub and Google for the public PreBase flow. Configure each provider's client ID and client secret in the Supabase dashboard; never place those provider secrets in the desktop product.
3. Allow the exact redirect URL `prebase://auth/callback` in Supabase's redirect URL configuration and register the same callback in each provider dashboard as required by that provider's Supabase integration.
4. Request only identity/profile/email scopes. PreBase requests GitHub `read:user user:email` and Google `openid email profile`; it never asks for repository, workflow, or write scopes.

Supabase documents the PKCE code exchange and its local verifier requirement in its [PKCE flow guide](https://supabase.com/docs/guides/auth/sessions/pkce-flow). GitHub documents that `user:email` grants read-only access to private email addresses in its [OAuth scope guide](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps).

## Threat model

The desktop app generates a cryptographically random state and PKCE verifier for one in-memory flow. The verifier is SHA-256 challenged in the authorization URL, never persisted, and removed before code exchange. The callback handler accepts only the product protocol, `auth` authority, `/callback` path, matching state, a live five-minute attempt, and one use. A code, state, verifier, token, or complete callback URL is never logged.

The callback code is exchanged directly with Supabase using `grant_type=pkce`; only the returned access and refresh tokens enter the existing SecretStorage session adapter. Supabase describes PKCE codes as single-use and verifier-bound in its [OAuth flow documentation](https://supabase.com/docs/guides/auth/oauth-server/oauth-flows). Browser opening uses the workbench external opener, so the authorization page runs in the system browser rather than an embedded product view.
