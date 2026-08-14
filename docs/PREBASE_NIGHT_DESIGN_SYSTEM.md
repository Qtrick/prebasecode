# PreBase Night design system

PreBase Night keeps the existing deep graphite base (`#1B1C1E` editor, `#1F1F1F` chrome, `#303030` raised surfaces) and uses teal as a focused product accent rather than as a blanket background. Cyan is reserved for links and informational emphasis; green, yellow, red, and purple retain their conventional success, warning, error, and distinct-data roles.

## Semantic tokens

| Role | Theme tokens |
| --- | --- |
| Application chrome | `activityBar.*`, `sideBar.*`, `titleBar.*`, `statusBar.*`, `tab.*` |
| Input and focus | `input.*`, `button.*`, `focusBorder`, `list.focus*` |
| Editor and diagnostics | `editor.*`, `editorError.foreground`, `editorWarning.foreground`, `editorInfo.foreground` |
| Terminal | `terminal.*`, including the full ANSI palette |
| Data visualization | `charts.*` |

PreBase-owned workbench UI must consume the exported VS Code CSS variables (`--vscode-*`) rather than duplicate dark-surface colors. This ensures the startup gate, onboarding, graph views, runtime preview, and normal workbench controls remain readable under the active theme and high-contrast variants.

## Candidate research and selection

The implementation uses the VS Code color-token contract rather than importing another theme. Its design review considered the familiar dark-blue editor style, neutral graphite themes, and the existing teal PreBase palette. The selection retains the established PreBase identity, adds a more complete focus/list/diagnostic/terminal/chart token system, and preserves semantic color separation for graph data instead of encoding graph meaning in arbitrary component CSS.

The authoritative token reference is the [VS Code Theme Color reference](https://code.visualstudio.com/api/references/theme-color). Contrast-sensitive UI uses the base foreground, description, focus, selection, and high-contrast border token families described there; product UI is reviewed against the [WCAG contrast requirements](https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html).
