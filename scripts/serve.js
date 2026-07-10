// Tiny static server for local verification of the built app/ (not used in production).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve("app");
const PORT = process.env.PORT || 5173;
const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".webmanifest": "application/manifest+json", ".json": "application/json",
  ".png": "image/png", ".svg": "image/svg+xml"
};

http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/" || p.endsWith("/")) p += "index.html";
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); res.end("404"); return; }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`serving app/ on http://localhost:${PORT}`));
