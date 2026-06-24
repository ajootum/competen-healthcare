export default function ContentLibraryPage() {
  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Content Library</h1>
        <p className="text-gray-400 text-sm mt-0.5">Manage learning materials, videos, and references.</p>
      </div>

      <div className="bg-purple-50 border border-purple-200 rounded-xl p-8 text-center mb-6">
        <p className="text-4xl mb-3">🗂️</p>
        <h2 className="font-semibold text-purple-900 mb-2">Content Library — Coming Soon</h2>
        <p className="text-sm text-purple-700 max-w-sm mx-auto">
          Upload PDFs, videos, and reference materials. Organise by topic or link directly to courses.
        </p>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <h3 className="font-semibold text-gray-900 mb-4 text-sm">Planned Features</h3>
        <ul className="flex flex-col gap-2 text-sm text-gray-600">
          {[
            "Upload PDFs, videos, and EPUB resources",
            "Organise by category, level, and topic",
            "Link materials directly to course modules",
            "Track which nurses have accessed each resource",
            "External link management for YouTube / WHO / NCLEX resources",
            "AI-powered content summarisation",
          ].map(f => (
            <li key={f} className="flex items-start gap-2">
              <span className="text-purple-300 mt-0.5">○</span>
              <span>{f}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
