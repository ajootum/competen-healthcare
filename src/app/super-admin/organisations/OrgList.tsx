"use client";
import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { COUNTRIES } from "@/lib/countries";

type Org = { id: string; name: string; group_name: string | null; type: string; hq_country: string; region: string | null; description: string | null; website: string | null; email: string | null; phone: string | null; is_active: boolean };
type Facility = { id: string; name: string; type: string; country: string; city: string | null; tier: string; organisation_id: string | null };

const ORG_TYPES = ["government","private","ngo","faith_based","academic"] as const;

const TYPE_COLORS: Record<string, string> = {
  government:  "bg-blue-100 text-blue-700",
  private:     "bg-green-100 text-green-700",
  ngo:         "bg-purple-100 text-purple-700",
  faith_based: "bg-amber-100 text-amber-700",
  academic:    "bg-rose-100 text-rose-700",
};

const FACILITY_ICON: Record<string, string> = {
  hospital: "🏥", clinic: "🏪", health_center: "🏠", nursing_home: "🏡", diagnostic_center: "🔬",
};

const TIER_BADGE: Record<string, string> = {
  free: "bg-gray-100 text-gray-500", professional: "bg-blue-100 text-blue-700", enterprise: "bg-purple-100 text-purple-700",
};

type EditTarget = { kind: "org"; org: Org } | { kind: "facility"; facility: Facility };

