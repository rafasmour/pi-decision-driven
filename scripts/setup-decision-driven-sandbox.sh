#!/usr/bin/env bash
# Install the decision-driven test sandbox OUTSIDE the git repo.
# Chat + classifier both via OpenRouter free models.
# Target: ~/.pi/decision-driven-sandbox
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${DECISION_DRIVEN_SANDBOX:-$HOME/.pi/decision-driven-sandbox}"

mkdir -p "$DEST"/{agent/sessions,workspace}

# Built-in OpenRouter classifiers (see packages/ai openrouter catalog):
#   inception/mercury-decide:free
#   respan/span-01-lite:free
cat > "$DEST/agent/settings.json" <<'EOF'
{
	"decisionDriven": true,
	"defaultProvider": "openrouter",
	"defaultModel": "openrouter/free",
	"defaultClassifierProvider": "openrouter",
	"defaultClassifierModel": "inception/mercury-decide:free",
	"steeringMode": "all",
	"followUpMode": "all"
}
EOF

# No custom models.json needed — OpenRouter builtins include free decision models.
if [[ -f "$DEST/agent/models.json" ]]; then
	# Drop a prior Laya-only models.json so it cannot shadow builtins.
	if grep -q '"laya"' "$DEST/agent/models.json" 2>/dev/null; then
		rm -f "$DEST/agent/models.json"
	fi
fi

# Keep existing auth if present; otherwise stub for OpenRouter via env or /login.
if [[ ! -f "$DEST/agent/auth.json" ]]; then
	cat > "$DEST/agent/auth.json" <<'EOF'
{}
EOF
fi

# Remove Laya helper scripts from older sandbox installs.
rm -f "$DEST/install-laya.sh" "$DEST/start-laya.sh"
rm -f "$DEST/.laya-serve.pid" 2>/dev/null || true

cat > "$DEST/run.sh" <<EOF
#!/usr/bin/env bash
set -euo pipefail
ROOT="\$(cd "\$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
REPO="\${PI_DECISION_DRIVEN_REPO:-$REPO}"
AGENT_DIR="\$ROOT/agent"
WORKSPACE="\$ROOT/workspace"

export PI_CODING_AGENT_DIR="\$AGENT_DIR"
mkdir -p "\$AGENT_DIR/sessions" "\$WORKSPACE"

if [[ ! -x "\$REPO/pi-test.sh" ]]; then
	echo "Cannot find pi-test.sh at \$REPO. Set PI_DECISION_DRIVEN_REPO." >&2
	exit 1
fi

if [[ -z "\${OPENROUTER_API_KEY:-}" ]]; then
	if ! node -e '
		const fs=require("fs");
		const a=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
		if (!a.openrouter) process.exit(2);
	' "\$AGENT_DIR/auth.json" 2>/dev/null; then
		echo "Set OPENROUTER_API_KEY or run /login openrouter inside pi." >&2
	fi
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
| Chat | OpenRouter \`openrouter/free\` |
| Classifier | OpenRouter \`inception/mercury-decide:free\` |

Other free OpenRouter decision models (via \`/classifier\`): \`respan/span-01-lite:free\`.

\`\`\`bash
export OPENROUTER_API_KEY=sk-or-...
$DEST/run.sh
\`\`\`

Repo clone used by run.sh: \`$REPO\` (override with \`PI_DECISION_DRIVEN_REPO\`).
EOF

chmod +x "$DEST/run.sh"

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
echo "  $DEST/run.sh"
echo "Classifier default: openrouter/inception/mercury-decide:free"
echo "Swap with /classifier (also free: respan/span-01-lite:free)"
