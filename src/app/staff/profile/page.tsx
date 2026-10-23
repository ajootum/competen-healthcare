import Link from "next/link";
import { requireHqCapability } from "@/lib/hq/context";
import { HQ_HOME_CAPABILITY } from "@/lib/hq/spaces";
import OwnProfileCard from "@/components/account/OwnProfileCard";
import StaffFrame from "../_components/StaffFrame";

// /staff/profile -- My profile for Competen HQ staff (owner review GO 2026-10-23, PR D item 3).
//
// ⚠ WHY HERE AND NOT UNDER /super-admin. The HQ shell's layout runs the estate gate (admitToEstate) before
// its HQ door, so an HQ appointee WITHOUT estate membership can enter no /super-admin page at all -- and no
// estate shell either. They land on the Staff Access surface (/staff/workspaces, PRACTICE_ONLY). This page
// sits on that same surface, in its own frame: no new app shell, and no estate membership required.
//
// ⚠ THE GATE: a signed-in session that holds HQ access. requireHqCapability(HQ_HOME_CAPABILITY) -- the one
// capability every HQ position grants -- resolved by the canonical HQ resolver, enforced whatever
// hq_config.mode says. No estate check, on purpose. It shows the SAME shared card and API as every other
// shell (src/components/account/OwnProfileCard.tsx, /api/account/profile): own row only, written through
// the person's own session, and it can change no access.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "My profile — Competen Staff Access",
};

export default async function StaffProfilePage() {
  const ctx = await requireHqCapability(HQ_HOME_CAPABILITY);
  return (
    <StaffFrame name={ctx.fullName} profileHref={null} wide>
      <p className="mb-3 text-[13px]">
        <Link href="/staff/workspaces" className="font-semibold text-teal-400 hover:underline">← Your workspaces</Link>
      </p>
      <OwnProfileCard credentialsNote={<>Your HQ positions are appointments made by Competen. They are shown under Your access and are not changed here.</>} />
    </StaffFrame>
  );
}
