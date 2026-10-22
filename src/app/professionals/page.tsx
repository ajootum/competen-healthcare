import { permanentRedirect } from "next/navigation";
import { PROFESSIONAL } from "@/lib/marketing/individual-family";

// ⚠ A PERMANENT REDIRECT, NOT A DELETED PAGE -- see src/app/students/page.tsx. /professional is the
// canonical home of Competen Professional since COMPETEN-WEB-IND-001.
export default function Page() {
  permanentRedirect(PROFESSIONAL.href);
}
