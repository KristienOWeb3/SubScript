"use client";

export default function AdminUnavailable() {
  return <main className="min-h-screen bg-white p-8 text-slate-900">
    <h1 className="text-xl font-bold">Admin console temporarily unavailable</h1>
    <p className="mt-3">Access verification failed. Please retry in a moment.</p>
    <button className="mt-4 rounded bg-blue-700 px-4 py-2 text-white" onClick={() => window.location.reload()}>Retry</button>
  </main>;
}
