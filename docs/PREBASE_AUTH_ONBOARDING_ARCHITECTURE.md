# PreBase auth and onboarding architecture

PreBase owns the product authentication gate. It is separate from VS Code's welcome/onboarding contribution, which remains an upstream optional welcome experience and is not an identity boundary for PreBase.

At `AfterRestored`, the startup contribution waits for `IPreBaseAccountService.whenInitialSessionResolved()`. A valid restored session opens no authentication UI. Otherwise it shows the PreBase provider gate for that application process. Choosing **Continue Offline** is an in-memory dismissal only; the next application session asks again. Once the user signs in or continues offline, the contribution opens the versioned `PreBaseOnboardingEditor` only when its onboarding version is incomplete. This makes that editor the sole canonical PreBase first-run flow.

The account service owns a single OAuth PKCE transaction: it generates state and verifier, opens the system browser, consumes only `prebase://auth/callback`, validates the exact callback authority/path and state, exchanges the one-time code, and writes only the resulting PreBase access/refresh session through the existing SecretStorage adapter. Transactions expire after five minutes and are never persisted or logged. GitHub and Google are the only public providers.

The cloud service remains optional. A failed restore or disconnected service leaves local editing, graphs, terminal, and Agent features available; the gate offers an explicit local/offline continuation. It does not use VS Code account state, Copilot setup, or the default chat agent.
