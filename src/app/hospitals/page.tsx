import { permanentRedirect } from "next/navigation";

// ⚠ A PERMANENT REDIRECT, NOT A DELETED PAGE. /hospitals was a live, indexed route -- in the sitemap and
// in other people's links -- until WEB-HOME-001 s20 renamed the pathway to /organisations (owner's
// decision, 2026-08-11). Deleting it would 404 every existing link; a controlled redirect is what
// ENT-NAV-001 s8 asks for in exactly this case. It is deliberately absent from the sitemap now: the
// canonical page is /organisations, and search engines follow a 308 to the truth.
export default function Page() {
  permanentRedirect("/organisations");
}
