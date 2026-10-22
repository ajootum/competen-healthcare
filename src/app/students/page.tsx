import { permanentRedirect } from "next/navigation";
import { SCHOLAR } from "@/lib/marketing/individual-family";

// ⚠ A PERMANENT REDIRECT, NOT A DELETED PAGE. /students was a live, indexed route -- in the sitemap and in
// other people's links -- until COMPETEN-WEB-IND-001 made /scholar the canonical home of Competen Scholar
// (owner decision at the review GO). Deleting it would 404 every existing link; the controlled redirect
// is the pattern /hospitals set. It is absent from the sitemap: the sitemap names the canonical page.
export default function Page() {
  permanentRedirect(SCHOLAR.href);
}
