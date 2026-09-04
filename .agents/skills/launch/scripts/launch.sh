#!/usr/bin/env bash
# Launch Code OSS (VS Code from sources) with:
#   - a fresh, slimmed copy of a source user-data-dir (so optional PreBase account
#     and Magnus SecretStorage/provider state can be retained without requiring Copilot)
#   - an isolated --shared-data-dir (otherwise two instances share ~/.vscode-oss-shared and crash each other)
#   - unique debug ports for renderer (CDP), extension host, main process, and agent host
#
# Auth on macOS comes from the OS keychain (per-app, shared automatically) plus
# the encrypted blob in User/globalStorage/state.vscdb (per-UDD). The slim copy
# keeps the auth-relevant state and drops caches / workspaceStorage / logs.
#
# Prints a single JSON line to stdout with the chosen ports + paths so the
# caller can pick them up programmatically. Logs go to stderr.
#
# Usage:
#   launch.sh [--agents] [--source-user-data-dir <path>] [--repo <vscode-repo-root>]
#             [--clone-extensions] [--full] [-- <extra code.sh args>]
#
# Flags:
#   --clone-extensions  Copy the source extensions/ into the new profile (~10s).
#                       Default: start with an EMPTY extensions/ dir - fastest
#                       and conflict-free, but no third-party extensions.
#   --full              Copy the entire profile (incl. extensions). Use if the
#                       slim copy is missing something you need.
#
# Defaults:
#   --source-user-data-dir  $CODE_OSS_DEV_AUTHED_USER_DATA_DIR  (else ~/.vscode-oss-dev)
#   --repo                  $PWD if it looks like a vscode checkout; otherwise pass it explicitly

set -euo pipefail
umask 077

AGENTS=0
SOURCE_UDD="${CODE_OSS_DEV_AUTHED_USER_DATA_DIR:-$HOME/.vscode-oss-dev}"
REPO=""
EXTRA_ARGS=()
CLONE_EXTENSIONS=0
FULL=0
NATIVE_DIALOGS=0
DEBUG_MAIN=0
DEBUG_EXTENSIONS=0
DEBUG_AGENTHOST=0

if [[ "${PREBASE_DEBUG_ALL:-0}" == "1" ]]; then
	DEBUG_MAIN=1
	DEBUG_EXTENSIONS=1
	DEBUG_AGENTHOST=1
fi

TRUST_MODE="trusted"

while [[ $# -gt 0 ]]; do
	case "$1" in
		--agents) AGENTS=1; shift ;;
		--source-user-data-dir) SOURCE_UDD="$2"; shift 2 ;;
		--repo) REPO="$2"; shift 2 ;;
		--clone-extensions|--copy-extensions) CLONE_EXTENSIONS=1; shift ;;
		--full) FULL=1; shift ;;
		--native-dialogs) NATIVE_DIALOGS=1; shift ;;
		--debug-all|--debug) DEBUG_MAIN=1; DEBUG_EXTENSIONS=1; DEBUG_AGENTHOST=1; shift ;;
		--debug-main) DEBUG_MAIN=1; shift ;;
		--debug-extensions) DEBUG_EXTENSIONS=1; shift ;;
		--debug-agenthost) DEBUG_AGENTHOST=1; shift ;;
		--untrusted) TRUST_MODE="untrusted"; shift ;;
		--trust-mode) TRUST_MODE="$2"; shift 2 ;;
		--) shift; EXTRA_ARGS=("$@"); break ;;
		*) echo "Unknown arg: $1" >&2; exit 2 ;;
	esac
done

if [[ -z "$REPO" ]]; then
	if [[ -x "$PWD/scripts/code.sh" ]]; then
		REPO="$PWD"
	else
		echo "Could not find a vscode checkout in $PWD. Pass --repo <path>." >&2
		exit 2
	fi
fi

if [[ ! -d "$SOURCE_UDD" ]]; then
	echo "Source user-data-dir does not exist: $SOURCE_UDD" >&2
	echo "Pass --source-user-data-dir <path> or set CODE_OSS_DEV_AUTHED_USER_DATA_DIR." >&2
	exit 2
