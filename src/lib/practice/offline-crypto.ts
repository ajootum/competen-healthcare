// CP-OFFLINE-SURVEY-001 s3.6 / s3.8.5 — encryption at rest in the browser, and EXACTLY what it does.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ READ THIS BEFORE WRITING ANY SENTENCE ABOUT IT IN THE UI.
//
// AES-GCM with a non-extractable key held in IndexedDB DEFENDS AGAINST:
//   * casual inspection of the browser store by somebody at the machine who is not attacking it;
//   * another origin reading it -- though same-origin policy already provides that and encryption adds
//     nothing there;
//   * a file-level copy of the browser profile, or a forensic disk image, taken WITHOUT script execution
//     on this origin.
//
// IT DOES NOT DEFEND AGAINST:
//   * any XSS on this origin. Script on the page can call decrypt() with the same key handle. The key and
//     the ciphertext live in the same trust domain; that is the whole problem and it is not fixable here;
//   * a compromised or malware-bearing device;
//   * a shared clinic computer where the next user opens the same browser profile;
//   * a stolen unlocked device.
//
// `extractable: false` stops the KEY BYTES being exfiltrated. It does not stop the PLAINTEXT, because the
// page can still ask the browser to decrypt. It raises cost; it does not change the category.
//
// ⚠ SO IT MUST NOT CHANGE ONE WORD OF WHAT THE UI CLAIMS. The disclaimers in src/lib/practice/security.ts
// and practice/privacy/security/page.tsx -- which say in writing that "AES-256" describes a DEPLOYMENT
// claim this application does not make -- stay exactly as they are. The honest summary for a practice is:
// this reduces casual exposure; it does not make a lost laptop safe. That sentence, and no stronger one,
// is what OFFLINE_ENCRYPTION_NOTE below carries to the screen.
//
// It is implemented anyway because it is cheap, it raises the floor, and it makes the eventual desktop
// story -- where an OS keystore makes the claim true -- a continuation rather than a rewrite.

/** ⚠ The ONLY sentence about encryption that any offline surface may print. Do not extend it. */
export const OFFLINE_ENCRYPTION_NOTE =
  "What is held on this device is encrypted in the browser. That reduces casual exposure — someone "
  + "poking at the browser's storage, or copying the profile off the disk. It does not make a lost or "
  + "shared device safe: anything that can run as this site can read it back.";

export type SealedRecord = {
  /** 96-bit nonce, fresh for every write. Never reused with the same key. */
  iv: ArrayBuffer;
  ciphertext: ArrayBuffer;
};

const subtle = (): SubtleCrypto => {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c?.subtle) throw new Error("Web Crypto is not available in this browser, so nothing is stored offline.");
  return c.subtle;
};

/**
 * A fresh AES-GCM key that cannot be exported.
 *
 * Generated per device+workspace and kept in IndexedDB beside the ciphertext. There is no password and no
 * derivation, deliberately: a PIN-derived key would be the honest design, and PIN unlock DOES NOT EXIST
 * yet (the lock screen uses signInWithPassword, which needs the network). Inventing a key-stretching
 * ceremony around a secret nobody is asked for would produce a stronger-looking system with identical
 * properties. Local re-authentication is recorded as the prerequisite for the CAPTURE phase, not faked
 * here.
 */
export async function generateCacheKey(): Promise<CryptoKey> {
  return subtle().generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function sealRecord(key: CryptoKey, value: unknown): Promise<SealedRecord> {
  const iv = new Uint8Array(12);
  (globalThis as unknown as { crypto: Crypto }).crypto.getRandomValues(iv);
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = await subtle().encrypt({ name: "AES-GCM", iv }, key, plaintext);
  // `.slice()` so the stored buffer is not a view onto a longer one -- structured clone would carry the
  // whole backing store.
  return { iv: iv.buffer.slice(0), ciphertext };
}

/**
 * ⚠ NULL ON FAILURE, NEVER A THROW AND NEVER A PARTIAL.
 *
 * AES-GCM authenticates: a record altered on disk, or read with a different key, fails the tag check and
 * decrypt rejects. A caller that got an exception here would be tempted to catch it and carry on with
 * whatever it had; null makes "this record cannot be trusted" the only available answer, and the reader
 * treats it exactly as it treats an absent record.
 */
export async function openRecord<T>(key: CryptoKey, sealed: SealedRecord): Promise<T | null> {
  try {
    const plaintext = await subtle().decrypt({ name: "AES-GCM", iv: sealed.iv }, key, sealed.ciphertext);
    return JSON.parse(new TextDecoder().decode(plaintext)) as T;
  } catch {
    return null;
  }
}
