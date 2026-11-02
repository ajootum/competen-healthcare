// asmt core: canonical JSON and a pure SHA-256. No Web Crypto, no Node crypto: evaluate() stays synchronous and
// the same bytes are produced in the browser (live builder), on the server (submit, publish) and in tests.

/** Canonical JSON: object keys sorted, undefined dropped, arrays kept in order. Numbers use JSON.stringify. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v === "number" || typeof v === "boolean") return JSON.stringify(v);
  if (typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? "null" : canonicalJson(x))).join(",")}]`;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(",")}}`;
  }
  return "null";
}

function primes(n: number): number[] {
  const out: number[] = [];
  for (let c = 2; out.length < n; c++) {
    let p = true;
    for (const q of out) { if (q * q > c) break; if (c % q === 0) { p = false; break; } }
    if (p) out.push(c);
  }
  return out;
}
const frac32 = (x: number) => Math.floor((x - Math.floor(x)) * 4294967296) >>> 0;
const PR = primes(64);
const K = PR.map((p) => frac32(Math.cbrt(p)));
const H0 = PR.slice(0, 8).map((p) => frac32(Math.sqrt(p)));

const rotr = (x: number, n: number) => ((x >>> n) | (x << (32 - n))) >>> 0;

/** SHA-256 of the UTF-8 bytes of `s`, lower-case hex. */
export function sha256Hex(s: string): string {
  const bytes = new TextEncoder().encode(s);
  const len = bytes.length;
  const total = (((len + 9 + 63) >> 6) << 6);
  const buf = new Uint8Array(total);
  buf.set(bytes);
  buf[len] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(total - 8, Math.floor((len * 8) / 4294967296), false);
  dv.setUint32(total - 4, (len * 8) >>> 0, false);
  const h = H0.slice();
  const w = new Uint32Array(64);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const mj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + mj) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  }
  return h.map((x) => x.toString(16).padStart(8, "0")).join("");
}

/** Hash of any JSON-able document (rules, layout, progression): sha256 over canonical JSON. */
export const hashDoc = (doc: unknown): string => sha256Hex(canonicalJson(doc));

/** Round to 6 decimals so a trace hash cannot differ by floating point noise. */
export const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;
