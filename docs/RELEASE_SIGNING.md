# PreBase release signing

Signing and notarization for **shipped** PreBase builds. This document separates **Microsoft upstream infrastructure** from **PreBase production** requirements.

## Microsoft ESRP (upstream only — not PreBase production)

Visual Studio Code’s official Azure Pipelines use **ESRP** (Enterprise Secure Release Pipeline) via `EsrpCodeSigning@6`, `build/azure-pipelines/common/sign.ts`, and platform `codesign.ts` scripts.

Typical **environment variable names** (values are secrets; never log them):

| Variable | Used for |
|----------|----------|
| `ESRP_CLIENT_ID` | ESRP app registration |
| `ESRP_TENANT_ID` | Azure AD tenant |
| `EsrpCliDllPath` | Path to `esrpcli.dll` on the agent |
| `VSCODE_ESRP_CLIENT_ID` | Federated signing (managed identity) |
| `VSCODE_ESRP_TENANT_ID` | Federated signing |
| `VSCODE_ESRP_SERVICE_CONNECTION_ID` | ADO service connection |
| `SYSTEM_ACCESSTOKEN` | ADO job token (encrypted for ESRP CLI) |
| `SYSTEM_JOBID`, `SYSTEM_PLANID`, `SYSTEM_TEAMPROJECTID`, `SYSTEM_HOSTTYPE`, `SYSTEM_COLLECTIONURI` | Federated token payload |

Darwin CI also pulls **Apple Developer** material from Microsoft Key Vault (`macos-developer-certificate`, `macos-developer-certificate-key`) before ESRP signs (`sign-darwin`, `notarize-darwin` operation sets in `sign.ts`).

**PreBase must not treat Microsoft’s ESRP tenant, Key Vaults, or certificates as its production signing solution.** Forks cannot call Microsoft’s ESRP endpoints without Microsoft’s credentials and policy approval.

## PreBase production signing (target model)

PreBase will use **its own** Apple Developer and Windows code-signing identities, plus optional CI secret storage (e.g. GitHub Actions secrets, Azure Key Vault owned by PreBase).

### Planned secret / configuration names (no values in repo)

Checked by `scripts/release/signing-preflight.mjs` when run with `--release`:

| Platform | Variable names | Purpose |
|----------|----------------|---------|
| **macOS** | `PREBASE_CODESIGN_IDENTITY` | Developer ID Application identity name for `codesign` |
| **macOS** | `PREBASE_APPLE_TEAM_ID` | Apple Team ID for notarization |
| **macOS** | One of: `PREBASE_APPLE_NOTARY_KEY`, `PREBASE_APPLE_NOTARY_KEY_PATH` | App Store Connect API key (`.p8`) for notarytool |
| **macOS** | `PREBASE_APPLE_NOTARY_KEY_ID`, `PREBASE_APPLE_NOTARY_ISSUER_ID` | API key metadata |
| **Windows** | `PREBASE_WIN_SIGN_CERT_SHA1` | Thumbprint/SHA1 of cert in `signtool` store **or** |
| **Windows** | `PREBASE_WIN_SIGN_CERT_FILE`, `PREBASE_WIN_SIGN_CERT_PASSWORD` | PFX path + password for release signing |
| **Linux** | `PREBASE_LINUX_GPG_KEY_ID` | Optional: detached signatures for `.deb`/`.rpm` (if product ships them) |

Local ad-hoc / dev signing may use Keychain identities without these variables; **release** pipelines must set the `PREBASE_*` names explicitly.

### Tools (presence checks in preflight)

| Platform | Tool |
|----------|------|
| darwin | `codesign`, `xcrun` / Xcode CLT (`xcode-select`) |
| win32 | `signtool.exe` on PATH (Windows SDK) |
| linux | `gpg` (only if `PREBASE_LINUX_GPG_KEY_ID` is set) |
| ESRP reference | `dotnet` (only listed when documenting upstream; not required for PreBase `--release`) |

## Upstream scripts (reference paths)

| Path | Role |
|------|------|
| `build/azure-pipelines/darwin/codesign.ts` | ESRP sign + notarize client, DMG, server zips |
| `build/azure-pipelines/win32/codesign.ts` | ESRP Windows signing |
| `build/azure-pipelines/linux/steps/product-build-linux-compile.yml` | ESRP PGP for Linux artifacts |
| `build/azure-pipelines/common/sign.ts` | ESRP CLI invocation |

PreBase release automation should **not** call `sign.ts` against Microsoft’s ESRP API without replacing endpoints, key vault references (`vscode-esrp`), and operation policies.

## Preflight command

```bash
# Informational: prints platform, tool hints, missing PreBase release vars (exit 0)
node scripts/release/signing-preflight.mjs

# Release gate: exit 1 if required PREBASE_* vars or tools missing for this OS
node scripts/release/signing-preflight.mjs --release
```

The script **never** reads or prints secret values.

## Notarization and updates

- **Notarization** (macOS): after signing `.app` / `.dmg` with a Developer ID; use Apple notarytool with API key secrets above.
- **Auto-update**: separate from code signing; requires update server, channel metadata, and signed update payloads (not implemented in Phase J).

## Related

- [PACKAGING.md](PACKAGING.md) — gulp package tasks
- [ASSURANCE.md](ASSURANCE.md) — `assurance:package`
- [BETA_READINESS.md](BETA_READINESS.md) — BETA-015
