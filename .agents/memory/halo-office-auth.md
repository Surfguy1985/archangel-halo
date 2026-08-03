---
name: HALO office passcode gate
description: Office API is now passcode-locked; allowlist of public token surfaces lives in officeAuth.ts
---
The office API surface (/jobs, /invoices, /admin, /settings, ...) is gated by `officeGuard` in api-server's officeAuth lib: scrypt passcode hash stored in business_settings.office_passcode_hash (survives Settings reset), HMAC httpOnly cookie `halo_office_session` (30d, path /api). Frontend `OfficeGate` wraps ONLY the office route trees in halo + halo-desktop (two copies).
**Why:** clients/anyone with the URL could previously call all office endpoints; user chose lockdown (supersedes the old "no-auth by design" posture for office routes — client/crew token portals remain no-login).
**How to apply:** any NEW public surface (token link, webhook, share page) must be added to PUBLIC_PREFIXES in officeAuth.ts or it will 401 for clients/crews. New office routes need nothing. Presentation demo exemption: only POST card.moved on the active demo property, rate-limited. First-run: office app shows create-passcode screen while hash is NULL. Offline PWA boot falls back to localStorage halo_office_gate_ok flag.
