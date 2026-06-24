export default function AssessmentHistoryPage() {
  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Assessment History</h1>
        <p className="text-gray-400 text-sm mt-0.5">Past audits and assessment reports.</p>
      </div>

      <div className="bg-white border border-gray-100 rounded-xl p-12 text-center">
        <p className="text-3xl mb-3">📁</p>
        <p className="text-gray-500 font-medium text-sm">No saved assessments yet</p>
        <p className="text-gray-400 text-xs mt-1 max-w-xs mx-auto">
          Completed audit reports are downloaded as PDFs. Persistent history storage is coming in a future release.
        </p>
        <a href="/assessor/assess"
          className="mt-4 inline-block text-sm text-indigo-600 border border-indigo-200 px-4 py-2 rounded-lg hover:bg-indigo-50 transition-colors">
          Start an assessment →
        </a>
      </div>
    </div>
  );
}
