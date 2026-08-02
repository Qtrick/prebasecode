# Beta Evidence Index

**Current run:** `2026-08-02T041900Z-9fde0994-darwin-arm64`  
**Commit:** `9fde099426b124063653c99e4ab8e56278e9d803`  
**Branch:** `main`  
**Icons checksum match initial→final:** True

## Locations

| Kind | Path |
|---|---|
| Evidence run | `reports/beta-evidence/2026-08-02T041900Z-9fde0994-darwin-arm64/` |
| Commands | `reports/beta-evidence/2026-08-02T041900Z-9fde0994-darwin-arm64/commands.json` |
| Environment | `reports/beta-evidence/2026-08-02T041900Z-9fde0994-darwin-arm64/environment.json` |
| Logs | `reports/beta-evidence/2026-08-02T041900Z-9fde0994-darwin-arm64/logs/` |
| Large artifacts | `.artifacts/beta-evidence/2026-08-02T041900Z-9fde0994-darwin-arm64/` (gitignored) |
| Machine state | `reports/beta-readiness/current-state.json` |
| Assessments | `docs/BETA_ITEM_ASSESSMENTS.md` |
| GO/NO-GO | `docs/BETA_GO_NO_GO.md` |

## Command results (this run)

| Command | Result | Exit | Duration (s) |
|---|---|---|---|
| `verify-icons` | pass | 0 | 0.227 |
| `verify-graphs-boundary` | pass | 0 | 1.443 |
| `verify-typescript` | pass | 0 | 0.393 |
| `verify-privacy` | pass | 0 | 0.145 |
| `verify-config-uniqueness` | pass | 0 | 0.142 |
| `verify-supabase-migrations` | pass | 0 | 0.143 |
| `verify-supabase-rls-static` | pass | 0 | 0.142 |
| `verify-supabase-secrets` | pass | 0 | 1.056 |
| `typecheck-graphs` | pass | 0 | 0.29 |
| `test-graphs` | pass | 0 | 1.688 |
| `verify-startup` | pass | 0 | 0.144 |
| `verify-graphs-out` | pass | 0 | 0.143 |
| `assurance-privacy` | pass | 0 | 1.255 |
| `assurance-cloud` | pass | 0 | 1.033 |
| `assurance-graphs` | pass | 0 | 3.073 |
| `verify-eslint-prebase` | fail | 1 | 1.841 |
| `assurance-package` | pass | 0 | 2.165 |
| `typecheck-client` | fail | 1 | 6.497 |
| `npm-audit-omit-dev` | fail | 1 | 1.267 |
| `typecheck-client-rerun` | fail | 1 | 5.703 |
| `typecheck-graphs-rerun` | pass | 0 | 0.269 |
| `typecheck-graphs-preserved` | pass | 0 | 0.178 |
| `test-graphs-rerun` | pass | 0 | 1.603 |
| `verify-icons-rerun` | pass | 0 | 0.2 |
| `assurance-quick` | fail | 1 | 7.672 |
| `typecheck-client-v3` | pass | 0 | 5.916 |
| `assurance-quick-v2` | fail | 1 | 1.159 |
| `verify-icons-final` | pass | 0 | 0.167 |
| `assurance-quick-v3` | fail | 1 | 0.865 |
| `verify-icons-v3` | pass | 0 | 0.151 |
| `assurance-quick-v4` | pass | 0 | 10.335 |
| `verify-icons-v4` | pass | 0 | 0.15 |

## Notes

- GUI screenshots/videos: **not collected** (no interactive product matrix this run).
- Remote CI run ID: **not available**.
- Unsigned package artifact: **not built**.
- Privacy runtime capture: **not executed**.
- Auth/RLS adversarial: **not executed**.
