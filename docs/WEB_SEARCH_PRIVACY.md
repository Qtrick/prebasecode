# Web search privacy

Search is user-initiated by the agent only when current external evidence is needed. Local workspace facts should use local tools instead. Users must not supply secrets, credentials, access tokens, private keys, or whole source files in queries.

## Hosted mode

The desktop talks only to the configured Supabase project (`/functions/v1/web-search`). It does not connect to `api.linkup.so` or `api.firecrawl.dev`. The Edge Function sends the minimal query/filter request to LinkUp and selected public URLs to Firecrawl. Query text and returned content are not persisted or logged by PreBase.

## Local BYOK

When both LinkUp and Firecrawl keys are present in source development, Magnus may call those provider APIs directly from the desktop. That path is explicit developer BYOK, not the signed-in product path.

## Third-party retention

PreBase does not persist query text or result bodies. Search-discovered public pages permit Firecrawl caching (`storeInCache: true`; normal freshness uses a modest cache age and fresh/current queries use `maxAge: 0`). Explicit user-supplied fetches set `storeInCache: false` to avoid provider caching of a URL that may contain sensitive query parameters. This repository does not claim Firecrawl zero-data-retention unless the deployed account and request mode actually enable it.

Cloud authentication tokens remain in OS-backed SecretStorage; no hosted provider credential reaches the client.
