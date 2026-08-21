# PreBase OAuth Setup, Redirect Topology, and Threat Model

## 1. Redirect Topology

The PreBase desktop application uses a standard PKCE authorization code exchange coordinated through Supabase Auth and Google Cloud:

```
[ PreBase Desktop App ]
        |
        | 1. Opens system browser:
        |    https://<project-ref>.supabase.co/auth/v1/authorize
        |      ?provider=google
        |      &redirect_to=prebase://auth/callback?sb_flow_id=<app_flow_id>
        |      &code_challenge=<sha256_challenge>
        |      &code_challenge_method=s256
        |      &scopes=openid+email+profile
        v
[ Supabase Auth Server ]
        |
        | 2. Redirects browser to Google OAuth consent
        v
[ Google OAuth 2.0 Consent ]
        |
        | 3. User approves -> Google redirects back to:
        |    https://<project-ref>.supabase.co/auth/v1/callback?code=...&state=<supabase_flow_state>
        v
[ Supabase Auth Server ]
        |
        | 4. Validates Google token exchange, provisions/links user account,
        |    generates PKCE authorization code, and redirects browser to:
        |    prebase://auth/callback?sb_flow_id=<app_flow_id>&code=<pkce_auth_code>
        v
[ PreBase Custom Protocol Handler (prebase://auth/callback) ]
        |
        | 5. Validates the matching application flow ID, live attempt (<5 min), and one-time use;
        |    POSTs to Supabase token endpoint:
        |    https://<project-ref>.supabase.co/auth/v1/token?grant_type=pkce
        |    Body: { "auth_code": "...", "code_verifier": "..." }
        |    Headers: { "apikey": "<publishable_key>" }
        v
[ Supabase Auth Server ]
        |
        | 6. Returns { access_token, refresh_token, user }
        v
[ PreBase SecretStorage (OS Keychain) ]
        - Saves tokens securely
        - Sets account state to `signedIn`
```

---

## 2. Operator Setup

1. **Supabase Cloud URL & Publishable Key**:
   - Out of the box, PreBase is configured with the official hosted project:
     - URL: `https://mvfopbkhftgmcwdpqrww.supabase.co`
     - Key: `sb_publishable_P3F3RJiePsPe3pz3s72S9A_rCiV8Edx`
   - Users or self-hosters may override these via `prebase.cloud.url` and `prebase.cloud.publishableKey` in settings.
   - Any attempt to configure elevated secret keys (`sb_secret_...` or service role keys) is strictly rejected client-side.

2. **Google Cloud Console Configuration**:
   - In the Google Cloud Console for the OAuth 2.0 Client ID:
     - **Authorized redirect URIs**: Must contain `https://mvfopbkhftgmcwdpqrww.supabase.co/auth/v1/callback`.
     - Google never redirects directly to `prebase://` because custom URI schemes are routed through the intermediate identity broker (Supabase).

3. **Supabase Dashboard Configuration**:
   - In Supabase Auth -> Providers -> Google:
     - Enable Google Provider.
     - Enter Google Client ID and Google Client Secret.
   - In Supabase Auth -> URL Configuration:
     - **Redirect URLs**: Must allowlist the `prebase://auth/callback` query variant used for `sb_flow_id` (for example an appropriate wildcard rule). Supabase matches the full redirect URL, including its query.

4. **Minimal Scopes**:
   - Google: `openid`, `email`, `profile`.
   - GitHub: `read:user`, `user:email`.
   - No repository, write, or management scopes are ever requested.

---

## 3. Threat Model & Security Invariants

1. **Zero Secret Exposure**:
   - Provider client secrets (Google Client Secret, GitHub Client Secret) remain strictly in Supabase server settings and never touch the desktop binary, source code, or network traffic to the client.
2. **Cryptographic PKCE Verifier**:
   - A 48-byte URL-safe cryptographically random string is generated for each attempt.
   - The SHA-256 base64url challenge is sent in `/authorize`.
   - The plain verifier is held strictly in memory, never persisted to disk, and consumed immediately upon exchange.
3. **Strict Callback Validation**:
   - Supabase creates and validates the provider OAuth `state` used between Google and Supabase. PreBase does not send an application-owned top-level `state` to `/authorize`.
   - The protocol handler accepts only URLs matching `prebase://auth/callback` with one `sb_flow_id` and one `code` query parameter.
   - Implicit grant tokens in URL fragments (`#access_token=...`, `#id_token=...`) are strictly rejected.
   - The returned `sb_flow_id` must match the in-memory attempt exactly. It is correlation data, not the PKCE verifier and not a provider OAuth state.
   - Expired attempts (> 5 minutes) and replayed URLs are immediately rejected.
4. **OS Keychain Secret Storage & Concurrency Serialization**:
   - Tokens (`access_token`, `refresh_token`) are stored in OS-backed `SecretStorage` (macOS Keychain, Windows Credential Manager, Linux Secret Service).
   - Concurrent token refreshes are serialized behind an in-flight promise mutex to prevent single-use refresh token burn races.
   - Sessions are refreshed atomically and cleared securely on sign-out.
5. **Elevated Key Diagnostics**:
   - Client-side configuration parsing strictly forbids secret/service-role keys (`sb_secret_*`, `service_role`, `supabase_admin`) using browser-safe base64url payload inspection.

## 4. Protocol Sources and Acceptance Boundary

The implementation is checked against current primary sources rather than assuming SDK behavior:

- Supabase Auth's external authorization handler owns the provider `state` and creates the server-side flow state: <https://github.com/supabase/auth/blob/master/internal/api/external.go>
- Supabase Auth JS documents the `sb_flow_id` redirect correlation mechanism for PKCE flows: <https://github.com/supabase/supabase-js/blob/master/packages/core/auth-js/src/lib/types.ts>
- Supabase local sign-out scope is documented at <https://supabase.com/docs/guides/auth/signout>.
- Electron's custom-protocol lifecycle, including macOS `open-url` and Windows/Linux second-instance delivery, is documented at <https://www.electronjs.org/docs/latest/tutorial/launch-app-from-url-in-another-app>.

Unit and integration tests can prove URL construction, callback strictness, replay rejection, token storage, and refresh serialization. They cannot prove Google console configuration, Supabase redirect allowlisting, provider consent, or OS protocol registration in a packaged application. Those remain manual/operator acceptance and must be reported as `BLOCKED` until exercised live.
