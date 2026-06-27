"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

const ORG_TYPES = ["government","private","ngo","faith_based","academic"] as const;

const AFRICAN_COUNTRIES = [
  "Kenya","Uganda","Tanzania","Rwanda","Zambia","Zimbabwe","Ghana","Nigeria",
  "Ethiopia","South Africa","Mozambique","Malawi","Botswana","Namibia","Senegal",
  "Côte d'Ivoire","Cameroon","DR Congo","Angola","Sudan",
];

export default function OrgManager() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"org"|"facility">("org");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [orgForm, setOrgForm] = useState({
    name: "", group_name: "", type: "private", country: "Kenya", region: "",
  });

  const [facForm, setFacForm] = useState({
    name: "", type: "hospital", country: "Kenya", city: "", tier: "free",
  });

  async function saveOrg() {
    setSaving(true); setError("");
    const res = await fetch("/api/super-admin/organisations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(orgForm),
    });
    if (!res.ok) { setError((await res.json()).error ?? "Failed"); setSaving(false); return; }
    setOpen(false);
    setOrgForm({ name: "", group_name: "", type: "private", country: "Kenya", region: "" });
    router.refresh();
    setSaving(false);
  }

  async function saveFacility() {
    setSaving(true); setError("");
    const res = await fetch("/api/super-admin/facilities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(facForm),
    });
    if (!res.ok) { setError((await res.json()).error ?? "Failed"); setSaving(false); return; }
    setOpen(false);
    setFacForm({ name: "", type: "hospital", country: "Kenya", city: "", tier: "free" });
    router.refresh();
    setSaving(false);
  }

  return (
    <>
      <button onClick={() => setOpen(true)}
        className="px-4 py-2 bg-rose-600 text-white text-sm font-semibold rounded-lg hover:bg-rose-700 transition-colors">
        + Add
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100">
              <h2 className="font-bold text-gray-900">Add New</h2>
              <button onClick={() => { setOpen(false); setError(""); }} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>

            {/* Tab */}
            <div className="flex gap-1 px-6 pt-4">
              {(["org","facility"] as const).map(t => (
                <button key={t} onClick={() => setTab(t)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    tab === t ? "bg-rose-100 text-rose-700" : "text-gray-500 hover:bg-gray-100"
                  }`}>
                  {t === "org" ? "🏛️ Organisation" : "🏥 Facility"}
                </button>
              ))}
            </div>

            <div className="p-6 flex flex-col gap-4">
              {tab === "org" ? (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Organisation Name *</label>
                    <input value={orgForm.name} onChange={e => setOrgForm({...orgForm, name: e.target.value})}
                      placeholder="e.g. Aga Khan Foundation Kenya"
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-100" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Group / Parent Name</label>
                    <input value={orgForm.group_name} onChange={e => setOrgForm({...orgForm, group_name: e.target.value})}
                      placeholder="e.g. Aga Khan Group"
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-100" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">Type *</label>
                      <select value={orgForm.type} onChange={e => setOrgForm({...orgForm, type: e.target.value})}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-rose-400">
                        {ORG_TYPES.map(t => <option key={t} value={t}>{t.replace("_"," ")}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">Country *</label>
                      <select value={orgForm.country} onChange={e => setOrgForm({...orgForm, country: e.target.value})}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-rose-400">
                        {AFRICAN_COUNTRIES.map(c => <option key={c}>{c}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Region / Province</label>
                    <input value={orgForm.region} onChange={e => setOrgForm({...orgForm, region: e.target.value})}
                      placeholder="e.g. Nairobi County"
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-100" />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Facility Name *</label>
                    <input value={facForm.name} onChange={e => setFacForm({...facForm, name: e.target.value})}
                      placeholder="e.g. Kenyatta National Hospital"
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-100" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">Facility Type *</label>
                      <select value={facForm.type} onChange={e => setFacForm({...facForm, type: e.target.value})}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-rose-400">
                        <option value="hospital">Hospital</option>
                        <option value="clinic">Clinic</option>
                        <option value="health_center">Health Center</option>
                        <option value="nursing_home">Nursing Home</option>
                        <option value="diagnostic_center">Diagnostic Center</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">Plan Tier</label>
                      <select value={facForm.tier} onChange={e => setFacForm({...facForm, tier: e.target.value})}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-rose-400">
                        <option value="free">Free</option>
                        <option value="professional">Professional</option>
                        <option value="enterprise">Enterprise</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">Country *</label>
                      <select value={facForm.country} onChange={e => setFacForm({...facForm, country: e.target.value})}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-rose-400">
                        {AFRICAN_COUNTRIES.map(c => <option key={c}>{c}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">City</label>
                      <input value={facForm.city} onChange={e => setFacForm({...facForm, city: e.target.value})}
                        placeholder="e.g. Nairobi"
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-100" />
                    </div>
                  </div>
                </>
              )}

              {error && <p className="text-red-500 text-xs bg-red-50 rounded-lg px-3 py-2">{error}</p>}

              <div className="flex gap-3 pt-1">
                <button onClick={() => { setOpen(false); setError(""); }}
                  className="flex-1 px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition-colors">
                  Cancel
                </button>
                <button onClick={tab === "org" ? saveOrg : saveFacility} disabled={saving}
                  className="flex-1 px-4 py-2 bg-rose-600 text-white rounded-lg text-sm font-semibold hover:bg-rose-700 transition-colors disabled:opacity-60">
                  {saving ? "Saving..." : tab === "org" ? "Create Organisation" : "Add Facility"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
