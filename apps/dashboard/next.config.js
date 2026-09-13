const path = require('path');
// Single .env lives at the monorepo root (shared with mcp/server); Next.js only auto-loads
// env files from its own app directory, so load the root one explicitly before anything
// else touches process.env.
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

// This file runs in a plain (unbundled) Node context, so __dirname is reliable here — set
// it once so packages/schemas' findRepoRoot() doesn't have to guess from inside a
// Turbopack-bundled chunk, where __dirname no longer reflects the real source location.
process.env.MACHINA_REPO_ROOT = path.resolve(__dirname, '../..');

/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['better-sqlite3'],
  transpilePackages: ['@machina/schemas', '@machina/database', '@machina/core', '@machina/retrieval'],
};

module.exports = nextConfig;
