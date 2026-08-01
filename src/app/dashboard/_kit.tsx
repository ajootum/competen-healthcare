// Shared presentation kit — extracted, not redesigned.
 

// Lifted verbatim from src/app/dashboard/activity/page.tsx — written out identically in several
// pages, so this is one implementation replacing N copies, not a redesign.
export function KpiTile({ icon, label, value, sub, tint }: { icon: string; label: string; value: string | number; sub: string; tint: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3.5">
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${tint}`}>{icon}</div>
      <p className="text-2xl font-bold text-gray-900 mt-2">{value}</p>
      <p className="text-[11px] font-medium text-gray-700 leading-tight">{label}</p>
      <p className="text-[10px] text-gray-400">{sub}</p>
    </div>
  );
}
