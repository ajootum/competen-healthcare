import { requireEducatorAccess } from "@/lib/educator-access";
import SoonModule from "../SoonModule";

// Module 6 — Quality Documents. No quality-document store yet (policies empty).
export const dynamic = "force-dynamic";

export default async function Documents() {
  await requireEducatorAccess();
  return (
    <SoonModule active="documents"
      note="No quality-document store exists yet (the policies table is empty). Governance of policies, procedures, manuals, templates and standards — with version control, approvals, publication and acknowledgements — is on the roadmap."
      kpis={["Active Docs", "Draft", "Due Review", "Expired", "Superseded"]}
      needs={[
        "A documents table with category, version, status and review dates.",
        "An approval + publication workflow with acknowledgement tracking.",
        "Expiry monitoring to surface documents due for review.",
      ]}
      links={[["Publishing & governance", "/educator/studio/publishing"]]} />
  );
}
