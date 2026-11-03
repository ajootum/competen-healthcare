// Assessor workspace: the names around an assessment (checklist, person, assessor, method labels, authority). Display only.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { type Admin, humanize } from "./common";
import type { LoadedInstance } from "./instances";

export interface RunnerHeader {
  title: string;
  subtitle: string;
  subjectName: string | null;
  assessorName: string | null;
  authority: string | null;
  methodLabels: Record<string, string>;
}

export async function loadHeader(admin: Admin, loaded: LoadedInstance): Promise<RunnerHeader> {
  const { version } = loaded.definition;
  const ids = [loaded.instance.subject_user_id, loaded.instance.respondent_id].filter(Boolean) as string[];
  const [ins, prof, meth] = await Promise.all([
    admin.from("asmt_instrument").select("code, name").eq("id", version.instrument_id).maybeSingle(),
    ids.length ? admin.from("profiles").select("id, full_name").in("id", ids) : Promise.resolve({ data: [] as any[] }),
    version.method_codes.length ? admin.from("asmt_method").select("code, label").in("code", version.method_codes) : Promise.resolve({ data: [] as any[] }),
  ]);
  const nm = new Map<string, string | null>((prof.data ?? []).map((p: any) => [p.id as string, p.full_name ?? null]));
  const snap = loaded.instance.respondent_snapshot as any;
  return {
    title: (version.title ?? ins.data?.name ?? "Checklist") as string,
    subtitle: `${ins.data?.code ?? ""} version ${version.version_no}`.trim(),
    subjectName: loaded.instance.subject_user_id ? nm.get(loaded.instance.subject_user_id) ?? null : null,
    assessorName: loaded.instance.respondent_id ? nm.get(loaded.instance.respondent_id) ?? null : null,
    authority: snap?.positionCode ? humanize(String(snap.positionCode)) : null,
    methodLabels: Object.fromEntries((meth.data ?? []).map((m: any) => [m.code as string, m.label as string])),
  };
}
