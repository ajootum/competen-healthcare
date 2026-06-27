"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

const ORG_TYPES = ["government","private","ngo","faith_based","academic"] as const;

const COUNTRIES = [
  "Algeria","Angola","Botswana","Burundi","Cameroon","Chad","Côte d'Ivoire",
  "DR Congo","Egypt","Ethiopia","Ghana","Guinea","Kenya","Lesotho","Libya",
  "Madagascar","Malawi","Mali","Morocco","Mozambique","Namibia","Niger",
  "Nigeria","Rwanda","Senegal","Sierra Leone","Somalia","South Africa",
  "South Sudan","Sudan","Tanzania","Togo","Tunisia","Uganda","Zambia","Zimbabwe",
  // Non-African
  "India","United Kingdom","United States","Canada","Australia","UAE","Saudi Arabia",
];

export default function OrgManager() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"org"|"facility">("org");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [orgForm, setOrgForm] = useState({
    name: "", group_name: "", type: "private",
    hq_country: "Kenya", region: "", description: "", website: "", email: "", phone: "",
  });

  const [facForm, setFacForm] = useState({
    name: "", type: "hospital", country: "Kenya", city: "", tier: "free", organisation_name: "",
  });

  async function saveOrg() {
    if (!orgForm.name) { setError("Organisation name is required"); return; }
    setSaving(true); setError("");
    const res = await fetch("/api/super-admin/organisations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...orgForm, country: orgForm.hq_country }),
    });
    if (!res.ok) { setError((await res.json()).error ?? "Failed to create"); setSaving(false); return; }
    setOpen(false);
    setOrgForm({ name: "", group_name: "", type: "private", hq_country: "Kenya", region: "", description: "", website: "", email: "", phone: "" });
    router.refresh();
    setSaving(false);
  }

  async function saveFacility() {
    if (!facForm.name) { setError("Facility name is required"); return; }
    setSaving(true); setError("");
    const res = await fetch("/api/super-admin/facilities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(facForm),
    });
    if (!res.ok) { setError((await res.json()).error ?? "Failed to create"); setSaving(false); return; }
    setOpen(false);
    setFacForm({ name: "", type: "hospital", country: "Kenya", city: "", tier: "free", organisation_name: "" });
    router.refresh();
    setSaving(false);
  }

  return (
    <>
      <button onClick={() => setOpen(true)}
        className="px-4 py-2 bg-rose-600 text-white text-sm font-semibold rounded-lg hover:bg-rose-700">
        + Add
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100 sticky top-0 bg-white">
              <h2 className="font-bold text-gray-900">Add New</h2>
              <button onClick={() => { setOpen(false); setError(""); }} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>

            <div className="flex gap-1 px-6 pt-4">
              {(["org","facility"] as const).map(t => (
                <button key={t} onClick={() => { setTab(t); setError(""); }}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    tab === t ? "bg-rose-100 text-rose-700" : "text-gray-500 hover:bg-gray-100"
                  }`}>
                  {t === "org" ? "🏛️ Organisation Group" : "🏥 Facility"}
                </button>
              ))}
            </div>

            <div className="p-6 flex flex-col gap-3">
              {tab === "org" ? (
                <>
                  <div>
                    <label className="text-xs font-semibold text-gray-600 mb-1 block">Organisation / Group Name *</label>
                    <input value={orgForm.name} onChange={e => setOrgForm(p => ({...p, name: e.target.value}))}
                      placeholder="e.g. Aga Khan Health Services"
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-400" />
                    <p className="text-[10px] text-gray-400 mt-1">This is the top-level multinational group — it can have facilities in multiple countries</p>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-600 mb-1 block">Abbreviation / Short Name</label>
                    <input value={orgForm.group_name} onChange={e => setOrgForm(p => ({...p, group_name: e.target.value}))}
                      placeholder="e.g. AKHS"
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-400" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-600 mb-1 block">Description</label>
                    <textarea value={orgForm.description} onChange={e => setOrgForm(p => ({...p, description: e.target.value}))}
                      rows={2} placeholder="Brief description of the organisation…"
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-400 resize-none" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-semibold text-gray-600 mb-1 block">Type *</label>
                      <select value={orgForm.type} onChange={e => setOrgForm(p => ({...p, type: e.target.value}))}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none">
                        {ORG_TYPES.map(t => <option key={t} value={t}>{t.replace("_"," ")}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-gray-600 mb-1 block">HQ Country *</label>
                      <select value={orgForm.hq_country} onChange={e => setOrgForm(p => ({...p, hq_country: e.target.value}))}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none">
                        {COUNTRIES.map(c => <option key={c}>{c}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-semibold text-gray-600 mb-1 block">Email</label>
                      <input type="email" value={orgForm.email} onChange={e => setOrgForm(p => ({...p, email: e.target.value}))}
                        placeholder="admin@org.com"
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-400" />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-gray-600 mb-1 block">Phone</label>
                      <input value={orgForm.phone} onChange={e => setOrgForm(p => ({...p, phone: e.target.value}))}
                        placeholder="+254..."
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-400" />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-600 mb-1 block">Website</label>
                    <input value={orgForm.website} onChange={e => setOrgForm(p => ({...p, website: e.target.value}))}
                      placeholder="https://..."
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-400" />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="text-xs font-semibold text-gray-600 mb-1 block">Facility Name *</label>
                    <input value={facForm.name} onChange={e => setFacForm(p => ({...p, name: e.target.value}))}
                      placeholder="e.g. Aga Khan Hospital Nairobi"
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-400" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-semibold text-gray-600 mb-1 block">Country *</label>
                      <select value={facForm.country} onChange={e => setFacForm(p => ({...p, country: e.target.value}))}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none">
                        {COUNTRIES.map(c => <option key={c}>{c}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-gray-600 mb-1 block">City</label>
                      <input value={facForm.city} onChange={e => setFacForm(p => ({...p, city: e.target.value}))}
                        placeholder="e.g. Nairobi"
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-400" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-semibold text-gray-600 mb-1 block">Facility Type *</label>
                      <select value={facForm.type} onChange={e => setFacForm(p => ({...p, type: e.target.value}))}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none">
                        <option value="hospital">Hospital</option>
                        <option value="clinic">Clinic</option>
                        <option value="health_center">Health Center</option>
                        <option value="nursing_home">Nursing Home</option>
                        <option value="diagnostic_center">Diagnostic Center</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-gray-600 mb-1 block">Plan Tier</label>
                      <select value={facForm.tier} onChange={e => setFacForm(p => ({...p, tier: e.target.value}))}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none">
                        <option value="free">Free</option>
                        <option value="professional">Professional</option>
                        <option value="enterprise">Enterprise</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-600 mb-1 block">Parent Organisation (optional)</label>
                    <input value={facForm.organisation_name} onChange={e => setFacForm(p => ({...p, organisation_name: e.target.value}))}
                      placeholder="Type organisation name to link…"
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-400" />
                    <p className="text-[10px] text-gray-400 mt-1">After creating, link this facility to a group from the Organisations page</p>
                  </div>
                </>
              )}

              {error && <p className="text-red-500 text-xs bg-red-50 rounded-lg px-3 py-2">{error}</p>}

              <div className="flex gap-3 pt-1">
                <button onClick={() => { setOpen(false); setError(""); }}
                  className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
                  Cancel
                </button>
                <button onClick={tab === "org" ? saveOrg : saveFacility} disabled={saving}
                  className="flex-1 py-2 bg-rose-600 text-white rounded-lg text-sm font-semibold hover:bg-rose-700 disabled:opacity-60">
                  {saving ? "Saving…" : tab === "org" ? "Create Group" : "Add Facility"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
