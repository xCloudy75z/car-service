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
//    Hash EVERY built asset (except the two files we stamp afterwards) so any change
//    — HTML, JS, CSS, icons — bumps the version and the SW updates in place.
const hash = crypto.createHash("sha256");
(function walkHash(d) {
  for (const f of fs.readdirSync(d).sort()) {
    const fp = path.join(d, f);
    if (fs.statSync(fp).isDirectory()) { walkHash(fp); continue; }
    const rel = path.relative(APP, fp).replace(/\\/g, "/");
    if (rel === "sw.js" || rel === "build-info.js") continue;
    hash.update(rel);
    hash.update(fs.readFileSync(fp));
  }
})(APP);
const version = hash.digest("hex").slice(0, 10);
const swPath = path.join(APP, "sw.js");
fs.writeFileSync(swPath, fs.readFileSync(swPath, "utf8").replaceAll("__VERSION__", version));

// 4. Write the build stamp the app shows in Settings (version + timestamp).
const builtAt = new Date().toISOString();
fs.writeFileSync(path.join(APP, "build-info.js"), `export const BUILD = ${JSON.stringify({ version, builtAt })};\n`);

console.log(`built app/ · version ${version} · built ${builtAt}`);
