# Beta Impact — One Graph Type experiment

How this **branch** experiment relates to main [`docs/BETA_READINESS.md`](../../BETA_READINESS.md).

**Rule:** Do not falsify main **Complete** statuses. Only BETA-006 and BETA-007 are Complete on main with prior evidence. This experiment does not change that.

## Reinterpretation (experiment stance)

| Main ID | Main status (unchanged) | Experiment impact |
|---|---|---|
| BETA-001 | Needs Verification | Still required; Code Graph stays under `graphs/` |
| BETA-002 | Needs Verification | Boundary verifier must keep passing; rejects restored Arch product trees |
| BETA-003 | Needs Verification | Architecture Graph acceptance **superseded on this branch** by Code Graph (OGT-010). Main row stays Needs Verification — **not Complete** |
| BETA-004 | Needs Verification | Opening Network canvas ≠ Code Graph acceptance. Main row stays Needs Verification — **not Complete** |
| BETA-005 | Needs Verification | Graph unit tests expanded on branch (`architecturePick` removed); main still Needs Verification until CI evidence on merge candidate |
| BETA-012 | Needs Verification | Magnus path/affected tools added on branch; agent smoke still open |
| BETA-018 | Not Started | Maps community a11y partial on branch; main a11y still open |
| BETA-020 | Deferred After Beta | Unchanged — minimap stays deferred |
| BETA-024 | In Progress | Code Graph perf not re-measured (OGT-011); main remains In Progress |
| BETA-025 | In Progress | No Graphify source adapted; attribution plan only (OGT-013) |
| BETA-026 | In Progress | Experiment docs under `docs/experiments/one-graph-type/` |
| BETA-035 | Deferred After Beta | Hosted Magnus stays disabled |

## Does **not** resolve

- BETA-014 privacy runtime observation
- BETA-015 packaging/signing
- BETA-023 supply-chain remediation
- BETA-033 / BETA-034 cloud auth + RLS runtime
- Any claim of “beta ready” or “merge ready”

## When merging would be considered (future)

Only after OGT-010 evidence, OGT-002 GUI Arch-gone proof, OGT-011 sample, and OGT-014 recommendation — still a separate merge PR with main beta honesty intact. See [COMPARISON_TO_MAIN.md](./COMPARISON_TO_MAIN.md).
