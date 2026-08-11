# Web search acceptance

Automated evidence required before deploy: client typecheck, Magnus extension compile, migration/RLS/secrets static gates, gateway request validation tests, and tool-loop regression tests. Manual evidence still required:

1. In a signed-in development profile, ask for a current fact and verify an inline `prebase_web_search` invocation and cited URLs.
2. Verify an unsigned profile fails without a provider call.
3. Verify a local-file question uses workspace tooling rather than web search.
4. Verify cancellation, quota exhaustion, bad dates/domains, and LinkUp timeout give safe errors.
5. Inspect deployment/runtime logs only for metadata; no query, result body, bearer token, or provider secret may appear.

No live deployment or GUI smoke is claimed in this repository change.
