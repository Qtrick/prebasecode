# LinkUp integration

LinkUp is the discovery and ranking layer of PreBase hybrid web context. Magnus performs downstream reasoning, so requests use `outputType: "searchResults"` (not a provider-synthesized sourced answer) with depths `fast`, `standard`, and `deep`. Deep is not the default.

Hosted secrets stay in Edge Function configuration. Never print, export, add, or rotate provider values from an IDE task.

Deploy only the dedicated function after migration review:

```sh
supabase functions deploy web-search --project-ref mvfopbkhftgmcwdpqrww
supabase db push --project-ref mvfopbkhftgmcwdpqrww
```

The function fails closed when required server configuration (including both `LINKUP_API_KEY` and `FIRECRAWL_API_KEY`) or the quota ledger is unavailable.
