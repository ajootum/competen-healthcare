export default function OscePage() {
  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">OSCE Sessions</h1>
        <p className="text-gray-400 text-sm mt-0.5">Objective Structured Clinical Examination management.</p>
      </div>

      <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-8 text-center">
        <p className="text-4xl mb-3">🩺</p>
        <h2 className="font-semibold text-indigo-900 mb-2">OSCE Station Builder — Coming Soon</h2>
        <p className="text-sm text-indigo-700 max-w-sm mx-auto">
          Create custom OSCE stations with scoring rubrics, schedule sessions, and record performance digitally.
          This feature is under active development.
        </p>
      </div>

      <div className="mt-6 bg-white border border-gray-200 rounded-xl p-5">
        <h3 className="font-semibold text-gray-900 mb-4 text-sm">Planned Features</h3>
        <ul className="flex flex-col gap-2 text-sm text-gray-600">
          {[
            "Create reusable OSCE station templates",
            "Schedule sessions with date, time, and assigned nurses",
            "Digital marking sheets with live scoring",
            "Automatic pass/fail determination",
            "Integration with competency passport",
            "PDF certificates for passing candidates",
          ].map(f => (
            <li key={f} className="flex items-start gap-2">
              <span className="text-gray-300 mt-0.5">○</span>
              <span>{f}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
