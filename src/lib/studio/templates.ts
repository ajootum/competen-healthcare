/* eslint-disable @typescript-eslint/no-explicit-any */
// CST-102 — Competency Template Library. A governed catalogue of the reusable assets that already exist
// and can be cloned as starting points: framework templates (core/specialty/role libraries), reusable
// skill objects (skill_library), question banks, checklists and clonable CPUs. Read on demand from the
// real stores — nothing fabricated. A dedicated curated starter-template store (beyond cloning existing
// assets) is the next-phase authoring layer, flagged honestly on the surface.

const NONE = "00000000-0000-0000-0000-000000000000";

export type TemplateCategory = { key: string; label: string; icon: string; n: number; href: string; desc: string; samples: string[]; breakdown?: { label: string; n: number }[] };

export async function loadTemplateLibrary(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.or(`hospital_id.eq.${hid ?? NONE},hospital_id.is.null`));
  const rows = (q: any) => Promise.resolve(q).then((r: any) => ((r?.data ?? []) as any[]));
  const cnt = (q: any) => Promise.resolve(q).then((r: any) => (r?.count ?? 0));

  const [fwRows, skillRows, bankRows, checklistN, cpuN] = await Promise.all([
    rows(scope(admin.from("frameworks").select("id, name, library").eq("is_active", true).limit(3000))),
    rows(admin.from("skill_library").select("id, name").eq("is_active", true).order("name").limit(2000)),
    rows(admin.from("question_banks").select("id, name").eq("is_active", true).order("name").limit(2000)),
    cnt(admin.from("skill_checklists").select("id", { count: "exact", head: true }).eq("is_active", true)),
    cnt(admin.from("clinical_practice_units").select("id", { count: "exact", head: true })),
  ]);

  const byLib = (lib: string) => fwRows.filter(f => f.library === lib).length;
  const coreFw = fwRows.filter(f => f.library === "core");
  const frameworksTotal = fwRows.length;

  const categories: TemplateCategory[] = [
    {
      key: "frameworks", label: "Framework Templates", icon: "🧬", n: frameworksTotal, href: "/super-admin/content",
      desc: "Core, specialty and role frameworks — clone as a ready-made competency structure.",
      breakdown: [{ label: "Core", n: byLib("core") }, { label: "Specialty", n: byLib("specialty") }, { label: "Role", n: byLib("role") }],
      samples: (coreFw.length ? coreFw : fwRows).slice(0, 5).map(f => f.name),
    },
    {
      key: "skills", label: "Skill Templates", icon: "✋", n: skillRows.length, href: "/super-admin/studio/skills",
      desc: "Reusable skill objects — write once, attach to many competencies.",
      samples: skillRows.slice(0, 5).map(s => s.name),
    },
    {
      key: "assessments", label: "Assessment & Question Templates", icon: "❓", n: bankRows.length, href: "/super-admin/studio/questions",
      desc: "Governed question banks reusable across competencies and CPUs.",
      samples: bankRows.slice(0, 5).map(b => b.name),
    },
    {
      key: "checklists", label: "Checklist Templates", icon: "☑️", n: checklistN, href: "/super-admin/studio/checklists",
      desc: "Structured checklists — sections, scoring and critical-fail items — reusable across skills.",
      samples: [],
    },
    {
      key: "cpus", label: "CPU Templates", icon: "🏥", n: cpuN, href: "/super-admin/studio/cpus",
      desc: "Clinical Practice Units — clone with their assessment blueprint and evidence matrix intact.",
      samples: [],
    },
  ];

  const total = frameworksTotal + skillRows.length + bankRows.length + checklistN + cpuN;
  const featured = coreFw.slice(0, 8).map(f => ({ id: f.id, name: f.name, kind: "Framework · Core library" }));

  return { total, categories, featured, libraryBreakdown: [{ label: "Core", n: byLib("core") }, { label: "Specialty", n: byLib("specialty") }, { label: "Role", n: byLib("role") }] };
}