fi

pick_port() {
	node -e '
		const net = require("net");
		const s = net.createServer();
		let done = false;
		s.once("error", () => {
			if (!done) { done = true; console.log(10000 + Math.floor(Math.random() * 40000)); }
		});
		try {
			s.listen(0, "127.0.0.1", () => {
				if (!done) { done = true; const p = s.address().port; s.close(() => console.log(p)); }
			});
		} catch {
			if (!done) { done = true; console.log(10000 + Math.floor(Math.random() * 40000)); }
		}
	'
}

CDP_PORT=$(pick_port)
EXTHOST_PORT=""
MAIN_PORT=""
AGENTHOST_PORT=""

if [[ "$DEBUG_EXTENSIONS" == "1" ]]; then
	EXTHOST_PORT=$(pick_port)
fi
if [[ "$DEBUG_MAIN" == "1" ]]; then
	MAIN_PORT=$(pick_port)
fi
if [[ "$DEBUG_AGENTHOST" == "1" ]]; then
	AGENTHOST_PORT=$(pick_port)
fi

STAMP=$(date +%Y%m%d-%H%M%S)-$$
# Keep path short to stay safely under macOS 103-char UNIX socket path limit
BASE_TMP="${TMPDIR:-/tmp}"
RUN_DIR="${BASE_TMP%/}/pb/$STAMP"
DEST_UDD="$RUN_DIR/user-data"
SHARED_DATA_DIR="$RUN_DIR/shared-data"
mkdir -p "$DEST_UDD" "$SHARED_DATA_DIR"

# Excludes (deny-list, so future VS Code additions copy through by default).
# Anchored excludes (starting with /) match only at the top level so we don't
# accidentally strip files inside subdirs that share a name.
EXCLUDES=(
	'/extensions'                                       # handled separately below
	'/workspaceStorage' 'User/workspaceStorage'         # per-workspace state, incl. chat sessions
	'User/History'                                      # local file edit history
	'/CachedExtensionVSIXs'                             # backup VSIXs
	'/logs'
	'/Cache' '/Code Cache' '/CachedData' '/component_crx_cache'
	'/GPUCache' '/ShaderCache' '/Dawn*Cache'
	'/Backups' '/blob_storage' '/BrowserMetrics' '/Crashpad'
	'/Session Storage'
	'/Singleton*'
	'*.lock' '*.sock'
)

if [[ "$FULL" == "1" ]]; then
	echo "[launch.sh] full copy: $SOURCE_UDD -> $DEST_UDD" >&2
	rsync -a "$SOURCE_UDD/" "$DEST_UDD/"
else
	echo "[launch.sh] slim copy: $SOURCE_UDD -> $DEST_UDD" >&2
	RSYNC_ARGS=(-a)
	for e in "${EXCLUDES[@]}"; do RSYNC_ARGS+=(--exclude="$e"); done
	rsync "${RSYNC_ARGS[@]}" "$SOURCE_UDD/" "$DEST_UDD/"
fi

# Extensions:
#   --full              -> already copied above
#   --clone-extensions  -> copy into the new profile (~10s)
#   default             -> fresh empty dir
EXT_DIR="$DEST_UDD/extensions"
mkdir -p "$EXT_DIR"
if [[ "$FULL" != "1" && "$CLONE_EXTENSIONS" == "1" ]]; then
	echo "[launch.sh] copying extensions: $SOURCE_UDD/extensions -> $EXT_DIR" >&2
	rsync -a "$SOURCE_UDD/extensions/" "$EXT_DIR/"
fi

if [[ "$NATIVE_DIALOGS" == "1" ]]; then
	echo "[launch.sh] native dialogs enabled (--native-dialogs): preserving standard OS native file dialogs (Playwright CDP cannot interact with native file dialogs)" >&2