export default function OrgList({
  orgs: initialOrgs, facilities: initialFacilities, staffByHospital, allCountries,
}: {
  orgs: Org[];
  facilities: Facility[];
  staffByHospital: Record<string, Record<string, number>>;
  allCountries: string[];
}) {
  const router = useRouter();
  const [orgs, setOrgs] = useState(initialOrgs);
  const [facilities, setFacilities] = useState(initialFacilities);
  const [editing, setEditing] = useState<EditTarget | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  // Edit forms
  const [orgForm, setOrgForm] = useState<Org | null>(null);
  const [facForm, setFacForm] = useState<Facility | null>(null);

  function openEditOrg(org: Org) {
    setOrgForm({ ...org });
    setEditing({ kind: "org", org });
    setError("");
  }

  function openEditFac(facility: Facility) {
    setFacForm({ ...facility });
    setEditing({ kind: "facility", facility });
    setError("");
  }

  async function saveOrg() {
    if (!orgForm) return;
    setSaving(true); setError("");
    const res = await fetch("/api/super-admin/organisations", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(orgForm),
    });
    setSaving(false);
    if (!res.ok) { setError((await res.json()).error ?? "Failed"); return; }
    setOrgs(prev => prev.map(o => o.id === orgForm.id ? orgForm : o));
    setEditing(null);
  }

  async function saveFacility() {
    if (!facForm) return;
    setSaving(true); setError("");
    const res = await fetch("/api/super-admin/facilities", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(facForm),
    });
    setSaving(false);
    if (!res.ok) { setError((await res.json()).error ?? "Failed"); return; }
    setFacilities(prev => prev.map(f => f.id === facForm.id ? facForm : f));
    setEditing(null);
  }

  async function deleteOrg() {
    if (!orgForm || !confirm(`Delete "${orgForm.name}"? This cannot be undone.`)) return;
    setDeleting(true);
    await fetch(`/api/super-admin/organisations?id=${orgForm.id}`, { method: "DELETE" });
    setDeleting(false);
    setOrgs(prev => prev.filter(o => o.id !== orgForm.id));
    setEditing(null);
    router.refresh();
  }

  async function deleteFacility() {
    if (!facForm || !confirm(`Delete "${facForm.name}"? This cannot be undone.`)) return;
    setDeleting(true);
    await fetch(`/api/super-admin/facilities?id=${facForm.id}`, { method: "DELETE" });
    setDeleting(false);
    setFacilities(prev => prev.filter(f => f.id !== facForm.id));
    setEditing(null);
  }

  // Group facilities by org → country
  const facilityByOrg = facilities.reduce((acc, f) => {
    const key = f.organisation_id ?? "__none__";
    if (!acc[key]) acc[key] = {};
    const cKey = f.country ?? "Unknown";
    if (!acc[key][cKey]) acc[key][cKey] = [];
    acc[key][cKey].push(f);
    return acc;
  }, {} as Record<string, Record<string, Facility[]>>);

  return (
    <>
      {/* Edit modals */}
      {editing?.kind === "org" && orgForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100 sticky top-0 bg-white">
              <h2 className="font-bold text-gray-900">Edit Organisation</h2>
              <button onClick={() => setEditing(null)} className="text-gray-400 hover:text-gray-700 text-xl">×</button>
            </div>
            <div className="p-6 flex flex-col gap-3">
              <Field label="Name *"><input value={orgForm.name} onChange={e => setOrgForm(p => p && ({...p, name: e.target.value}))} /></Field>
              <Field label="Short Name"><input value={orgForm.group_name ?? ""} onChange={e => setOrgForm(p => p && ({...p, group_name: e.target.value}))} /></Field>
              <Field label="Description">
                <textarea rows={2} value={orgForm.description ?? ""} onChange={e => setOrgForm(p => p && ({...p, description: e.target.value}))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-400 resize-none" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Type">
                  <select value={orgForm.type} onChange={e => setOrgForm(p => p && ({...p, type: e.target.value}))}>
                    {ORG_TYPES.map(t => <option key={t} value={t}>{t.replace("_"," ")}</option>)}
                  </select>
                </Field>
                <Field label="HQ Country">
                  <select value={orgForm.hq_country} onChange={e => setOrgForm(p => p && ({...p, hq_country: e.target.value}))}>
                    {COUNTRIES.map(c => <option key={c}>{c}</option>)}
                  </select>
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Email"><input type="email" value={orgForm.email ?? ""} onChange={e => setOrgForm(p => p && ({...p, email: e.target.value}))} /></Field>
                <Field label="Phone"><input value={orgForm.phone ?? ""} onChange={e => setOrgForm(p => p && ({...p, phone: e.target.value}))} /></Field>
              </div>
              <Field label="Website"><input value={orgForm.website ?? ""} onChange={e => setOrgForm(p => p && ({...p, website: e.target.value}))} placeholder="https://…" /></Field>
              {error && <p className="text-red-500 text-xs bg-red-50 rounded-lg px-3 py-2">{error}</p>}
              <div className="flex gap-2 pt-1">
                <button onClick={deleteOrg} disabled={deleting}
                  className="px-4 py-2 border border-red-200 text-red-600 rounded-lg text-sm hover:bg-red-50 disabled:opacity-50 font-medium">
                  {deleting ? "Deleting…" : "Delete"}
                </button>
                <button onClick={() => setEditing(null)} className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
                <button onClick={saveOrg} disabled={saving}
                  className="flex-1 py-2 bg-rose-600 text-white rounded-lg text-sm font-semibold hover:bg-rose-700 disabled:opacity-60">
                  {saving ? "Saving…" : "Save Changes"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {editing?.kind === "facility" && facForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100 sticky top-0 bg-white">
              <h2 className="font-bold text-gray-900">Edit Facility</h2>
              <button onClick={() => setEditing(null)} className="text-gray-400 hover:text-gray-700 text-xl">×</button>
            </div>
            <div className="p-6 flex flex-col gap-3">
              <Field label="Facility Name *"><input value={facForm.name} onChange={e => setFacForm(p => p && ({...p, name: e.target.value}))} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Country *">
                  <select value={facForm.country} onChange={e => setFacForm(p => p && ({...p, country: e.target.value}))}>
                    {COUNTRIES.map(c => <option key={c}>{c}</option>)}
                  </select>
                </Field>
                <Field label="City"><input value={facForm.city ?? ""} onChange={e => setFacForm(p => p && ({...p, city: e.target.value}))} /></Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Facility Type">
                  <select value={facForm.type} onChange={e => setFacForm(p => p && ({...p, type: e.target.value}))}>
                    <option value="hospital">Hospital</option>
                    <option value="clinic">Clinic</option>
                    <option value="health_center">Health Center</option>
                    <option value="nursing_home">Nursing Home</option>
                    <option value="diagnostic_center">Diagnostic Center</option>
                  </select>
                </Field>
                <Field label="Plan Tier">
                  <select value={facForm.tier} onChange={e => setFacForm(p => p && ({...p, tier: e.target.value}))}>
                    <option value="free">Free</option>
                    <option value="professional">Professional</option>
                    <option value="enterprise">Enterprise</option>
                  </select>
                </Field>
              </div>
              <Field label="Organisation Group">
                <select value={facForm.organisation_id ?? ""} onChange={e => setFacForm(p => p && ({...p, organisation_id: e.target.value || null}))}>
                  <option value="">— None —</option>
                  {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </Field>
              {error && <p className="text-red-500 text-xs bg-red-50 rounded-lg px-3 py-2">{error}</p>}
              <div className="flex gap-2 pt-1">
                <button onClick={deleteFacility} disabled={deleting}
                  className="px-4 py-2 border border-red-200 text-red-600 rounded-lg text-sm hover:bg-red-50 disabled:opacity-50 font-medium">
                  {deleting ? "Deleting…" : "Delete"}
                </button>
                <button onClick={() => setEditing(null)} className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
                <button onClick={saveFacility} disabled={saving}
                  className="flex-1 py-2 bg-rose-600 text-white rounded-lg text-sm font-semibold hover:bg-rose-700 disabled:opacity-60">
                  {saving ? "Saving…" : "Save Changes"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Country footprint */}
      <div className="bg-white rounded-xl border border-gray-100 p-4 mb-6">
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">Country footprint</p>
        <div className="flex flex-wrap gap-2">
          {allCountries.map(c => {
            const count = facilities.filter(f => f.country === c).length;
            return (
              <span key={c} className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 border border-gray-100 rounded-lg text-xs font-medium text-gray-700">
                <span>🌍</span><span>{c}</span><span className="text-gray-400">({count})</span>
              </span>
            );
          })}
          {!allCountries.length && <p className="text-xs text-gray-400 italic">No facilities added yet</p>}
        </div>
      </div>

      {/* Org groups */}
      <div className="flex flex-col gap-6">
        {orgs.map(org => {
          const byCountry = facilityByOrg[org.id] ?? {};
          const countries = Object.keys(byCountry).sort();
          const totalFacil = countries.reduce((s, c) => s + (byCountry[c]?.length ?? 0), 0);
          const totalNurses = countries.reduce((s, c) =>
            s + (byCountry[c] ?? []).reduce((fs, f) => fs + (staffByHospital[f.id]?.nurse ?? 0), 0), 0);

          return (
            <div key={org.id} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 bg-gradient-to-r from-gray-50 to-white border-b border-gray-100">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-rose-50 flex items-center justify-center text-xl shrink-0">🏛️</div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-bold text-gray-900">{org.name}</p>
                      {!org.is_active && <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">Inactive</span>}
                    </div>
                    {org.group_name && <p className="text-xs text-gray-400">{org.group_name}</p>}
                    {org.description && <p className="text-xs text-gray-400 mt-0.5 max-w-md">{org.description}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p className="text-xs font-semibold text-gray-700">{totalFacil} facilit{totalFacil !== 1 ? "ies" : "y"}</p>
                    <p className="text-[10px] text-gray-400">{countries.length} countr{countries.length !== 1 ? "ies" : "y"} · {totalNurses} nurses</p>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-1 rounded-lg capitalize ${TYPE_COLORS[org.type] ?? "bg-gray-100 text-gray-600"}`}>
                    {org.type.replace("_"," ")}
                  </span>
                  <button onClick={() => openEditOrg(org)}
                    className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 hover:border-gray-300 transition-colors font-medium">
                    Edit
                  </button>
                </div>
              </div>

              {countries.length > 0 ? (
                <div className="divide-y divide-gray-50">
                  {countries.map(country => {
                    const facs = byCountry[country] ?? [];
                    const cNurses = facs.reduce((s, f) => s + (staffByHospital[f.id]?.nurse ?? 0), 0);
                    const cAssessors = facs.reduce((s, f) => s + (staffByHospital[f.id]?.assessor ?? 0), 0);
                    return (
                      <div key={country}>
                        <div className="flex items-center justify-between px-5 py-2.5 pl-14 bg-gray-50/50 border-b border-gray-50">
                          <div className="flex items-center gap-2">
                            <span>🌍</span>
                            <p className="text-sm font-semibold text-gray-700">{country}</p>
                            <span className="text-[10px] text-gray-400">{facs.length} facilit{facs.length !== 1 ? "ies" : "y"}</span>
                          </div>
                          <div className="flex items-center gap-3 text-[10px] text-gray-400">
                            {cNurses > 0 && <span>{cNurses} nurses</span>}
                            {cAssessors > 0 && <span>{cAssessors} assessors</span>}
                          </div>
                        </div>
                        {facs.map(f => {
                          const fs = staffByHospital[f.id] ?? {};
                          return (
                            <div key={f.id} className="flex items-center gap-3 px-5 py-3 pl-20 hover:bg-gray-50/30 transition-colors">
                              <span className="text-base">{FACILITY_ICON[f.type] ?? "🏥"}</span>
                              <div className="flex-1">
                                <p className="text-sm text-gray-800 font-medium">{f.name}</p>
                                <p className="text-[10px] text-gray-400">{f.city ? `${f.city} · ` : ""}{f.type?.replace("_"," ")}</p>
                              </div>
                              <div className="flex items-center gap-3 text-[10px] text-gray-400">
                                {(fs.nurse ?? 0) > 0 && <span>{fs.nurse} nurses</span>}
                                {(fs.assessor ?? 0) > 0 && <span>{fs.assessor} assessors</span>}
                              </div>
                              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded capitalize ${TIER_BADGE[f.tier] ?? "bg-gray-100 text-gray-500"}`}>
                                {f.tier}
                              </span>
                              <button onClick={() => openEditFac(f)}
                                className="text-xs px-2.5 py-1 rounded-lg border border-gray-200 text-gray-400 hover:bg-gray-50 hover:border-gray-300 transition-colors">
                                Edit
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="px-5 py-4 pl-14 text-xs text-gray-400 italic">
                  No facilities linked yet — use &quot;+ Add&quot; → Facility to add one
                </div>
              )}
            </div>
          );
        })}

        {/* Unlinked facilities */}
        {facilityByOrg["__none__"] && Object.keys(facilityByOrg["__none__"]).length > 0 && (
          <div className="bg-white rounded-xl border border-dashed border-gray-200 overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 bg-amber-50/30">
              <p className="text-xs font-semibold text-amber-700">⚠ Unlinked Facilities</p>
              <p className="text-[10px] text-gray-400 mt-0.5">These facilities are not linked to any organisation group</p>
            </div>
            {Object.entries(facilityByOrg["__none__"]).map(([country, facs]) => (
              <div key={country}>
                <div className="px-5 py-2 bg-gray-50/50 border-b border-gray-50">
                  <p className="text-xs font-semibold text-gray-500">🌍 {country}</p>
                </div>
                {facs.map(f => (
                  <div key={f.id} className="flex items-center gap-3 px-5 py-3 pl-10">
                    <span>{FACILITY_ICON[f.type] ?? "🏥"}</span>
                    <div className="flex-1">
                      <p className="text-sm text-gray-700">{f.name}</p>
                      <p className="text-[10px] text-gray-400">{f.city}</p>
                    </div>
                    <span className="text-[10px] text-amber-600 bg-amber-50 px-2 py-0.5 rounded">No org linked</span>
                    <button onClick={() => openEditFac(f)}
                      className="text-xs px-2.5 py-1 rounded-lg border border-gray-200 text-gray-400 hover:bg-gray-50 hover:border-gray-300 transition-colors">
                      Edit
                    </button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {!orgs.length && (
          <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
            <p className="text-3xl mb-3">🏛️</p>
            <p className="text-gray-500 text-sm font-medium">No organisations yet</p>
            <p className="text-gray-400 text-xs mt-1">Click &quot;+ Add&quot; to create your first organisation group.</p>
          </div>
        )}
      </div>
    </>
  );
}

const INPUT_CLS = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-400";

function Field({ label, children }: { label: string; children: React.ReactElement }) {
  const child = children as React.ReactElement<React.HTMLAttributes<HTMLElement>>;
  return (
    <div>
      <label className="text-xs font-semibold text-gray-600 mb-1 block">{label}</label>
      {React.cloneElement(child, { className: INPUT_CLS + (child.props.className ? ` ${child.props.className}` : "") })}
    </div>
  );
}
