# Web search architecture

`Magnus → prebase_web_search / prebase_web_fetch → hybrid web context → LinkUp discovery + Firecrawl enrichment`.

Hosted (signed-in release) path:

`desktop command → IPreBaseWebSearchService → Supabase web-search Edge Function → LinkUp + Firecrawl`.

The desktop sends only the validated request plus the signed-in user JWT and Supabase publishable key. Hosted `LINKUP_API_KEY` and `FIRECRAWL_API_KEY` stay in Edge Function secrets and never reach the desktop.

Local source-development path uses hybrid BYOK only when **both** local keys exist. A single local key does not silently degrade to LinkUp-only or Firecrawl-only search. Known-URL `prebase_web_fetch` may use a local Firecrawl key because fetch is enrichment of one public URL, not discovery.

The Edge Function authenticates the JWT, reserves an atomic metadata-only quota row, runs LinkUp `outputType=searchResults`, scrapes the strongest public URLs with Firecrawl `/v2/scrape`, bounds the payload under the Magnus 16k single-tool budget, and returns source URLs. It neither stores nor logs queries or result bodies. `agent-gateway` remains intentionally disabled (501, BETA-035) and is not on this path.

Firecrawl Map, Crawl, Monitor, and Interact are not product tools in this version. Map/Crawl remain a future bounded documentation-site ingestion path. Monitor is for recurring change detection, not the synchronous agent tool. Interact (Playwright/Python/Bash) stays out of Magnus until a separately approved, gated action surface exists.
