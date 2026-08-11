# LinkUp research — 2026-08

PreBase uses LinkUp only through a server-side Edge Function. The integration uses `POST /v1/search`, `Authorization: Bearer`, `outputType: "searchResults"`, and explicit depth. LinkUp documents `fast` as sub-second retrieval, `standard` as its normal 1–3 second search, and `deep` as a longer multi-step search; PreBase defaults to `standard`, bounds `deep`, and never exposes the provider credential. Sources: [LinkUp search overview](https://docs.linkup.so/pages/documentation/get-started/for-agents), [search reference](https://docs.linkup.so/pages/documentation/endpoints/search/reference), [depth guidance](https://docs.linkup.so/pages/documentation/endpoints/search/best-practices).

No LinkUp SDK, MCP server, API key, or provider URL belongs in the desktop extension. The native model-facing name is vendor-neutral: `prebase_web_search`.
