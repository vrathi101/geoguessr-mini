/**
 * GeoGuessr Mini — Dev Server
 * Reads GOOGLE_MAPS_API_KEY from .env and injects it into index.html at serve time.
 * Run: node server.js
 * Then open: http://localhost:3000
 */

"use strict";

const http = require("http");
const fs   = require("fs");
const path = require("path");

// ─── Load .env ────────────────────────────────────────────
function loadEnv() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    // Support both `KEY=VALUE` and `export KEY=VALUE`
    const match = trimmed.match(/^(?:export\s+)?([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match) {
      const [, key, val] = match;
      if (!process.env[key]) process.env[key] = val.replace(/^["']|["']$/g, "");
    }
  }
}

loadEnv();

const API_KEY      = process.env.GOOGLE_MAPS_API_KEY || "";
const SUPABASE_URL = process.env.SUPABASE_URL        || "";
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY   || "";
const PORT         = process.env.PORT || 3000;
const ROOT         = __dirname;

// ─── MIME types ───────────────────────────────────────────
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".json": "application/json",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".svg":  "image/svg+xml",
  ".ico":  "image/x-icon",
};

// ─── Server ───────────────────────────────────────────────
const server = http.createServer((req, res) => {
  // Normalize URL — default to index.html
  let urlPath = req.url.split("?")[0];
  if (urlPath === "/" || urlPath === "") urlPath = "/index.html";

  // ── GET /api/config — must be checked before filesystem lookup ──
  if (urlPath === "/api/config" && req.method === "GET") {
    const payload = JSON.stringify({
      mapsKey:        API_KEY,
      supabaseUrl:    SUPABASE_URL,
      supabaseAnonKey: SUPABASE_KEY,
    });
    res.writeHead(200, {
      "Content-Type":  "application/json",
      "Cache-Control": "public, max-age=300",
    });
    res.end(payload);
    return;
  }

  const filePath = path.join(ROOT, urlPath);

  // Security: prevent path traversal outside ROOT
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  // Security: block sensitive files from being served
  const basename = path.basename(filePath);
  if (basename === ".env" || basename.startsWith(".env.")) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end(`Not found: ${urlPath}`);
      return;
    }

    const ext      = path.extname(filePath).toLowerCase();
    const mimeType = MIME[ext] || "application/octet-stream";

    // Inject config values into index.html
    if (ext === ".html") {
      let html = data.toString("utf8");

      // Replace APP_CONFIG object (new pattern)
      html = html.replace(
        /window\.APP_CONFIG\s*=\s*\{[^}]*\};/,
        `window.APP_CONFIG = ${JSON.stringify({ mapsKey: API_KEY, supabaseUrl: SUPABASE_URL, supabaseAnonKey: SUPABASE_KEY })};`
      );

      // Backward compat: replace legacy GOOGLE_MAPS_API_KEY assignment if present
      html = html.replace(
        /window\.GOOGLE_MAPS_API_KEY\s*=\s*["'][^"']*["']\s*;/,
        `window.GOOGLE_MAPS_API_KEY = "${API_KEY}";`
      );

      res.writeHead(200, { "Content-Type": mimeType });
      res.end(html, "utf8");
      return;
    }

    res.writeHead(200, { "Content-Type": mimeType });
    res.end(data);
  });
});

server.listen(PORT, () => {
  if (!API_KEY) {
    console.warn("⚠️  WARNING: GOOGLE_MAPS_API_KEY not found in .env — game will show API key error.");
  } else {
    console.log(`✅  API key loaded from .env`);
  }
  console.log(`🌍  GeoGuessr Mini running at http://localhost:${PORT}`);
  console.log(`    Press Ctrl+C to stop.`);
});
