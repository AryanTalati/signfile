export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 px-4">
      <h1 className="text-3xl font-semibold">signfile</h1>
      <p className="text-lg text-neutral-600">
        Get your client agreement signed on every File. Upload any agreement, send it, and get a sealed PDF with an audit
        certificate.
      </p>
      <p className="text-sm text-neutral-500">
        Status: <a className="underline" href="/api/health">/api/health</a>
      </p>
    </main>
  );
}
