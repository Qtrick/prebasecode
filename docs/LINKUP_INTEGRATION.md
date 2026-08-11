# LinkUp integration

Deploy only the dedicated function after migration review:

```sh
supabase functions deploy web-search --project-ref mvfopbkhftgmcwdpqrww
supabase db push --project-ref mvfopbkhftgmcwdpqrww
```

The hosted secret is already managed outside this repository. Never print, export, add, or rotate its value from an IDE task. The function fails closed when required server configuration or the quota ledger is unavailable.
