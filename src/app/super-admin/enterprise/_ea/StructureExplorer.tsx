"use client";

import { useState } from "react";
import Link from "next/link";

// Enterprise Structure Explorer (ENT-001) — collapsible network → organisation →
// facility → department → unit tree, built entirely from real rows.
/* eslint-disable @typescript-eslint/no-explicit-any */

const ICON: Record<string, string> = { network: "🌐", organisation: "🏛️", facility: "🏥", department: "🗂️", unit: "🔹" };

function Node({ label, kind, depth, badge, badgeTone, hasChildren, open, onToggle, href }: {
  label: string; kind: string; depth: number; badge?: string; badgeTone?: string;
  hasChildren?: boolean; open?: boolean; onToggle?: () => void; href?: string;
}) {
  return (
    <div className={`flex items-center gap-1.5 py-1.5 pr-2 rounded-md ${onToggle ? "cursor-pointer hover:bg-gray-50" : ""}`}
      style={{ paddingLeft: `${depth * 16 + 4}px` }} onClick={onToggle}>
      <span className={`text-gray-300 text-[10px] w-3 shrink-0 ${hasChildren ? "" : "opacity-0"}`}>{open ? "▾" : "▸"}</span>
      <span className="text-sm leading-none">{ICON[kind]}</span>
      {href
        ? <Link href={href} onClick={e => e.stopPropagation()} className={`truncate ${kind === "network" || kind === "organisation" ? "font-semibold text-gray-900" : "text-gray-700"} hover:text-teal-700 hover:underline`}>{label}</Link>
        : <span className={`truncate ${kind === "network" || kind === "organisation" ? "font-semibold text-gray-900" : "text-gray-700"}`}>{label}</span>}
      {badge && <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${badgeTone ?? "bg-gray-100 text-gray-500"}`}>{badge}</span>}
    </div>
  );
}

export default function StructureExplorer({ networks, standalone }: { networks: any[]; standalone: any[] }) {
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    const first = networks[0] ?? standalone[0];
    return first ? { [first.id]: true } : {};
  });
  const t = (id: string) => setOpen(s => ({ ...s, [id]: !s[id] }));

  const renderOrg = (o: any, depth: number) => (
    <div key={o.id}>
      <Node label={o.name} kind="organisation" depth={depth} hasChildren={o.facilities.length > 0} open={open[o.id]} onToggle={() => t(o.id)}
        badge={`${o.facilities.length} ${o.facilities.length === 1 ? "facility" : "facilities"}`} />
      {open[o.id] && o.facilities.map((f: any) => (
        <div key={f.id}>
          <Node label={f.name} kind="facility" depth={depth + 1} hasChildren={f.departments.length > 0} open={open[f.id]} onToggle={() => t(f.id)}
            href="/super-admin/hospitals" badge={f.active ? "Active" : "Pending"} badgeTone={f.active ? "bg-green-50 text-green-600" : "bg-amber-50 text-amber-600"} />
          {open[f.id] && f.departments.map((d: any) => (
            <div key={d.id}>
              <Node label={d.name} kind="department" depth={depth + 2} hasChildren={d.units.length > 0} open={open[d.id]} onToggle={d.units.length ? () => t(d.id) : undefined} />
              {open[d.id] && d.units.map((u: any) => <Node key={u.id} label={u.name} kind="unit" depth={depth + 3} />)}
            </div>
          ))}
        </div>
      ))}
    </div>
  );

  const empty = networks.length === 0 && standalone.length === 0;
  return (
    <div className="text-sm">
      {empty && <p className="text-gray-400 py-6 text-center">No organisational structure registered yet.</p>}
      {networks.map(n => (
        <div key={n.id}>
          <Node label={n.name} kind="network" depth={0} hasChildren={n.organisations.length > 0} open={open[n.id]} onToggle={() => t(n.id)}
            badge={`${n.organisations.length} ${n.organisations.length === 1 ? "org" : "orgs"}`} badgeTone="bg-indigo-50 text-indigo-600" />
          {open[n.id] && n.organisations.map((o: any) => renderOrg(o, 1))}
        </div>
      ))}
      {standalone.length > 0 && standalone.map(o => renderOrg(o, 0))}
    </div>
  );
}
