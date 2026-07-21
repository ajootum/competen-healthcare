"use client";

import { useState } from "react";
import Link from "next/link";

// Enterprise Explorer (MC-001) — collapsible org → country → facility → department
// tree, built entirely from real organisations/hospitals/departments rows.
/* eslint-disable @typescript-eslint/no-explicit-any */

function Row({ depth, children, onClick, open, hasChildren }: { depth: number; children: React.ReactNode; onClick?: () => void; open?: boolean; hasChildren?: boolean }) {
  return (
    <div onClick={onClick}
      className={`flex items-center gap-1.5 py-1.5 pr-2 rounded-md ${onClick ? "cursor-pointer hover:bg-gray-50" : ""}`}
      style={{ paddingLeft: `${depth * 16 + 4}px` }}>
      <span className={`text-gray-300 text-[10px] w-3 shrink-0 ${hasChildren ? "" : "opacity-0"}`}>{open ? "▾" : "▸"}</span>
      {children}
    </div>
  );
}

export default function EnterpriseExplorer({ orgs, unassigned }: { orgs: any[]; unassigned: number }) {
  const [openOrg, setOpenOrg] = useState<Record<string, boolean>>(() => (orgs[0] ? { [orgs[0].id]: true } : {}));
  const [openCountry, setOpenCountry] = useState<Record<string, boolean>>({});
  const [openFac, setOpenFac] = useState<Record<string, boolean>>({});

  return (
    <div className="text-sm">
      {orgs.length === 0 && <p className="text-gray-400 py-6 text-center">No organisations registered yet.</p>}
      {orgs.map(o => (
        <div key={o.id}>
          <Row depth={0} hasChildren={o.countries.length > 0} open={openOrg[o.id]} onClick={() => setOpenOrg(s => ({ ...s, [o.id]: !s[o.id] }))}>
            <span className="text-base">🏛️</span>
            <span className="font-semibold text-gray-900 truncate">{o.name}</span>
            <span className={`ml-1 text-[9px] px-1.5 py-0.5 rounded font-medium ${o.active ? "bg-green-50 text-green-600" : "bg-gray-100 text-gray-500"}`}>{o.active ? "Active" : "Setup"}</span>
            <span className="ml-auto text-[10px] text-gray-400 tabular-nums shrink-0">{o.countryCount} {o.countryCount === 1 ? "country" : "countries"} · {o.facilityCount} facilities</span>
          </Row>
          {openOrg[o.id] && o.countries.map((c: any) => {
            const ckey = `${o.id}:${c.country}`;
            return (
              <div key={ckey}>
                <Row depth={1} hasChildren open={openCountry[ckey]} onClick={() => setOpenCountry(s => ({ ...s, [ckey]: !s[ckey] }))}>
                  <span className="text-base leading-none">{c.flag}</span>
                  <span className="text-gray-700">{c.country}</span>
                  <span className="ml-auto text-[10px] text-gray-400 tabular-nums shrink-0">{c.facilities.length} {c.facilities.length === 1 ? "facility" : "facilities"}</span>
                </Row>
                {openCountry[ckey] && c.facilities.map((f: any) => (
                  <div key={f.id}>
                    <Row depth={2} hasChildren={f.departments.length > 0} open={openFac[f.id]} onClick={f.departments.length ? () => setOpenFac(s => ({ ...s, [f.id]: !s[f.id] })) : undefined}>
                      <span className="text-sm">🏥</span>
                      <Link href="/super-admin/hospitals" onClick={e => e.stopPropagation()} className="text-gray-700 hover:text-teal-700 hover:underline truncate">{f.name}</Link>
                      <span className={`ml-1.5 text-[9px] px-1.5 py-0.5 rounded font-medium ${f.active ? "bg-green-50 text-green-600" : "bg-amber-50 text-amber-600"}`}>{f.active ? "Active" : "Pending"}</span>
                    </Row>
                    {openFac[f.id] && f.departments.map((d: string, i: number) => (
                      <Row key={i} depth={3}>
                        <span className="w-1.5 h-1.5 rounded-full bg-teal-400 shrink-0" />
                        <span className="text-gray-500 text-xs">{d}</span>
                      </Row>
                    ))}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      ))}
      {unassigned > 0 && (
        <Row depth={0}>
          <span className="text-base">📍</span>
          <span className="text-gray-500 text-xs">{unassigned} facilit{unassigned > 1 ? "ies" : "y"} not yet linked to an organisation</span>
        </Row>
      )}
    </div>
  );
}
