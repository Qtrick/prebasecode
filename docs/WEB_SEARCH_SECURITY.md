# Web search security

- Authenticated Supabase JWT is required for hosted hybrid web context; no anonymous search route exists.
- `LINKUP_API_KEY` and `FIRECRAWL_API_KEY` are read only inside the Edge Function (hosted) or local developer SecretStorage/.env (BYOK). Hosted keys are never sent to, stored by, or logged from the desktop.
- Gateway validation rejects unknown fields, oversized bodies, invalid dates/domains/depth, private/localhost URLs, and excessive result counts.
- Fetch and scrape accept only public `http`/`https` destinations. Localhost, loopback, link-local, private-network hosts, and URLs with embedded user credentials are rejected on both desktop and Edge (Edge is authoritative).
- The gateway uses strict local/desktop CORS, product timeouts tighter than provider maxima, one bounded retry for transient upstream errors, per-user atomic rate/daily quota reservation, and generic error responses. Desktop does not retry the Edge call.
- Search and fetch content is untrusted data. Magnus is instructed to cite original page URLs and ignore web-page instructions, prompt injections, and policy overrides. Provider names are not cited as sources of facts.
- A provider-wide Firecrawl outage is returned as an error, not as LinkUp-only verified evidence. Per-source scrape failure may return partial enrichment.
- `web_search_usage` contains metadata only (user, request id, operation kind, depth/units/status, provider operation counts); RLS is enabled and clients have no table privileges. Only the service-role gateway records quota use.
