// The entry esbuild bundles for the durability harness. ⚠ IT ADDS NO LOGIC OF ITS OWN.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// The whole value of a browser durability test is that it exercises THE REAL MODULE. A fixture that
// reimplemented the write -- or that drove raw IndexedDB -- would prove that IndexedDB is durable, which
// nobody doubts, and would say nothing about `outbox-store.ts`. So this file only re-exports.
//
// ⚠ IT IS NEVER PART OF THE APPLICATION BUILD. It lives under scripts/, nothing in src imports it, and it
// reaches a browser only because the harness injects the bundle into a page it controls. There is no
// route, no page and no production surface -- which is the reason this shape was chosen over a dev-only
// test page that exposed the outbox on `window` for anybody who found the URL.

import {
  outboxAccept, outboxExport, outboxLoad, outboxRemoveDelivered, outboxSave,
} from "@/lib/practice/outbox-store";

// ⚠ NO `declare global` HERE. The harness declares `Window.__outbox` with the shape it calls; declaring
// it a second time with a looser shape makes the two declarations disagree and tsc rejects both files.
// This side is the producer and does not need the type at all -- it assigns through a cast, once.
//
// ⚠ Only what a durability test needs. Every extra export is a piece of the outbox reachable from a page
// the harness controls, and there is no reason to widen that for symmetry.
(window as unknown as { __outbox: unknown }).__outbox = {
  outboxAccept, outboxLoad, outboxSave, outboxExport, outboxRemoveDelivered,
};
