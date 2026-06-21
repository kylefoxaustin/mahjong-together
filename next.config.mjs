/** @type {import('next').NextConfig} */

// A stable id for THIS build, baked into the client bundle. On Vercel it's the
// commit SHA; locally it's "dev". The running app compares this against
// /api/version (the live deployment) to auto-refresh when a new version ships.
const BUILD_ID =
  process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_DEPLOYMENT_ID || "dev";

const nextConfig = {
  env: { NEXT_PUBLIC_BUILD_ID: BUILD_ID },
};

export default nextConfig;
