# Web search security

- Authenticated Supabase JWT is required; no anonymous search route exists.
- `LINKUP_API_KEY` is read only inside the Edge Function and never sent to, stored by, or logged from the desktop.
- Gateway validation rejects unknown fields, oversized bodies, invalid dates/domains/depth, and excessive result counts.
- The gateway uses strict local/desktop CORS, deadlines, one bounded retry for transient upstream errors, per-user atomic rate/daily quota reservation, and generic error responses.
- Search content is untrusted. Magnus is instructed to cite URLs and ignore web-page instructions, prompt injections, and policy overrides.
- `web_search_usage` contains metadata only (user, request id, depth/units/status/count); RLS is enabled and clients have no table privileges. Only the service-role gateway records quota use.
