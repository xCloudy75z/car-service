// Fails the build if pure modules use nondeterminism, or any src JS uses an unsafe DOM sink.
import fs from "node:fs";
import path from "node:path";

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const bad = [];

const PURE = ["schema", "format", "validate", "migrate", "calc", "select"].map((n) => `src/${n}.js`);
for (const f of PURE) {
  const s = strip(fs.readFileSync(f, "utf8"));
  if (/\bDate\.now\s*\(/.test(s) || /\bMath\.random\s*\(/.test(s)) bad.push(`${f}: nondeterminism (Date.now/Math.random)`);
}

(function walk(d) {
  for (const f of fs.readdirSync(d)) {
    const fp = path.join(d, f);
    const st = fs.statSync(fp);
    if (st.isDirectory()) walk(fp);
    else if (fp.endsWith(".js")) {
      const s = strip(fs.readFileSync(fp, "utf8"));
      if (/\.innerHTML\s*=/.test(s) || /insertAdjacentHTML/.test(s) || /document\.write\s*\(/.test(s))
        bad.push(`${fp}: unsafe DOM sink (innerHTML/insertAdjacentHTML/document.write)`);
    }
  }
})("src");

if (bad.length) { console.error("lint:pure FAIL\n  " + bad.join("\n  ")); process.exit(1); }
console.log("lint:pure OK");
