#!/usr/bin/env bash
# Install the decision-driven test sandbox OUTSIDE the git repo.
# Target: ~/.pi/decision-driven-sandbox
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${DECISION_DRIVEN_SANDBOX:-$HOME/.pi/decision-driven-sandbox}"

mkdir -p "$DEST"/{agent/sessions,workspace,models}

cat > "$DEST/agent/settings.json" <<'EOF'
{
	"decisionDriven": true,
	"defaultProvider": "openrouter",
	"defaultModel": "qwen/qwen3.8-27b:free",
	"defaultClassifierProvider": "laya",
	"defaultClassifierModel": "typed-decisions",
	"steeringMode": "all",
	"followUpMode": "all"
}
EOF

cat > "$DEST/agent/models.json" <<'EOF'
{
	"providers": {
		"laya": {
			"baseUrl": "http://127.0.0.1:18081/v1",
			"apiKey": "local",
			"models": [
				{
					"type": "classifier",
					"id": "typed-decisions",
					"name": "Laya typed-decisions (local)",
					"api": "typesafe-system-one",
					"contextWindow": 1024
				},
				{
					"type": "classifier",
					"id": "english",
					"name": "Laya English (local)",
					"api": "typesafe-system-one",
					"contextWindow": 512
				}
			]
		}
	}
}
EOF

if [[ ! -f "$DEST/agent/auth.json" ]]; then
	cat > "$DEST/agent/auth.json" <<'EOF'
{
	"laya": {
		"type": "api_key",
		"key": "local"
	}
}
EOF
fi

cat > "$DEST/install-laya.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV="$ROOT/.venv"
python3 -m venv "$VENV"
"$VENV/bin/pip" install -U pip
"$VENV/bin/pip" install 'laya[serve]'
"$VENV/bin/python" -I -c "import laya; print('laya', laya.__version__)"
test -x "$VENV/bin/laya-serve"
echo "OK: $VENV/bin/laya-serve"
echo "Next: $ROOT/start-laya.sh"
EOF

cat > "$DEST/start-laya.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV="${LAYA_VENV:-$ROOT/.venv}"
HOST="${LAYA_HOST:-127.0.0.1}"
PORT="${LAYA_PORT:-18081}"
PID_FILE="$ROOT/.laya-serve.pid"
MODELS="${LAYA_MODELS:-english,typed-decisions}"
DEVICE="${LAYA_DEVICE:-cpu}"
PRELOAD="${LAYA_PRELOAD:-1}"
AUTO_TASK="${LAYA_AUTO_TASK:-1}"

if [[ "${1:-}" == "stop" ]]; then
	if [[ -f "$PID_FILE" ]]; then
		kill "$(cat "$PID_FILE")" 2>/dev/null || true
		rm -f "$PID_FILE"
		echo "Stopped laya-serve."
	else
		echo "No pid file at $PID_FILE"
	fi
	exit 0
fi

if [[ ! -x "$VENV/bin/laya-serve" ]]; then
	echo "laya-serve not found in $VENV" >&2
	echo "Run: $ROOT/install-laya.sh" >&2
	exit 1
fi

if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
	echo "laya-serve already running (pid $(cat "$PID_FILE")) on http://${HOST}:${PORT}"
	exit 0
fi

AUTH="$ROOT/agent/auth.json"
MODELS_JSON="$ROOT/agent/models.json"
URL="http://${HOST}:${PORT}/v1"
if command -v node >/dev/null 2>&1; then
	node -e '
		const fs = require("fs");
		const authPath = process.argv[1];
		const modelsPath = process.argv[2];
		const url = process.argv[3];
		const auth = JSON.parse(fs.readFileSync(authPath, "utf8"));
		auth.laya = { type: "api_key", key: "local" };
		fs.writeFileSync(authPath, JSON.stringify(auth, null, "\t") + "\n");
		const models = JSON.parse(fs.readFileSync(modelsPath, "utf8"));
		models.providers = models.providers || {};
		models.providers.laya = models.providers.laya || {};
		models.providers.laya.baseUrl = url;
		models.providers.laya.apiKey = models.providers.laya.apiKey || "local";
		fs.writeFileSync(modelsPath, JSON.stringify(models, null, "\t") + "\n");
	' "$AUTH" "$MODELS_JSON" "$URL"
