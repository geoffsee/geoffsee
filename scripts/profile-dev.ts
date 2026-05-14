#!/usr/bin/env bun
/**
 * Fast local README + metrics SVG iteration.
 *
 * Default: renders from `.cache/profile-stats.json` (and downloads JSON if cached).
 *   bun run profile:dev
 *
 * Explicit cache refresh:
 *   bun run profile:dev --refresh
 *
 * First run (no `.cache/`): same as `--refresh` — fetch is automatic.
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const cacheDir = join(root, ".cache");
const statsPath = join(cacheDir, "profile-stats.json");
const downloadsPath = join(cacheDir, "downloads-stats.json");

const argv = process.argv.slice(2);
const help = argv.includes("-h") || argv.includes("--help");
const refresh = argv.includes("--refresh");

if (help) {
  console.log(`Usage: bun run profile:dev [--refresh]

  (default)  Read cached JSON under .cache/ and write README.md + github-metrics.svg (fast).
  --refresh   Re-fetch GitHub stats + npm/crates downloads (slow), update cache, render.

No cache yet runs a full fetch once automatically.`);
  process.exit(0);
}

function run(argv2: string[], label: string): void {
  const r = Bun.spawnSync(["bun", ...argv2], {
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
  });
  if (r.exitCode !== 0) {
    console.error(`${label} exited with ${r.exitCode ?? 1}`);
    process.exit(r.exitCode ?? 1);
  }
}

await mkdir(cacheDir, { recursive: true });

const hadCachedStats = await Bun.file(statsPath).exists();
const shouldFetch = refresh || !hadCachedStats;

if (shouldFetch) {
  if (!hadCachedStats && !refresh) {
    console.error("No `.cache/` stats yet — running GitHub + downloads fetch (slow first run)…");
  }
  run(
    [
      "scripts/gh-profile-stats.ts",
      "--json-out",
      statsPath,
      "--downloads",
      "--downloads-out",
      downloadsPath,
      "--no-write",
    ],
    refresh ? "gh-profile-stats (--refresh)" : "gh-profile-stats (initial cache)",
  );
}

const renderArgs = ["scripts/render-profile.ts", statsPath];
if (await Bun.file(downloadsPath).exists()) {
  renderArgs.push("--downloads", downloadsPath);
}
run(renderArgs, "render-profile");

if (hadCachedStats && !shouldFetch) {
  console.error("Wrote README.md and github-metrics.svg from cache.");
} else {
  console.error("Wrote README.md and github-metrics.svg (cache updated).");
}
