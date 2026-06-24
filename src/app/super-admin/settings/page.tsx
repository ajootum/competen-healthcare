export default function PlatformSettingsPage() {
  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Platform Settings</h1>
        <p className="text-gray-400 text-sm mt-0.5">Global configuration for Competen Healthcare.</p>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-4">
        <h2 className="font-semibold text-gray-900 mb-4">Platform Info</h2>
        <div className="flex flex-col gap-3 text-sm">
          {[
            { label: "Platform Name",    value: "Competen Healthcare" },
            { label: "Target Region",    value: "East Africa" },
            { label: "Framework",        value: "Next.js 16 + Supabase" },
            { label: "Competency Scale", value: "0–6 (Novice → Expert)" },
            { label: "CPD Annual Target",value: "30 hours" },
          ].map(r => (
            <div key={r.label} className="flex justify-between items-center py-2 border-b border-gray-50 last:border-0">
              <span className="text-gray-500">{r.label}</span>
              <span className="font-medium text-gray-900">{r.value}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-4">
        <h2 className="font-semibold text-gray-900 mb-4">Feature Flags</h2>
        <div className="flex flex-col gap-3">
          {[
            { label: "Competency Passport",   status: true,  note: "Live"         },
            { label: "Audit Tools (3 types)", status: true,  note: "Live"         },
            { label: "CPD Log",               status: true,  note: "Live"         },
            { label: "Course LMS",            status: true,  note: "Live"         },
            { label: "AI Copilot",            status: true,  note: "Live"         },
            { label: "OSCE Builder",          status: false, note: "In progress"  },
            { label: "Simulation Engine",     status: false, note: "Planned"      },
            { label: "AI Tutor",              status: false, note: "Planned"      },
            { label: "M-Pesa Billing",        status: false, note: "Planned"      },
          ].map(f => (
            <div key={f.label} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
              <span className="text-sm text-gray-700">{f.label}</span>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${f.status ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                {f.note}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-rose-50 border border-rose-100 rounded-xl p-4 text-sm text-rose-800">
        Full platform configuration (feature toggles, tier limits, CPD targets) is managed via environment variables and the Supabase dashboard. Contact the platform team for changes.
      </div>
    </div>
  );
}