else
	# Force the simple (quick-input) file dialog so automation can drive
	# "Open Folder" / workspace pickers. The native OS file dialog cannot be
	# controlled by @playwright/cli over CDP (and is completely unreachable
	# over SSH on headless macOS). The setting overlay is per-launch and
	# applied by default because launched instances under this skill are
	# throwaways used for automation.
	SETTINGS_FILE="$DEST_UDD/User/settings.json"
	mkdir -p "$(dirname "$SETTINGS_FILE")"
	if ! node - "$SETTINGS_FILE" "$TRUST_MODE" <<'NODE'
const fs = require('fs');
const f = process.argv[2];
const trustMode = process.argv[3] || 'trusted';

function stripJsoncComments(content) {
	let insideString = false;
	let stringChar = '';
	let insideSingleLineComment = false;
	let insideMultiLineComment = false;
	let result = '';

	for (let i = 0; i < content.length; i++) {
		const char = content[i];
		const nextChar = content[i + 1];

		if (insideSingleLineComment) {
			if (char === '\n' || char === '\r') {
				insideSingleLineComment = false;
				result += char;
			}
			continue;
		}

		if (insideMultiLineComment) {
			if (char === '*' && nextChar === '/') {
				insideMultiLineComment = false;
				i++;
			}
			continue;
		}

		if (insideString) {
			result += char;
			if (char === '\\' && i + 1 < content.length) {
				result += content[i + 1];
				i++;
			} else if (char === stringChar) {
				insideString = false;
			}
			continue;
		}

		if (char === '"' || char === "'") {
			insideString = true;
			stringChar = char;
			result += char;
			continue;
		}

		if (char === '/' && nextChar === '/') {
			insideSingleLineComment = true;
			i++;
			continue;
		}

		if (char === '/' && nextChar === '*') {
			insideMultiLineComment = true;
			i++;
			continue;
		}

		result += char;
	}

	return result.replace(/,\s*([}\]])/g, '$1');
}

const settings = {
	'files.simpleDialog.enable': true,
};

if (trustMode === 'trusted') {
	settings['security.workspace.trust.enabled'] = false;
	settings['security.workspace.trust.startupPrompt'] = 'never';
}

let json = {};
if (fs.existsSync(f)) {
	const raw = fs.readFileSync(f, 'utf8');
	if (raw.trim()) {
		try {
			json = JSON.parse(stripJsoncComments(raw));
		} catch (err) {
			console.error('[launch.sh] Warning: Failed to parse existing JSONC settings file. Preserving existing settings content safely.', err);
			// Fail loudly rather than silently replacing settings with an empty object
			process.exit(1);
		}
	}
}
Object.assign(json, settings);
fs.writeFileSync(f, JSON.stringify(json, null, 2) + '\n');
NODE
	then
		echo "[launch.sh] failed to configure settings in $SETTINGS_FILE" >&2
		exit 1
	fi
	echo "[launch.sh] automation mode: ensured files.simpleDialog.enable=true (trustMode: $TRUST_MODE) in $SETTINGS_FILE" >&2
fi

# Strip ELECTRON_RUN_AS_NODE, commonly inherited from VS Code's integrated
# terminal / agent runtimes; it breaks ./scripts/code.sh.
unset ELECTRON_RUN_AS_NODE

CODE_SH="$REPO/scripts/code.sh"
if [[ ! -x "$CODE_SH" ]]; then
	echo "Could not find an executable Code OSS launcher at $CODE_SH. Pass --repo <vscode-repo-root>." >&2
	exit 2
fi

ARGS=(
	"--user-data-dir=$DEST_UDD"
	"--extensions-dir=$EXT_DIR"
	"--shared-data-dir=$SHARED_DATA_DIR"
	"--remote-debugging-port=$CDP_PORT"
)
if [[ -n "$EXTHOST_PORT" ]]; then
	ARGS+=("--inspect-extensions=$EXTHOST_PORT")
fi
if [[ -n "$MAIN_PORT" ]]; then
	ARGS+=("--inspect=$MAIN_PORT")
fi
if [[ -n "$AGENTHOST_PORT" ]]; then
	ARGS+=("--inspect-agenthost=$AGENTHOST_PORT")
