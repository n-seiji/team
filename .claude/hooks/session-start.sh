#!/bin/bash
# Claude Code on the web: install pnpm and the dev dependencies (typecheck) when a cloud session starts.
# The engine itself has no runtime dependencies, so `node src/main.ts` works even if this fails.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

# The pnpm version pinned in package.json ("packageManager": "pnpm@x.y.z").
want=$(node -p 'require("./package.json").packageManager.split("@")[1]')

# Corepack bundled with Node 22 cannot start pnpm 12, so install it with npm instead.
if [ "$(pnpm -v 2>/dev/null || true)" != "$want" ]; then
  npm install -g --silent "pnpm@$want"
fi

pnpm install --frozen-lockfile