fi

echo "Starting laya-serve on http://${HOST}:${PORT}"
export LAYA_HOST="$HOST" LAYA_PORT="$PORT" LAYA_MODELS="$MODELS"
export LAYA_DEVICE="$DEVICE" LAYA_PRELOAD="$PRELOAD" LAYA_AUTO_TASK="$AUTO_TASK"
export USE_TF="${USE_TF:-0}"
"$VENV/bin/laya-serve" &
echo $! >"$PID_FILE"
echo "pid $(cat "$PID_FILE"); stop with $ROOT/start-laya.sh stop"
EOF

cat > "$DEST/run.sh" <<EOF
#!/usr/bin/env bash
set -euo pipefail
ROOT="\$(cd "\$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
REPO="\${PI_DECISION_DRIVEN_REPO:-$REPO}"
AGENT_DIR="\$ROOT/agent"
WORKSPACE="\$ROOT/workspace"
HOST="\${LAYA_HOST:-127.0.0.1}"
PORT="\${LAYA_PORT:-18081}"

export PI_CODING_AGENT_DIR="\$AGENT_DIR"
mkdir -p "\$AGENT_DIR/sessions" "\$WORKSPACE"

if [[ ! -x "\$REPO/pi-test.sh" ]]; then
	echo "Cannot find pi-test.sh at \$REPO. Set PI_DECISION_DRIVEN_REPO." >&2
	exit 1
fi

if ! curl -sf "http://\${HOST}:\${PORT}/health" >/dev/null 2>&1; then
	echo "laya-serve not reachable at http://\${HOST}:\${PORT}" >&2
	echo "Run: \$ROOT/install-laya.sh && \$ROOT/start-laya.sh" >&2
	exit 1
fi

if ! node -e '
	const a=require(process.argv[1]);
	if (!a.openrouter && !process.env.OPENROUTER_API_KEY) process.exit(2);
' "\$AGENT_DIR/auth.json" 2>/dev/null; then
	echo "No OpenRouter credential — /login openrouter or export OPENROUTER_API_KEY=..." >&2
fi

cd "\$WORKSPACE"
exec "\$REPO/pi-test.sh" "\$@"
EOF

cat > "$DEST/workspace/README.md" <<'EOF'
Pi starts here when you run ../run.sh.
EOF

cat > "$DEST/README.md" <<EOF
# Decision-driven sandbox

Location: \`$DEST\` (outside the git repo).

| Role | Backend |
|------|---------|
| Chat | OpenRouter \`qwen/qwen3.8-27b:free\` |
| Classifier | Local Laya \`typed-decisions\` |

\`\`\`bash
export OPENROUTER_API_KEY=sk-or-...
$DEST/install-laya.sh
$DEST/start-laya.sh
$DEST/run.sh
\`\`\`

Repo clone used by run.sh: \`$REPO\` (override with \`PI_DECISION_DRIVEN_REPO\`).
EOF

chmod +x "$DEST"/{install-laya.sh,start-laya.sh,run.sh}

# Remove in-repo sandbox leftovers if present
if [[ -d "$REPO/sandbox" ]]; then
	rm -rf "$REPO/sandbox" 2>/dev/null || true
	if [[ -e "$REPO/sandbox" ]]; then
		echo "Warning: could not fully delete $REPO/sandbox (likely a stuck .venv)." >&2
		echo "Remove manually: rm -rf $REPO/sandbox" >&2
	fi
fi

echo "Installed sandbox at $DEST"
echo "Next:"
echo "  export OPENROUTER_API_KEY=sk-or-..."
echo "  $DEST/install-laya.sh && $DEST/start-laya.sh && $DEST/run.sh"
