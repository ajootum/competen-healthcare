const resources = [
  {
    category: "Clinical Guidelines",
    items: [
      { title: "Kenya Essential Medicines List (KEML) 2023", type: "PDF", source: "Ministry of Health Kenya", tag: "Pharmacology" },
      { title: "WHO Infection Prevention and Control Guidelines", type: "PDF", source: "World Health Organization", tag: "Safety" },
      { title: "East African Community Nursing Standards", type: "Doc", source: "EAC Health Secretariat", tag: "Standards" },
      { title: "Pediatric Emergency Triage (ETAT+) Protocol", type: "PDF", source: "WHO AFRO", tag: "Pediatrics" },
    ],
  },
  {
    category: "Clinical Skills Videos",
    items: [
      { title: "IV Cannulation Technique — Step by Step", type: "Video", source: "Competen Academy", tag: "Clinical" },
      { title: "BLS & CPR for Adults — 2020 Guidelines", type: "Video", source: "Competen Academy", tag: "Emergency" },
      { title: "Aseptic Non-Touch Technique (ANTT)", type: "Video", source: "Competen Academy", tag: "Safety" },
      { title: "Neonatal Resuscitation Protocol", type: "Video", source: "Competen Academy", tag: "Pediatrics" },
    ],
  },
  {
    category: "Policy & Compliance",
    items: [
      { title: "Nursing Council of Kenya — Licensure Requirements", type: "Link", source: "NCK", tag: "Compliance" },
      { title: "Uganda Nurses & Midwives Council CPD Framework", type: "PDF", source: "UNMCA", tag: "Compliance" },
      { title: "Tanzania Nursing & Midwifery Council Standards", type: "PDF", source: "TNMC", tag: "Compliance" },
      { title: "Patient Rights Charter — East Africa", type: "Doc", source: "EAC", tag: "Policy" },
    ],
  },
  {
    category: "Research & Evidence",
    items: [
      { title: "Lancet: Nursing workforce in Sub-Saharan Africa", type: "Article", source: "The Lancet", tag: "Research" },
      { title: "BMJ: Clinical competency assessment models", type: "Article", source: "BMJ", tag: "Research" },
      { title: "African Journal of Nursing & Midwifery", type: "Journal", source: "AJNM", tag: "Research" },
      { title: "WHO AFRO Nursing Strategic Plan 2020–2030", type: "PDF", source: "WHO AFRO", tag: "Policy" },
    ],
  },
];

const typeStyles: Record<string, string> = {
  PDF:     "bg-red-50 text-red-600",
  Video:   "bg-purple-50 text-purple-600",
  Doc:     "bg-blue-50 text-blue-600",
  Link:    "bg-teal-50 text-teal-600",
  Article: "bg-amber-50 text-amber-600",
  Journal: "bg-green-50 text-green-600",
};

export default function KnowledgePage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Knowledge Hub</h1>
        <p className="text-gray-400 text-sm mt-0.5">Clinical guidelines, policies, and evidence-based resources for East African nurses.</p>
      </div>

      {/* Search bar (static UI) */}
      <div className="relative mb-6">
        <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-300">🔍</span>
        <input type="text" placeholder="Search guidelines, protocols, videos…"
          className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100 bg-white" />
      </div>

      {/* Resource sections */}
      <div className="flex flex-col gap-6">
        {resources.map(section => (
          <div key={section.category} className="bg-white rounded-xl border border-gray-100 p-5">
            <h2 className="font-semibold text-gray-900 text-sm mb-4">{section.category}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {section.items.map(item => (
                <div key={item.title}
                  className="flex items-start gap-3 p-3 rounded-lg border border-gray-50 hover:border-teal-100 hover:bg-teal-50/20 transition-colors cursor-pointer group">
                  <div className="w-8 h-8 rounded bg-gray-50 flex items-center justify-center shrink-0 text-sm">
                    {item.type === "Video" ? "▶" : item.type === "Article" || item.type === "Journal" ? "📄" : "📎"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-800 font-medium group-hover:text-teal-700 transition-colors leading-tight">{item.title}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{item.source}</p>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${typeStyles[item.type] ?? "bg-gray-100 text-gray-500"}`}>{item.type}</span>
                      <span className="text-[10px] text-gray-300">{item.tag}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 bg-[#0a2e38] rounded-xl p-5 text-white text-sm flex items-center justify-between">
        <div>
          <p className="font-semibold">Submit a Resource</p>
          <p className="text-teal-300/70 text-xs mt-0.5">Know a useful guideline or article? Share it with the community.</p>
        </div>
        <button className="bg-teal-500 text-white px-4 py-2 rounded-lg text-xs font-medium hover:bg-teal-400 transition-colors shrink-0">
          Submit →
        </button>
      </div>
    </div>
  );
}
