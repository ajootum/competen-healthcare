// ── STRIP WHAT A PHOTO SAYS ABOUT WHERE AND HOW IT WAS TAKEN ── COMPETEN-INDIVIDUAL-IDENTITY-HUB-01 ─────────────
//
// A profile photo is stored privately (migration 590, bucket individual-photos), but it may still be shown on a
// Passport link the person chooses. Camera files carry EXIF (GPS position, device, time), XMP and IPTC. This removes
// those blocks without decoding or re-encoding the image, for the three accepted types:
//   JPEG  drops every APPn segment except APP0 (JFIF) and APP2 (the ICC colour profile), and every COM segment
//   PNG   drops eXIf, tEXt, zTXt, iTXt and tIME chunks
//   WebP  drops EXIF and XMP chunks, and clears the VP8X flags that announced them
// Anything it cannot parse is REFUSED (null), never stored as it came.
//
// Pure. No dependency: it reads the container structure only.

export type PhotoMime = "image/jpeg" | "image/png" | "image/webp";

export function stripImageMetadata(buf: Uint8Array, mime: PhotoMime): Uint8Array | null {
  try {
    if (mime === "image/jpeg") return stripJpeg(buf);
    if (mime === "image/png") return stripPng(buf);
    return stripWebp(buf);
  } catch { return null; }
}

/** The container says what it is, whatever the browser claimed. */
export function sniffImage(buf: Uint8Array): PhotoMime | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length > 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => buf[i] === b)) return "image/png";
  if (buf.length > 12 && ascii(buf, 0, 4) === "RIFF" && ascii(buf, 8, 4) === "WEBP") return "image/webp";
  return null;
}

const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));
const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};

function stripJpeg(b: Uint8Array): Uint8Array | null {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  const parts: Uint8Array[] = [b.subarray(0, 2)];
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    if (marker === 0xda) { parts.push(b.subarray(i)); return concat(parts); } // start of scan: image data to the end
    if (marker === 0xd9) { parts.push(b.subarray(i, i + 2)); return concat(parts); }
    if (marker >= 0xd0 && marker <= 0xd7) { parts.push(b.subarray(i, i + 2)); i += 2; continue; }
    const len = (b[i + 2] << 8) | b[i + 3];
    if (len < 2 || i + 2 + len > b.length) return null;
    const isApp = marker >= 0xe0 && marker <= 0xef;
    const keep = !(isApp && marker !== 0xe0 && marker !== 0xe2) && marker !== 0xfe;
    if (keep) parts.push(b.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  return null;
}

const PNG_DROP = new Set(["eXIf", "tEXt", "zTXt", "iTXt", "tIME"]);
function stripPng(b: Uint8Array): Uint8Array | null {
  const parts: Uint8Array[] = [b.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= b.length) {
    const len = ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
    const type = ascii(b, i + 4, 4);
    const end = i + 12 + len;
    if (end > b.length) return null;
    if (!PNG_DROP.has(type)) parts.push(b.subarray(i, end));
    i = end;
    if (type === "IEND") return concat(parts);
  }
  return null;
}

function stripWebp(b: Uint8Array): Uint8Array | null {
  if (ascii(b, 0, 4) !== "RIFF" || ascii(b, 8, 4) !== "WEBP") return null;
  const chunks: Uint8Array[] = [];
  let i = 12;
  while (i + 8 <= b.length) {
    const type = ascii(b, i, 4);
    const len = b[i + 4] | (b[i + 5] << 8) | (b[i + 6] << 16) | (b[i + 7] << 24);
    const end = i + 8 + len + (len % 2);
    if (len < 0 || end > b.length) return null;
    if (type !== "EXIF" && type !== "XMP ") {
      const chunk = b.slice(i, end);
      if (type === "VP8X" && chunk.length > 8) chunk[8] &= ~(0x08 | 0x04); // the EXIF and XMP flags
      chunks.push(chunk);
    }
    i = end;
  }
  const body = concat(chunks);
  const size = 4 + body.length;
  const head = new Uint8Array(12);
  head.set([0x52, 0x49, 0x46, 0x46, size & 0xff, (size >> 8) & 0xff, (size >> 16) & 0xff, (size >> 24) & 0xff, 0x57, 0x45, 0x42, 0x50]);
  return concat([head, body]);
}
