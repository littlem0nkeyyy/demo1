import fs from 'fs';
import path from 'path';

// Every workspace (dashboard app, mcp server, root scripts) needs to find the same
// repo-root `data/` folder and `machina.db` regardless of which directory it was actually
// invoked from (npm workspaces run scripts with cwd set to the package itself, not the
// repo root).
//
// Prefer MACHINA_REPO_ROOT when set — bundlers (Next.js/Turbopack/webpack) rewrite module
// locations, so __dirname inside a bundled chunk does NOT reflect this file's real source
// location; apps/dashboard/next.config.js sets this env var from its own unbundled
// __dirname before Next boots. Falls back to walking up from __dirname, which is reliable
// for plain tsx/vitest execution (mcp server, root scripts, tests) where nothing bundles
// the file.
//
// The marker used to detect the repo root is `.mcp.json` — deliberately NOT anything under
// `data/`, since the dataset's own file layout has changed once already (single ontology.json
// -> per-vertical data/ontologies/*.json) and will likely change again; `.mcp.json` is a
// structural fact about this being the Machina repo, independent of whatever dataset is
// currently loaded.
const ROOT_MARKER = '.mcp.json';
let cached: string | null = null;

export function findRepoRoot(): string {
  if (cached) return cached;

  const fromEnv = process.env.MACHINA_REPO_ROOT;
  if (fromEnv && fs.existsSync(path.join(fromEnv, ROOT_MARKER))) {
    cached = fromEnv;
    return fromEnv;
  }

  let dir = __dirname;
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, ROOT_MARKER))) {
      cached = dir;
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `Could not locate machina repo root (checked MACHINA_REPO_ROOT and walked up from __dirname looking for ${ROOT_MARKER}).`
  );
}

export function dataPath(...segments: string[]): string {
  return path.join(findRepoRoot(), 'data', ...segments);
}
