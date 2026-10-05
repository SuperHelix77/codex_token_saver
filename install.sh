#!/usr/bin/env bash
# Install the token-saving hooks into ~/.codex.
#
# Idempotent, and it never overwrites a hook you already wrote: each file is
# only written when absent, and `--force` is required to replace one. These
# hooks sit in the request path, so a surprise overwrite is the one failure
# mode worth designing against.
set -euo pipefail

CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
HOOK_DIR="$CODEX_HOME/bin"
HOOKS_JSON="$CODEX_HOME/hooks.json"
SRC="$(cd "$(dirname "$0")" && pwd)/hooks"
FORCE=0

[ "${1:-}" = "--force" ] && FORCE=1

mkdir -p "$HOOK_DIR"

for name in rtk-codex-hook session-guard concise-output-toggle; do
  target="$HOOK_DIR/$name"
  if [ -e "$target" ] && [ "$FORCE" -eq 0 ]; then
    echo "skip   $name (already installed; --force to replace)"
    continue
  fi
  cp "$SRC/$name" "$target"
  chmod +x "$target"
  echo "write  $name"
done

if ! command -v rtk >/dev/null 2>&1; then
  echo
  echo "note   rtk is not installed, so tool output will not be condensed."
  echo "       macOS:  brew install rtk"
  echo "       else:   cargo install --git https://github.com/rtk-ai/rtk"
fi

echo
echo "Registering hooks in $HOOKS_JSON ..."
python3 - "$HOOKS_JSON" "$HOOK_DIR" <<'PY'
import json, os, sys

path, hook_dir = sys.argv[1], sys.argv[2]
doc = {"hooks": {}} if not os.path.exists(path) else json.load(open(path))
hooks = doc.setdefault("hooks", {})

def ensure(event, matcher, command):
    entries = hooks.setdefault(event, [])
    for entry in entries:
        for h in entry.get("hooks", []):
            if h.get("command") == command:
                return "already"
    entries.append({
        "matcher": matcher,
        "hooks": [{"type": "command", "command": command, "timeout": 20}],
    })
    return "added"

print("  ", ensure("PreToolUse", "Bash", f"{hook_dir}/rtk-codex-hook"))
print("  ", ensure("SessionStart", None, f"{hook_dir}/session-guard"))
print("  ", ensure("UserPromptSubmit", None, f"{hook_dir}/concise-output-toggle status"))

json.dump(doc, open(path, "w"), indent=2)
open(path, "a").write("\n")
PY

cat <<'MSG'

Done. Restart Codex to load the hooks.

Verify with:
  rtk gain                      # token savings ledger
  ~/.codex/bin/session-guard    # service status line
MSG
