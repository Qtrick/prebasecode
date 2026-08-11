# Web search architecture

`Magnus → prebase_web_search → prebase.webSearch.searchForMagnus → IPreBaseWebSearchService → Supabase web-search Edge Function → LinkUp`.

The desktop sends only the validated request plus the signed-in user JWT and Supabase publishable key. The Edge Function authenticates the JWT, reserves an atomic metadata-only quota row, calls LinkUp with its Edge secret, normalizes bounded source excerpts, and returns source URLs. It neither stores nor logs queries or result bodies. `agent-gateway` remains intentionally disabled (501, BETA-035) and is not on this path.
