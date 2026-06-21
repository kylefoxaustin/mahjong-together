// Reports the LIVE deployment's id so an already-open app can notice a new
// version and refresh itself (see components/useAutoUpdate.js). Always fresh.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const id =
    process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_DEPLOYMENT_ID || "dev";
  return new Response(JSON.stringify({ id }), {
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store, max-age=0",
    },
  });
}
