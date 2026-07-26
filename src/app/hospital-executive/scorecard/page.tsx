import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// Superseded by the Performance Management Centre (HEX-003). Kept as a redirect for old bookmarks.
export default function ScorecardRedirect() {
  redirect("/hospital-executive/performance");
}
