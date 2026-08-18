---
name: HALO office passcode gate (REMOVED)
description: The office passcode/session gate no longer exists — see halo-passwordless.md.
---

The office API was once locked behind a scrypt passcode + `halo_office_session`
cookie enforced by `officeGuard` in `lib/officeAuth.ts`, with `OfficeGate` lock
screens in the office and desktop apps. All of it — the lib, the guard, the
`/office-auth` and `/walk-auth` routers, and both lock screens — was deleted
when the owner asked for every password in the project to be removed.

**Why:** keep this note so a future agent does not go hunting for a gate that
was described in older memories, or "restore" it as a fix.

**How to apply:** read halo-passwordless.md. The only survivor is the path
classifier, moved verbatim to `lib/publicPaths.ts` (PUBLIC_PREFIXES,
isPublicApiPath, isVendorBidAuth, isIdentityExemptPath) because the Falkon
mutation guard and the enforcer still need to know which paths carry their own
proof.
