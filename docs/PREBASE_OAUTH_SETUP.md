# PreBase OAuth Setup, Redirect Topology, and Threat Model

## 1. Redirect Topology

The PreBase desktop application uses a standard PKCE authorization code exchange coordinated through Supabase Auth and Google Cloud:

```
[ PreBase Desktop App ]
        |
        | 1. Opens system browser:
        |    https://<project-ref>.supabase.co/auth/v1/authorize
        |      ?provider=google
        |      &redirect_to=prebase://auth/callback
        |      &flow_type=pkce
        |      &code_challenge=<S256_challenge>
        |      &code_challenge_method=S256
        |      &state=<random_state>
        |      &scopes=openid+email+profile
        v
[ Supabase Auth Server ]
        |
        | 2. Redirects browser to Google OAuth consent
        v
[ Google OAuth 2.0 Consent ]
        |
        | 3. User approves -> Google redirects back to:
        |    https://<project-ref>.supabase.co/auth/v1/callback?code=...&state=...
        v
[ Supabase Auth Server ]
        |
        | 4. Validates Google token exchange, provisions/links user account,
        |    generates PKCE authorization code, and redirects browser to:
        |    prebase://auth/callback?code=<pkce_auth_code>&state=<random_state>
        v
[ PreBase Custom Protocol Handler (prebase://auth/callback) ]
        |
        | 5. Validates matching state, live attempt (<5 min), and one-time use;
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
     - **Redirect URLs**: Must allowlist `prebase://auth/callback`.

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
   - The protocol handler accepts only URLs matching `prebase://auth/callback`.
   - The returned `state` parameter must match the in-flight attempt's `state` exactly.
   - Expired attempts (> 5 minutes) and replayed URLs are immediately rejected.
4. **OS Keychain Secret Storage**:
   - Tokens (`access_token`, `refresh_token`) are stored in OS-backed `SecretStorage` (macOS Keychain, Windows Credential Manager, Linux Secret Service).
   - Sessions are refreshed atomically and cleared securely on sign-out.
