// Assemble the deployable app into app/ (served at …/car-service/app/).
// Copies the src module tree as-is (ES modules over http need no bundling), adds the
// generated icons, and stamps a content-hash version into sw.js so every deploy updates.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = process.cwd();
const SRC = path.join(ROOT, "src");
const APP = path.join(ROOT, "app");
const ICONS = path.join(ROOT, "icons");

const cp = (a, b) => { fs.mkdirSync(path.dirname(b), { recursive: true }); fs.copyFileSync(a, b); };

fs.rmSync(APP, { recursive: true, force: true });
fs.mkdirSync(APP, { recursive: true });

// 1. Copy the entire src tree (index.html, *.js, ui/*, styles/*, sw.js, manifest) preserving structure.
(function walk(d) {
  for (const f of fs.readdirSync(d)) {
    const fp = path.join(d, f);
    if (fs.statSync(fp).isDirectory()) walk(fp);
    else cp(fp, path.join(APP, path.relative(SRC, fp)));
  }
})(SRC);

// 2. Copy generated icons.
if (fs.existsSync(ICONS)) for (const f of fs.readdirSync(ICONS)) cp(path.join(ICONS, f), path.join(APP, "icons", f));

// 3. Stamp a content-hash version into the service worker's cache name.
const hashInput = fs.readFileSync(path.join(APP, "index.html")) + fs.readFileSync(path.join(APP, "app.js"));
const version = crypto.createHash("sha256").update(hashInput).digest("hex").slice(0, 10);
const swPath = path.join(APP, "sw.js");
fs.writeFileSync(swPath, fs.readFileSync(swPath, "utf8").replaceAll("__VERSION__", version));

const size = fs.readdirSync(APP).length;
console.log(`built app/ · sw cache car-service-${version} · ${size} top-level entries`);
