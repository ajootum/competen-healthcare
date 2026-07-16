// Route-level loading skeleton — makes navigation feel instant while
// server components fetch (perceived-performance fix from the review).
export default function Loading() {
  return (
    <div className="max-w-5xl animate-pulse">
      <div className="h-6 w-64 bg-gray-200 rounded mb-2" />
      <div className="h-3 w-96 bg-gray-100 rounded mb-8" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {[0, 1, 2, 3].map(i => <div key={i} className="h-24 bg-white border border-gray-100 rounded-xl" />)}
      </div>
      <div className="h-64 bg-white border border-gray-100 rounded-xl" />
    </div>
  );
}
