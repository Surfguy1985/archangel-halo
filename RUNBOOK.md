# HALO operations runbook

## Postgres backups

### Daily snapshot

Take a logical dump of the primary database every day. Store it off the app host.

```bash
# Civil date in the operator timezone — not UTC toISOString.
STAMP=$(date +%F)
pg_dump "$DATABASE_URL" --format=custom --file="halo-${STAMP}.dump"
```

Keep at least 7 daily dumps. Encrypt at rest. Do not commit dumps.

### Weekly restore test

Once a week, restore the latest dump into a throwaway database and prove the
client-board schema + a Pulse read still work.

```bash
createdb halo_restore_test
pg_restore --clean --if-exists --dbname="postgres://localhost/halo_restore_test" halo-YYYY-MM-DD.dump
psql "postgres://localhost/halo_restore_test" -c "SELECT count(*) FROM client_turns;"
psql "postgres://localhost/halo_restore_test" -c "SELECT segment, enabled FROM client_board_flags ORDER BY segment;"
dropdb halo_restore_test
```

A restore that cannot select `client_turns` or `client_board_flags` is a failed
test — fix backups before the next production deploy.

## Evidence retention

Nightly, when the `security` flag is on, evidence older than the org's
`evidence_retention_years` (default 7) is **soft-tombstoned**. Bytes and the
verification hash stay. `GET /v1/turns/:id/verify` must still return
`matches: true`.

## Signed file links

Evidence and Unit Turn Record URLs expire in 15 minutes and are single-use
(`jti` ticket). A second GET returns 404.

## Client Board demo and live seed

Generated data exists only so the app is developable before the CAF export arrives.

```bash
pnpm seed:demo
# alias: pnpm seed:client-board
# 12 properties × 40 units × 120 days (Paloma bottleneck, Desert Sage rework, Redbud in-house)

pnpm seed:live -- --source=./caf-export/
# Walks units|leases|notices|purchase_orders CSVs into the same shape. Does not use the generated set.
```

Screen-share redaction (does not flip the `demo` flag):

```bash
DEMO_SAFE=true
```

Do not enable `realtime`. The `demo` flag stays off.
