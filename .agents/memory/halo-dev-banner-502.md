---
name: Dev-banner 502 under base-pathed artifacts
description: Why base-pathed Vite artifacts log a 502/404 for the Replit dev banner script and how to fix it
---

The `@replit/vite-plugin-dev-banner` plugin injects its script with a root-relative src (`/@replit/vite-plugin-dev-banner/banner-script.js`) and serves it via a middleware matching that exact path. In artifacts served under a base path (e.g. `/board/`), the browser request escapes the base and is routed by the workspace proxy to the root artifact — 502 whenever that service isn't running, or silently served by the root app's own dev server when it is.

**Fix pattern** (see client-dashboard `vite.config.ts`, plugin `rebase-dev-banner-script`): a post `transformIndexHtml` rewrites the src to `${base}@replit/...`, plus a `configureServer` middleware that serves the script at the rebased path. Note: `configureServer` middlewares see the URL WITH the base still attached (base is stripped later in Vite's internal stack), and the package's exports map blocks subpath resolve — resolve the package main and join `banner-script.js` from its dirname.

**How to apply:** any base-pathed dev artifact showing a mystery 502/404 on load; halo-desktop and devportal have the same latent issue.
