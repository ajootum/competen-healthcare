"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import NavLink from "@/components/NavLink";
import NavGroup from "@/components/NavGroup";
import RoleSwitcher from "@/components/RoleSwitcher";
import type { AppRole } from "@/lib/roles";

// Super-admin sidebar with dedicated workspace shells. Inside /super-admin/ckp/*
// it renders the Clinical Knowledge Platform nav, and inside /super-admin/ai/*
// the AI & Intelligence Platform nav (each with NAVIGATION + QUICK ACCESS),
// matching their mockups; elsewhere it renders the full Mission Control nav.
// Branches on the pathname so the swap is instant on client navigation.
/* eslint-disable @typescript-eslint/no-explicit-any */

const GENERAL_NAV = [
  { group: "MISSION CONTROL", items: [
    { label: "Overview", href: "/super-admin", icon: "🎛️" },
    { label: "Command Centre", href: "/super-admin/command-centre", icon: "📡" },
  ]},
  { group: "ENTERPRISE ADMINISTRATION", items: [
    { label: "Overview", href: "/super-admin/enterprise", icon: "🏢" },
    { label: "Organisations", href: "/super-admin/enterprise/organisations", icon: "🏛️" },
    { label: "Networks", href: "/super-admin/enterprise/networks", icon: "🌐" },
    { label: "Facilities", href: "/super-admin/enterprise/facilities", icon: "🏥" },
    { label: "Structure Builder", href: "/super-admin/enterprise/structure", icon: "🗂️" },
    { label: "People & Roles", href: "/super-admin/enterprise/people", icon: "👥" },
    { label: "Enterprise Templates", href: "/super-admin/enterprise/templates", icon: "📦" },
    { label: "Bulk Import", href: "/super-admin/import", icon: "📥" },
  ]},
  { group: "PLATFORM OPERATIONS", items: [
    { label: "Overview", href: "/super-admin/platform-ops", icon: "🎛️" },
    { label: "Tenant Operations", href: "/super-admin/platform-ops/tenants", icon: "🏢" },
    { label: "Workspaces", href: "/super-admin/platform-ops/workspaces", icon: "🖥️" },
    { label: "Licensing", href: "/super-admin/platform-ops/licensing", icon: "🧾" },
    { label: "Monitoring", href: "/super-admin/platform-ops/monitoring", icon: "📡" },
    { label: "AI Gateway", href: "/super-admin/platform-ops/ai-gateway", icon: "✨" },
    { label: "Notifications", href: "/super-admin/platform-ops/notifications", icon: "📨" },
    { label: "Approvals", href: "/super-admin/platform-ops/approvals", icon: "🔀" },
    { label: "Control Plane", href: "/super-admin/platform-ops/control-plane", icon: "🧭" },
    { label: "Platform Workspace", href: "/platform-admin", icon: "🛰️" },
  ]},
  { group: "CLINICAL KNOWLEDGE PLATFORM", items: [
    { label: "Open CKP →", href: "/super-admin/ckp", icon: "📚" },
  ]},
  { group: "AI & INTELLIGENCE", items: [
    { label: "Open AI & Intelligence →", href: "/super-admin/ai", icon: "🧠" },
  ]},
  { group: "GOVERNANCE & COMPLIANCE", items: [
    { label: "Open Governance →", href: "/super-admin/governance", icon: "🛡️" },
  ]},
  { group: "SYSTEM & SECURITY", items: [
    { label: "Open System & Security →", href: "/super-admin/system", icon: "🔐" },
  ]},
  { group: "SYSTEM & SETTINGS", items: [
    { label: "Metadata & Tags", href: "/super-admin/metadata", icon: "🏷️" },
    { label: "Platform Settings", href: "/super-admin/settings", icon: "⚙️" },
  ]},
];

