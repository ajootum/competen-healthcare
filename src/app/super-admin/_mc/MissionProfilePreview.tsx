import Link from "next/link";
import type { MissionProfile } from "@/lib/hq/mission-profile";
import { productLine } from "@/lib/governance/product-lines";

// PLAT-GOV-MC-001 acceptance 1 - "the same Mission Control shell renders materially different dashboards for
// Super Admin, each Product Director and customer governance roles".
//
// ⚠ THIS IS THE ONLY WAY TO CHECK THAT CLAIM WITHOUT BEING APPOINTED. Before this, verifying what a Practice
// Product Director sees meant appointing somebody and signing in as them. An owner can now look directly.
//
// ⚠ IT LINKS, IT DOES NOT SWITCH. Each entry is a plain link carrying ?preview=<code>. Nothing is stored, so
// there is no state to get stuck in and nothing to forge: the page honours the parameter only for owners,
// and composes a profile without granting it.
export default function MissionProfilePreview({ profiles }: { profiles: MissionProfile[] }) {
  if (!profiles.length) return null;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <h2 className="font-semibold text-gray-900 text-[15px]">Preview a governance dashboard</h2>
        <span className="text-[11px] text-gray-400">view only — your authority is unchanged</span>
      </div>
      <p className="text-xs text-gray-500 mb-3">
        See the Mission Control a position resolves to, without being appointed to it.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {profiles.map(p => {
          const line = productLine(p.productLineCode);
          return (
            <Link
              key={p.code}
              href={`/super-admin?preview=${encodeURIComponent(p.code)}`}
              className="text-xs px-2.5 py-1.5 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
            >
              {p.name}
              {line && <span className="text-gray-400"> · {line.name}</span>}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
