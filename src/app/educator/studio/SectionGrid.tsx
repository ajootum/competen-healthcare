import Link from "next/link";
import type { StudioModule } from "./sections";

// Shared module grid for the Education Studio section pages.
export default function SectionGrid({ modules }: { modules: StudioModule[] }) {
  return (
    <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-2">
      {modules.map(m => m.soon ? (
        <div key={m.name} className="border border-gray-100 rounded-lg px-3 py-2.5 opacity-60 select-none">
          <p className="text-xs font-semibold text-gray-500">
            <span className="text-gray-400 mr-1">{m.n}.</span>{m.icon} {m.name}
            <span className="text-[8px] font-bold uppercase bg-gray-100 text-gray-400 rounded px-1 py-0.5 ml-1">soon</span>
          </p>
          <p className="text-[10px] text-gray-400 mt-0.5 leading-snug">{m.desc}</p>
        </div>
      ) : (
        <Link key={m.name} href={m.href!} className="border border-gray-100 rounded-lg px-3 py-2.5 hover:border-purple-300 transition-colors">
          <p className="text-xs font-semibold text-gray-800"><span className="text-gray-300 mr-1">{m.n}.</span>{m.icon} {m.name}</p>
          <p className="text-[10px] text-gray-400 mt-0.5 leading-snug">{m.desc}</p>
        </Link>
      ))}
    </div>
  );
}