const CKP_NAV = [
  { group: "CKP NAVIGATION", items: [
    { label: "CKP Overview", href: "/super-admin/ckp", icon: "📚" },
    { label: "1. Knowledge Studio", href: "/super-admin/ckp/studio", icon: "🏭" },
    { label: "2. Competency & Framework Centre", href: "/super-admin/ckp/competency", icon: "📐" },
    { label: "3. Clinical Knowledge Repository", href: "/super-admin/ckp/repository", icon: "🗄️" },
    { label: "4. Assessment & Validation Centre", href: "/super-admin/ckp/assessment", icon: "🎯" },
    { label: "5. Knowledge Publishing & Governance", href: "/super-admin/ckp/publishing", icon: "🚦" },
    { label: "6. Knowledge Intelligence", href: "/super-admin/ckp/intelligence", icon: "📡" },
  ]},
  { group: "QUICK ACCESS", items: [
    { label: "Create New CPU", href: "/super-admin/studio/cpus", icon: "➕" },
    { label: "Create Competency", href: "/super-admin/content", icon: "🎯" },
    { label: "Create Assessment", href: "/super-admin/assessment-methods", icon: "📝" },
    { label: "Create Policy", href: "/super-admin/policy-manager", icon: "📋" },
    { label: "AI Authoring Assistant", href: "/super-admin/assistant", icon: "✨" },
    { label: "Knowledge Search", href: "/super-admin/assistant", icon: "🔍" },
  ]},
];

const AI_NAV = [
  { group: "AI & INTELLIGENCE", items: [
    { label: "AI Home", href: "/super-admin/ai", icon: "🧠" },
    { label: "1. AI Operations Centre", href: "/super-admin/ai/operations", icon: "⚙️" },
    { label: "2. Clinical Intelligence", href: "/super-admin/ai/clinical", icon: "🩺" },
    { label: "3. Workforce Intelligence", href: "/super-admin/ai/workforce", icon: "👥" },
    { label: "4. Enterprise Intelligence", href: "/super-admin/ai/enterprise", icon: "🏢" },
    { label: "5. AI Studio & Automation", href: "/super-admin/ai/studio", icon: "🛠️" },
    { label: "6. Intelligence Analytics", href: "/super-admin/ai/analytics", icon: "📈" },
  ]},
  { group: "QUICK ACCESS", items: [
    { label: "AI Assistant Chat", href: "/super-admin/assistant", icon: "💬" },
    { label: "AI Gateway", href: "/super-admin/platform-ops/ai-gateway", icon: "✨" },
    { label: "Knowledge Graph", href: "/super-admin/knowledge-graph", icon: "🕸️" },
    { label: "AI Audit Logs", href: "/super-admin/audit", icon: "🗒️" },
    { label: "My Approvals", href: "/super-admin/platform-ops/approvals", icon: "✅" },
  ]},
];

const GOV_NAV = [
  { group: "GOVERNANCE & COMPLIANCE", items: [
    { label: "1. Governance Dashboard", href: "/super-admin/governance", icon: "🛡️" },
    { label: "2. Policy & Standards Center", href: "/super-admin/governance/policies", icon: "📄" },
    { label: "3. Compliance Management", href: "/super-admin/governance/compliance", icon: "✅" },
    { label: "4. Risk & Internal Controls", href: "/super-admin/governance/risk", icon: "⚠️" },
    { label: "5. Audit & Assurance", href: "/super-admin/governance/audit", icon: "📋" },
    { label: "6. Regulatory & Accreditation", href: "/super-admin/governance/accreditation", icon: "🏛️" },
  ]},
  { group: "QUICK ACCESS", items: [
    { label: "Committees", href: "/super-admin/governance/committees", icon: "⚖️" },
    { label: "Approvals", href: "/super-admin/platform-ops/approvals", icon: "🔀" },
    { label: "Workflows", href: "/super-admin/workflows", icon: "⚡" },
    { label: "Report Templates", href: "/super-admin/reports", icon: "📈" },
    { label: "Audit Log", href: "/super-admin/audit", icon: "🗒️" },
  ]},
];

const SYS_NAV = [
  { group: "SYSTEM & SECURITY PLATFORM", items: [
    { label: "1. System Health Dashboard", href: "/super-admin/system", icon: "💚" },
    { label: "2. Identity & Access Management", href: "/super-admin/system/identity", icon: "👤" },
    { label: "3. Security Operations Center", href: "/super-admin/system/security", icon: "🛡️" },
    { label: "4. Infrastructure & Services", href: "/super-admin/system/infrastructure", icon: "🖥️" },
    { label: "5. Data Protection & Recovery", href: "/super-admin/system/data", icon: "💾" },
    { label: "6. Security Intelligence & Audit", href: "/super-admin/audit", icon: "🔍" },
  ]},
  { group: "QUICK ACCESS", items: [
    { label: "Users", href: "/super-admin/users", icon: "👥" },
    { label: "Monitoring", href: "/super-admin/platform-ops/monitoring", icon: "📡" },
    { label: "Control Plane", href: "/super-admin/platform-ops/control-plane", icon: "🧭" },
    { label: "Audit Log", href: "/super-admin/audit", icon: "🗒️" },
    { label: "Platform Settings", href: "/super-admin/settings", icon: "⚙️" },
  ]},
];

