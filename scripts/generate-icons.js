// Dependency-free PNG icon generator — draws a Cognac gauge/speedometer mark.
// Outputs icons/ used by the manifest + apple-touch-icon.
import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const cr = Buffer.alloc(4); cr.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, cr]);
}
function png(w, h, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (stride + 1)] = 0; rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride); }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const lerp = (a, b, t) => Math.round(a + (b - a) * t);

function icon(N, { maskable = false } = {}) {
  const A = hex("#b45816"), B = hex("#e2913f"), W = [255, 255, 255];
  const buf = Buffer.alloc(N * N * 4);
  const c = N / 2, R = 0.35 * N, r = 0.255 * N, corner = 0.2 * N, needle = -Math.PI / 4;
  const rounded = !maskable; // maskable = full-bleed square
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = (y * N + x) * 4;
    let a = 255;
    if (rounded) {
      const dx = Math.max(corner - x, x - (N - corner), 0), dy = Math.max(corner - y, y - (N - corner), 0);
      if (dx > 0 && dy > 0) { const d = Math.hypot(dx, dy); if (d > corner) a = 0; else if (d > corner - 1.5) a = Math.round((255 * (corner - d)) / 1.5); }
    }
    const t = (x + y) / (2 * N);
    let cr = lerp(A[0], B[0], t), cg = lerp(A[1], B[1], t), cb = lerp(A[2], B[2], t);
    const dist = Math.hypot(x - c, y - c);
    if (dist <= R && dist >= r) { cr = W[0]; cg = W[1]; cb = W[2]; }              // gauge ring
    if (dist <= r) {                                                             // needle
      const px = Math.cos(needle), py = Math.sin(needle);
      const proj = (x - c) * px + (y - c) * py;
      const perp = Math.abs(-(x - c) * py + (y - c) * px);
      if (proj > 0 && proj <= r - 0.02 * N && perp <= 0.035 * N) { cr = W[0]; cg = W[1]; cb = W[2]; }
    }
    if (dist <= 0.06 * N) { cr = W[0]; cg = W[1]; cb = W[2]; }                    // hub dot
    buf[i] = cr; buf[i + 1] = cg; buf[i + 2] = cb; buf[i + 3] = a;
  }
  return png(N, N, buf);
}

const dir = path.resolve("icons");
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "icon-192.png"), icon(192));
fs.writeFileSync(path.join(dir, "icon-512.png"), icon(512));
fs.writeFileSync(path.join(dir, "icon-512-maskable.png"), icon(512, { maskable: true }));
fs.writeFileSync(path.join(dir, "apple-touch-icon.png"), icon(180, { maskable: true })); // opaque square for iOS
console.log("icons generated → icons/");
