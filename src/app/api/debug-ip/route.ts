// TEMPORARY: inspect how Render's proxy sets client-IP headers. Remove after.
export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const out: Record<string, string> = {};
  req.headers.forEach((v, k) => {
    if (/forward|client|real-ip|cf-|true-|via|x-envoy|rndr|render/i.test(k)) out[k] = v;
  });
  return Response.json(out, { headers: { "cache-control": "no-store" } });
}
