#!/usr/bin/env bash
# codegen-check.sh — Verify generated API files are in sync with openapi.yaml.
# Fails if orval output differs from what is committed (covers modifications,
# deletions, AND new untracked files that were never added to the repo).
set -euo pipefail

GENERATED_DIRS=(
  "../../lib/api-client-react/src/generated"
  "../../lib/api-zod/src/generated"
)

# Re-run codegen in place (writes into the working tree)
orval --config ./orval.config.ts
node ./stripCollidingZodParams.mjs

FAILED=0

# 1. Check for modifications or deletions to already-tracked files
if ! git diff --exit-code -- "${GENERATED_DIRS[@]}" > /dev/null 2>&1; then
  echo ""
  echo "ERROR: Tracked generated files differ from what orval produces today."
  git diff --name-only -- "${GENERATED_DIRS[@]}"
  FAILED=1
fi

# 2. Check for brand-new files that codegen produced but that are not yet committed
UNTRACKED=$(git ls-files --others --exclude-standard -- "${GENERATED_DIRS[@]}")
if [ -n "$UNTRACKED" ]; then
  echo ""
  echo "ERROR: Codegen produced new files that are not committed to the repo:"
  echo "$UNTRACKED"
  FAILED=1
fi

if [ "$FAILED" -ne 0 ]; then
  echo ""
  echo "Generated API files are out of sync with openapi.yaml."
  echo "Fix: cd lib/api-spec && pnpm run codegen"
  echo ""
  exit 1
fi

echo "Generated files are up to date."