const OVERVIEW_HREFS = new Set(["/super-admin", "/super-admin/ckp", "/super-admin/ai", "/super-admin/governance", "/super-admin/system"]);

export default function WorkspaceSidebar({ profileName, roles, activeRole, workspaces }: { profileName: string | null; roles: AppRole[]; activeRole: AppRole; workspaces: any[] }) {
  const pathname = usePathname();
  const inCkp = pathname.startsWith("/super-admin/ckp");
  const inAi = pathname === "/super-admin/ai" || pathname.startsWith("/super-admin/ai/");
  const inGov = pathname === "/super-admin/governance" || pathname.startsWith("/super-admin/governance/");
  const inSys = pathname === "/super-admin/system" || pathname.startsWith("/super-admin/system/");
  const inWorkspace = inCkp || inAi || inGov || inSys;
  const nav = inCkp ? CKP_NAV : inAi ? AI_NAV : inGov ? GOV_NAV : inSys ? SYS_NAV : GENERAL_NAV;
  const home = inCkp ? "/super-admin/ckp" : inAi ? "/super-admin/ai" : inGov ? "/super-admin/governance" : inSys ? "/super-admin/system" : "/super-admin";
  const subtitle = inCkp ? "Clinical Knowledge Platform" : inAi ? "AI & Intelligence" : inGov ? "Governance & Compliance" : inSys ? "System & Security" : "Mission Control";

  return (
    <>
      <Link href={home} className="flex items-center gap-2 mb-6 px-2" data-sb-item>
        <div className="w-7 h-7 rounded bg-rose-500 flex items-center justify-center text-white font-bold text-sm">C</div>
        <div className="flex flex-col leading-none" data-sb-label>
          <span className="text-white font-semibold text-sm">Competen</span>
          <span className="text-rose-300/70 text-[10px] font-medium">{subtitle}</span>
        </div>
      </Link>

      {inWorkspace ? (
        <Link href="/super-admin" className="flex items-center gap-2 px-3 mb-3 text-[10px] font-semibold text-slate-500 hover:text-white transition-colors" data-sb-label>
          ← Super Admin
        </Link>
      ) : (
        <div className="px-3 mb-4" data-sb-label>
          <span className="text-[10px] font-bold text-rose-400/70 uppercase tracking-widest">Super Admin Workspace</span>
        </div>
      )}

      <nav className="flex flex-col gap-0.5 flex-1 overflow-y-auto">
        {nav.map(({ group, items }) => (
          <NavGroup key={group} title={group} hrefs={items.map(i => i.href)} headerClass="text-[9px] font-bold text-slate-600 uppercase tracking-widest">
            {items.map(({ label, href, icon }) => (
              <NavLink key={label} href={href} icon={icon} label={label} exact={OVERVIEW_HREFS.has(href)}
                className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:bg-rose-900/30 hover:text-white transition-colors"
                activeClassName="flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-xs bg-rose-900/50 text-white font-medium" />
            ))}
          </NavGroup>
        ))}
      </nav>

      <div className="pt-4 border-t border-slate-800/60">
        <div className="flex items-center gap-2 px-3 py-2">
          <div className="w-7 h-7 rounded-full bg-rose-500 flex items-center justify-center text-white text-xs font-bold">{profileName?.[0] ?? "S"}</div>
          <div className="flex-1 min-w-0" data-sb-label>
            <p className="text-white text-xs font-medium truncate">{profileName}</p>
            <p className="text-rose-300/60 text-[10px]">{inWorkspace ? "Platform Owner" : "Super Admin"}</p>
          </div>
        </div>
        {(roles.length > 1 || workspaces.length > 0) && (
          <div className="mb-2" data-sb-label><RoleSwitcher roles={roles} activeRole={activeRole} workspaces={workspaces} /></div>
        )}
        <form action="/api/auth/logout" method="POST">
          <button type="submit" data-sb-item className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-slate-500 hover:bg-slate-800/30 hover:text-white transition-colors">
            <span className="w-5 text-center">↩</span>
            <span data-sb-label>Sign out</span>
          </button>
        </form>
      </div>
    </>
  );
}