fi
if [[ "$AGENTS" == "1" ]]; then
	ARGS=("--agents" "${ARGS[@]}")
fi
if (( ${#EXTRA_ARGS[@]} )); then
	ARGS+=("${EXTRA_ARGS[@]}")
fi

LOG_FILE="$RUN_DIR/code.log"
echo "[launch.sh] launching: $CODE_SH ${ARGS[*]}" >&2
echo "[launch.sh] logs: $LOG_FILE" >&2
echo "[launch.sh] CDP enabled on port $CDP_PORT" >&2
if [[ -n "$MAIN_PORT" || -n "$EXTHOST_PORT" || -n "$AGENTHOST_PORT" ]]; then
	echo "[launch.sh] debug inspectors: main=${MAIN_PORT:-off} extHost=${EXTHOST_PORT:-off} agentHost=${AGENTHOST_PORT:-off}" >&2
else
	echo "[launch.sh] debug inspectors: off (pass --debug-all or --debug-main/--debug-extensions to enable)" >&2
fi

# Run pre-launch (electron download, compile-if-missing, built-in extensions) in the
# foreground so any errors surface synchronously. Then skip code.sh's own pre-launch.
echo "[launch.sh] running pre-launch (ensures electron + compiled output + built-ins)..." >&2
if ! ( cd "$REPO" && node build/lib/preLaunch.ts ) >>"$LOG_FILE" 2>&1; then
	echo "[launch.sh] pre-launch FAILED. Log tail:" >&2
	tail -n 80 "$LOG_FILE" >&2
	exit 1
fi

# Launch code.sh in the background. Detaching with `nohup ... & disown` is
# sufficient: by the time we return below, CDP is up and Electron is fully
# forked into its own process tree, so it's robust to its launching shell
# going away. (Earlier failures came from returning while Electron was still
# mid-bootstrap, not from process-group concerns.)
nohup env VSCODE_SKIP_PRELAUNCH=1 "$CODE_SH" "${ARGS[@]}" \
	</dev/null >>"$LOG_FILE" 2>&1 &
PID=$!
disown $PID 2>/dev/null || true

# Block until the renderer's CDP endpoint is responding so the caller can attach
# immediately. If code.sh dies or we time out, dump the log so the failure is
# visible.
echo "[launch.sh] waiting for CDP on port $CDP_PORT (timeout 90s)..." >&2
READY=0
for i in $(seq 1 90); do
	if ! kill -0 "$PID" 2>/dev/null; then
		echo "[launch.sh] code.sh (PID $PID) exited before CDP came up. Log tail:" >&2
		tail -n 80 "$LOG_FILE" >&2
		exit 1
	fi
	if curl -sf -o /dev/null --max-time 1 "http://127.0.0.1:$CDP_PORT/json/version" 2>/dev/null; then
		READY=1
		echo "[launch.sh] CDP ready after ${i}s" >&2
		break
	fi
	sleep 1
done
if [[ "$READY" != "1" ]]; then
	echo "[launch.sh] timed out waiting for CDP on port $CDP_PORT. Log tail:" >&2
	tail -n 80 "$LOG_FILE" >&2
	exit 1
fi

node -e '
	const p = (v) => v && v.length > 0 ? Number(v) : null;
	console.log(JSON.stringify({
		pid: '"$PID"',
		cdpPort: '"$CDP_PORT"',
		extHostPort: p(process.argv[1]),
		mainPort: p(process.argv[2]),
		agentHostPort: p(process.argv[3]),
		userDataDir: process.argv[4],
		extensionsDir: process.argv[5],
		sharedDataDir: process.argv[6],
		runDir: process.argv[7],
		logFile: process.argv[8],
		repo: process.argv[9],
		agents: '"$AGENTS"' === 1,
	}));
' "$EXTHOST_PORT" "$MAIN_PORT" "$AGENTHOST_PORT" "$DEST_UDD" "$EXT_DIR" "$SHARED_DATA_DIR" "$RUN_DIR" "$LOG_FILE" "$REPO"
