# Web search privacy

Search is user-initiated by the agent only when current external evidence is needed. Local workspace facts should use local tools instead. Users must not supply secrets, credentials, access tokens, private keys, or whole source files in queries.

The service sends the minimal query/filter request to LinkUp. Query text and returned content are not persisted or logged by PreBase. The returned excerpts are bounded and marked untrusted. Cloud authentication tokens remain in OS-backed SecretStorage; no provider credential reaches the client.
