/**
 * Standalone production server for Expo static builds.
 *
 * Serves the output of build.js (static-build/) with two special routes:
 * - GET / or /manifest with expo-platform header → platform manifest JSON
 * - GET / without expo-platform → landing page HTML
 * Everything else falls through to static file serving from ./static-build/.
 *
 * Zero external dependencies — uses only Node.js built-ins (http, fs, path).
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const STATIC_ROOT = path.resolve(__dirname, '..', 'static-build');
const TEMPLATE_PATH = path.resolve(__dirname, 'templates', 'landing-page.html');
const basePath = (process.env.BASE_PATH || '/').replace(/\/+$/, '');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.map': 'application/json',
};

function getAppName() {
  try {
    const appJsonPath = path.resolve(__dirname, '..', 'app.json');
    const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf-8'));
    return typeof appJson.expo?.name === 'string'
      ? appJson.expo.name
      : 'App Landing Page';
  } catch {
    return 'App Landing Page';
  }
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function toScriptString(value) {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026');
}

function serveManifest(platform, res) {
  const manifestPath = path.join(STATIC_ROOT, platform, 'manifest.json');

  if (!fs.existsSync(manifestPath)) {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({ error: `Manifest not found for platform: ${platform}` }),
    );
    return;
  }

  const manifest = fs.readFileSync(manifestPath, 'utf-8');
  res.writeHead(200, {
    'content-type': 'application/json',
    'expo-protocol-version': '1',
    'expo-sfv-version': '0',
  });
  res.end(manifest);
}

function serveLandingPage(req, res, landingPageTemplate, appName) {
  const forwardedProto = req.headers['x-forwarded-proto'];
  const protocol = forwardedProto || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers['host'];
  const baseUrl = `${protocol}://${host}`;
  const expsUrl = `exps://${host}${basePath}`;

  const html = landingPageTemplate
    .replace(/BASE_URL_PLACEHOLDER/g, baseUrl)
    .replace(/EXPS_URL_ATTRIBUTE_PLACEHOLDER/g, escapeHtml(expsUrl))
    .replace(/EXPS_URL_JSON_PLACEHOLDER/g, toScriptString(expsUrl))
    .replace(/APP_NAME_PLACEHOLDER/g, escapeHtml(appName));

  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}

function serveStaticFile(urlPath, res) {
  const safePath = path.normalize(urlPath).replace(/^(\.\.(\/|\\|$))+/, '');
  const filePath = path.join(STATIC_ROOT, safePath);

  if (!filePath.startsWith(STATIC_ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  const content = fs.readFileSync(filePath);
  res.writeHead(200, { 'content-type': contentType });
  res.end(content);
}

const landingPageTemplate = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
const appName = getAppName();

/**
 * Serves an auto-auth HTML page for /portal/:token.
 *
 * The office sends crews a link like:
 *   https://[domain]/halo-crew/portal/<token>
 *
 * The crew taps the link on their phone → browser opens this handler →
 * the page stores the token in localStorage (same key the Expo web app reads),
 * attempts to open the native app via deep link, then redirects to the
 * app's root so the AuthProvider picks up the stored token automatically.
 */
function servePortalRedirect(token, req, res) {
  const forwardedProto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers['host'];
  // Root of the halo-crew web app (basePath already stripped at call site, so add it back)
  const crewRoot = `${forwardedProto}://${host}${basePath}/`;
  const safeToken = token.replace(/[^a-zA-Z0-9_\-]/g, '');

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>HALO Crew — Connecting…</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#07101E;color:#F4F7F9;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:32px 20px}
    .card{background:#13223A;border-radius:20px;padding:36px 28px;max-width:400px;width:100%;text-align:center;border:1px solid rgba(140,160,185,0.14)}
    .icon{width:72px;height:72px;border-radius:36px;background:rgba(180,255,68,0.10);border:1px solid rgba(180,255,68,0.22);display:flex;align-items:center;justify-content:center;margin:0 auto 24px;font-size:32px}
    h1{font-size:22px;font-weight:700;margin-bottom:10px}
    p{font-size:15px;color:#8CA0B9;line-height:1.6;margin-bottom:28px}
    .spinner{width:32px;height:32px;border:3px solid rgba(180,255,68,0.2);border-top-color:#B4FF44;border-radius:50%;animation:spin .8s linear infinite;margin:0 auto 16px}
    @keyframes spin{to{transform:rotate(360deg)}}
    .status{font-size:13px;color:#8CA0B9}
    .btn{display:inline-block;margin-top:24px;background:#B4FF44;color:#07101E;font-weight:700;font-size:16px;padding:14px 32px;border-radius:12px;text-decoration:none;cursor:pointer;border:none}
    .btn:hover{opacity:.9}
  </style>
</head>
<body>
<div class="card">
  <div class="icon">🛡️</div>
  <h1>HALO Crew</h1>
  <p>Connecting your crew account…</p>
  <div class="spinner" id="spinner"></div>
  <div class="status" id="status">Saving your link…</div>
  <button class="btn" id="openBtn" style="display:none" onclick="openApp()">Open HALO Crew</button>
</div>
<script>
  var TOKEN = ${JSON.stringify(safeToken)};
  var CREW_ROOT = ${JSON.stringify(crewRoot)};

  function openApp() {
    window.location.href = CREW_ROOT;
  }

  (function() {
    try {
      // Store token under the same key the Expo/React Native AsyncStorage uses on web.
      // AsyncStorage on web maps to localStorage with the key pattern:
      //   @RN:token_key  (some versions)  or just the raw key
      // The app uses TOKEN_KEY = 'halo_crew_token'
      localStorage.setItem('halo_crew_token', TOKEN);
      // Expo AsyncStorage on web also stores under this namespace
      localStorage.setItem('@halo_crew_token', TOKEN);

      document.getElementById('status').textContent = 'Redirecting to the app…';
    } catch(e) {
      document.getElementById('status').textContent = 'Tap the button below to open the app.';
    }

    // Try native deep link first (works if app is installed)
    try {
      window.location.href = 'halo-crew://portal/' + TOKEN;
    } catch(e) {}

    // After a short delay, redirect to the web app root
    setTimeout(function() {
      try {
        window.location.href = CREW_ROOT;
      } catch(e) {
        document.getElementById('spinner').style.display = 'none';
        document.getElementById('status').textContent = 'Tap below to open the app.';
        document.getElementById('openBtn').style.display = 'inline-block';
      }
    }, 1200);
  })();
</script>
</body>
</html>`;

  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  let pathname = url.pathname;

  if (basePath && pathname.startsWith(basePath)) {
    pathname = pathname.slice(basePath.length) || '/';
  }

  // Auto-auth handler: /portal/:token
  const portalMatch = pathname.match(/^\/portal\/([^/?#]+)/);
  if (portalMatch) {
    return servePortalRedirect(portalMatch[1], req, res);
  }

  if (pathname === '/' || pathname === '/manifest') {
    const platform = req.headers['expo-platform'];
    if (platform === 'ios' || platform === 'android') {
      return serveManifest(platform, res);
    }

    if (pathname === '/') {
      return serveLandingPage(req, res, landingPageTemplate, appName);
    }
  }

  serveStaticFile(pathname, res);
});

const port = parseInt(process.env.PORT || '3000', 10);
server.listen(port, '0.0.0.0', () => {
  console.log(`Serving static Expo build on port ${port}`);
});
