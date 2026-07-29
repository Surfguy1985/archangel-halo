#!/bin/bash
set -e
pnpm install --no-frozen-lockfile
pnpm --filter @workspace/api-spec run codegen
pnpm --filter @workspace/db run push-force
