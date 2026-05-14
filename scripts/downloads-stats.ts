#!/usr/bin/env bun
/**
 * Output JSON of npm packages (seemueller-io) and crates.io crates (geoffsee)
 * with download counts, scraped via Playwright.
 *
 * Requires: bun add -d playwright && bunx playwright install chromium
 *
 * Usage:
 *   bun scripts/downloads-stats.ts [--npm-user USER] [--crates-user USER] [--out PATH] [--headed]
 */

import { collectDownloadsStats } from "./lib/downloads-stats.ts";

type Opts = {
  npmUser: string;
  cratesUser: string;
  out: string | null;
  headed: boolean;
};

function parseArgs(argv: string[]): Opts {
  let npmUser = "seemueller-io";
  let cratesUser = "geoffsee";
  let out: string | null = null;
  let headed = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--npm-user") npmUser = argv[++i]!;
    else if (a === "--crates-user") cratesUser = argv[++i]!;
    else if (a === "--out") out = argv[++i]!;
    else if (a === "--headed") headed = true;
    else if (a === "-h" || a === "--help") {
      console.log(
        "Usage: bun scripts/downloads-stats.ts [--npm-user USER] [--crates-user USER] [--out PATH] [--headed]",
      );
      process.exit(0);
    } else {
      console.error(`Unknown flag: ${a}`);
      process.exit(2);
    }
  }
  return { npmUser, cratesUser, out, headed };
}

try {
  const opts = parseArgs(process.argv.slice(2));
  const stats = await collectDownloadsStats({
    npmUser: opts.npmUser,
    cratesUser: opts.cratesUser,
    headed: opts.headed,
    onProgress: (msg) => console.error(msg),
  });
  const json = JSON.stringify(stats, null, 2);
  if (opts.out) {
    await Bun.write(opts.out, json);
    console.error(`Wrote ${opts.out}`);
  } else {
    console.log(json);
  }
} catch (e) {
  console.error(e instanceof Error ? e.stack || e.message : e);
  process.exit(1);
}
