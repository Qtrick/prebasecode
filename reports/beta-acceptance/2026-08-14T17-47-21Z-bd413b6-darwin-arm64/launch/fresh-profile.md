# Fresh-profile source launch

- Status: **PASS** (after two fixed regressions and a repeated fresh-profile launch)
- Launch: `TMPDIR=/tmp .agents/skills/launch/scripts/launch.sh --repo /Users/qunyingfan/Prebasecode`
- Renderer: CDP was ready after two seconds; Playwright attached successfully using a short `/tmp` path.
- Evidence: [snapshot](../../../../.playwright-cli/page-2026-08-14T17-51-13-747Z.yml) and [sanitized console output](../../../../.playwright-cli/console-2026-08-14T17-51-13-695Z.log).

Observed product state:

1. The PreBase workbench and the intended offline-capable PreBase auth dialog rendered.
2. The initial run showed an upstream modal saying “Welcome to Visual Studio Code” and “Sign in to use GitHub Copilot”.
3. The initial console reported that `prebase.magnus` requests `findTextInFiles`, but `product.json` did not grant it.
4. Rerun evidence: [snapshot](../../../../.playwright-cli/page-2026-08-14T17-57-14-359Z.yml) and [`fresh-profile-rerun.png`](../screenshots/fresh-profile-rerun.png). The modal and proposal mismatch are fixed, but a visible “Copilot status” control remains in the status bar.

The original regressions were fixed and the same workflow was rerun. Final evidence: [snapshot](../../../../.playwright-cli/page-2026-08-14T18-00-19-920Z.yml), [`fresh-profile-final.png`](../screenshots/fresh-profile-final.png), and [offline/onboarding snapshot](../../../../.playwright-cli/page-2026-08-14T18-00-41-455Z.yml). The final UI contained only PreBase auth and Agents surfaces; no generic VS Code/Copilot modal or Copilot status control remained. Selecting Continue Offline opened the PreBase onboarding editor without a crash.
