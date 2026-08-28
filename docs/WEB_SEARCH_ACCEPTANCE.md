# Web search acceptance

Automated evidence required before deploy: client typecheck, Magnus extension tests, migration/RLS/secrets static gates, hybrid unit tests (URL policy, budget, partial scrape, provider-wide Firecrawl failure, private URL, cancellation, prompt-injection clipping), and tool-loop regression tests.

Live scenarios:

1. Current fact — signed-in hosted hybrid returns cited URLs with at least one Firecrawl-enriched source.
2. Official docs query — LinkUp ranks discovery; Firecrawl scrapes the strongest pages.
3. GitHub/coding research query — deep mode may add Firecrawl Search `github` without duplicate scrape of already-markdown results.
4. Known URL deeper fetch — `prebase_web_fetch` returns bounded markdown for one public URL.
5. Cancellation during provider activity — no retry storm; in-flight work aborts.
6. LinkUp timeout — safe `search_unavailable` without leaking keys.
7. Firecrawl scrape partial failure — remaining enriched sources returned with `enrichment: partial`.
8. Firecrawl unavailable — error, not silent LinkUp-only success.
9. Quota exhausted — 429 `quota_exceeded`.
10. Malformed/private URL fetch — rejected before provider call.
11. Prompt-injection text in fetched page — treated as source data; no secret produced; policy unchanged.
12. Max-context/truncation — payload under 16k; URL/title survive; `contentTruncated` is true.
13. Signed-out behavior — hosted path fails closed without provider calls.
14. Local BYOK — hybrid only when both keys exist; one key does not pretend hybrid verification occurred.

Manual evidence still required for hosted Edge deploy: operator `supabase functions deploy web-search` and `supabase db push` after reviewing this change. This repository change does not silently deploy.

Inspect deployment/runtime logs only for metadata; no query, result body, bearer token, or provider secret may appear.
