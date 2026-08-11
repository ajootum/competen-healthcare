import type { Metadata } from "next";
import OfflineFrame from "./OfflineFrame";
import OfflineGate from "./OfflineGate";

// /practice/offline — CP-OFFLINE-SURVEY-001 s3.3 step 3.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ THIS DOCUMENT CONTAINS NO PATIENT DATA, AND THAT IS WHY IT IS ALLOWED TO BE CACHED BY THE SERVICE
// WORKER. It reads nothing on the server, renders nothing personal, and boots a client component that
// opens the encrypted store after it is already on screen. Everything disclosive lives in IndexedDB,
// where it can be labelled with its age, expired at the end of the clinic day and purged. A cached HTML
// page can be none of those things (s3.3).
//
// ⚠ IT IS DELIBERATELY OUTSIDE THE (shell) GROUP. The practice shell's layout runs the whole guard chain
// -- authentication, membership, workspace status, entitlement, onboarding, device revocation -- and
// every one of those is a database read. On a device with no connection they cannot run, so a page that
// sat inside the shell could never render at the moment it is needed. The cost is stated plainly: this
// route performs NO server-side authorisation, so it must never be given anything the server has not
// already released to this browser. It is not: it renders only what this browser previously stored for
// itself, encrypted with a key held in this browser.
//
// noindex because it is an application surface, and because a search result promising an offline clinic
// list would be the least honest sentence in the product.

export const metadata: Metadata = {
  title: "Offline · Competen Practice",
  robots: { index: false, follow: false },
};

export default function PracticeOfflinePage() {
  // ⚠ OfflineFrame is purpose-built and imports nothing from the (shell) group. See its header: this page
  // must render with no connection, and the shell's chrome sits behind six database reads.
  return (
    <OfflineFrame>
      {/* ⚠ The GATE, not the reader directly. The PIN is checked in the browser against a record only
          the browser holds, so this page still renders with no connection and no session. When no PIN is
          enrolled the gate passes straight through and behaves exactly as phase one did. */}
      <OfflineGate />
    </OfflineFrame>
  );
}
