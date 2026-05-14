#!/usr/bin/env bun
/**
 * One-pass profile update: collect stats via `gh`, write github-metrics.svg + README.md, print a summary.
 *
 * Usage:
 *   bun scripts/gh-profile-stats.ts [--login HANDLE]
 *
 * Other modes:
 *   --json              Only print stats JSON to stdout (no SVG/README writes)
 *   --no-write          Only print summary (no files)
 *   --json-out PATH     Also save stats JSON (with default mode, or with --no-write)
 *
 * Paths (default layout matches this repo):
 *   --svg PATH  --readme PATH  --bio PATH  --image-ref PATH
 */

import { collectProfileStats, resolveGhLogin, type ProfileStats } from "./lib/profile-stats.ts";
import { assembleReadme, statsToMetricsSvg } from "./lib/profile-render.ts";
import {
  collectDownloadsStats,
  type DownloadsStats,
  parseDownloadsStatsJson,
} from "./lib/downloads-stats.ts";

type Opts = {
  help: boolean;
  login: string | null;
  jsonStdout: boolean;
  noWrite: boolean;
  jsonOut: string | null;
  svg: string;
  readme: string;
  bio: string;
  imageRef: string;
  downloads: boolean;
  npmUser: string;
  cratesUser: string;
  downloadsIn: string | null;
  downloadsOut: string | null;
};

function parseArgs(argv: string[]): Opts {
  let help = false;
  let login: string | null = null;
  let jsonStdout = false;
  let noWrite = false;
  let jsonOut: string | null = null;
  let svg = "github-metrics.svg";
  let readme = "README.md";
  let bio = "assets/bio.md";
  let imageRef = "/github-metrics.svg";
  let downloads = false;
  let npmUser = "seemueller-io";
  let cratesUser = "geoffsee";
  let downloadsIn: string | null = null;
  let downloadsOut: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") help = true;
    else if (a === "--json" || a === "-j") jsonStdout = true;
    else if (a === "--no-write") noWrite = true;
    else if (a === "--json-out") {
      const v = argv[++i];
      if (!v || v.startsWith("-")) {
        console.error("Expected PATH after --json-out");
        process.exit(2);
      }
      jsonOut = v;
    } else if (a === "--login" || a === "-l") {
      const v = argv[++i];
      if (!v || v.startsWith("-")) {
        console.error("Expected HANDLE after --login");
        process.exit(2);
      }
      login = v;
    } else if (a === "--svg") {
      const v = argv[++i];
      if (!v) {
        console.error("Expected PATH after --svg");
        process.exit(2);
      }
      svg = v;
    } else if (a === "--readme") {
      const v = argv[++i];
      if (!v) {
        console.error("Expected PATH after --readme");
        process.exit(2);
      }
      readme = v;
    } else if (a === "--bio") {
      const v = argv[++i];
      if (!v) {
        console.error("Expected PATH after --bio");
        process.exit(2);
      }
      bio = v;
    } else if (a === "--image-ref") {
      const v = argv[++i];
      if (!v) {
        console.error("Expected PATH after --image-ref");
        process.exit(2);
      }
      imageRef = v;
    } else if (a === "--downloads") {
      downloads = true;
    } else if (a === "--npm-user") {
      const v = argv[++i];
      if (!v) { console.error("Expected USER after --npm-user"); process.exit(2); }
      npmUser = v;
    } else if (a === "--crates-user") {
      const v = argv[++i];
      if (!v) { console.error("Expected USER after --crates-user"); process.exit(2); }
      cratesUser = v;
    } else if (a === "--downloads-in") {
      const v = argv[++i];
      if (!v) { console.error("Expected PATH after --downloads-in"); process.exit(2); }
      downloadsIn = v;
    } else if (a === "--downloads-out") {
      const v = argv[++i];
      if (!v) { console.error("Expected PATH after --downloads-out"); process.exit(2); }
      downloadsOut = v;
    } else if (a.startsWith("-")) {
      console.error(`Unknown flag: ${a}`);
      process.exit(2);
    } else if (login) {
      console.error("Pass at most one HANDLE as LOGIN, or use --login.");
      process.exit(2);
    } else login = a;
  }

  return {
    help, login, jsonStdout, noWrite, jsonOut, svg, readme, bio, imageRef,
    downloads, npmUser, cratesUser, downloadsIn, downloadsOut,
  };
}

function printSummary(stats: ProfileStats): void {
  const nm = stats.name ? `${stats.login} (${stats.name})` : stats.login;
  console.log(`Profile: ${nm}`);
  if (stats.bio) console.log(stats.bio);
  console.log(
    `Followers: ${stats.counts.followers}  Following: ${stats.counts.following}  Public repos (non-fork): ${stats.counts.publicNonForkRepos}`,
  );
  console.log(
    `Stars received (your public non-fork repos): ${stats.counts.starsReceivedOnOwnedNonForkRepos ?? "—"}  Stars given: ${stats.counts.starsGiven}  Releases: ${stats.counts.releasesOnOwnedNonForkRepos ?? "—"}`,
  );
  const w = stats.activityWindow;
  console.log(
    `~Last year (public search index): commits as author: ${w.commitsMatchingSearchIndex ?? "—"}; PRs opened: ${w.pullRequestsCreated ?? "—"}`,
  );
  const ca = stats.contributionsApi;
  console.log(
    `Contributions API (${ca.window.from.slice(0, 10)} … ${ca.window.to.slice(0, 10)}): calendar total=${ca.contributionCalendar.totalContributions} commits=${ca.totalCommitContributions} PRs=${ca.totalPullRequestContributions} reviews=${ca.totalPullRequestReviewContributions}`,
  );
  if (ca.note) console.log(`(${ca.note})`);
  if (stats.topPublicReposByStars.length) {
    console.log("Top public repos by stars:");
    for (const r of stats.topPublicReposByStars) {
      console.log(`  ${r.nameWithOwner} ★${r.stargazerCount}`);
    }
  }
}

try {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(`Usage: bun scripts/gh-profile-stats.ts [options] [LOGIN]

Default: fetch stats with gh, write github-metrics.svg and README.md, print summary.

Options:
  -l, --login HANDLE     GitHub login (else \`gh api user\`)
  -j, --json             Print JSON only; do not write SVG/README
      --no-write         Print summary only; do not write SVG/README
      --json-out PATH    Save stats JSON to PATH
      --svg PATH         (default: github-metrics.svg)
      --readme PATH      (default: README.md)
      --bio PATH         (default: assets/bio.md)
      --image-ref PATH   README image URL (default: /github-metrics.svg)
      --downloads        Also scrape npm + crates.io downloads (Playwright)
      --npm-user USER    npm handle (default: seemueller-io)
      --crates-user USER crates.io handle (default: geoffsee)
      --downloads-in PATH  Load downloads JSON from PATH (skips scraping)
      --downloads-out PATH Save downloads JSON to PATH

To render from a saved JSON file: bun scripts/render-profile.ts stats.json`);
    process.exit(0);
  }

  const resolved = resolveGhLogin(opts.login);
  if (!resolved.ok || !resolved.value) {
    console.error(resolved.stderr);
    process.exit(resolved.status);
  }

  const stats = collectProfileStats(resolved.value);

  let downloads: DownloadsStats | null = null;
  if (opts.downloadsIn) {
    const f = Bun.file(opts.downloadsIn);
    if (!(await f.exists())) {
      console.error(`Not found: ${opts.downloadsIn}`);
      process.exit(1);
    }
    downloads = parseDownloadsStatsJson(await f.text());
  } else if (opts.downloads) {
    downloads = await collectDownloadsStats({
      npmUser: opts.npmUser,
      cratesUser: opts.cratesUser,
      onProgress: (msg) => console.error(msg),
    });
  }
  if (downloads && opts.downloadsOut) {
    await Bun.write(opts.downloadsOut, JSON.stringify(downloads, null, 2));
    console.error(`Wrote ${opts.downloadsOut}`);
  }

  if (opts.jsonOut) {
    await Bun.write(opts.jsonOut, JSON.stringify(stats, null, 2));
    console.error(`Wrote ${opts.jsonOut}`);
  }

  if (opts.jsonStdout) {
    console.log(JSON.stringify(stats, null, 2));
    process.exit(0);
  }

  const writeAssets = !opts.noWrite;
  if (writeAssets) {
    const svgOut = statsToMetricsSvg(stats, { downloads });
    await Bun.write(opts.svg, svgOut);

    const bioFile = Bun.file(opts.bio);
    const bioText = (await bioFile.exists()) ? await bioFile.text() : "";
    const cacheBust = Bun.hash(svgOut).toString(36).slice(0, 8);
    await Bun.write(opts.readme, assembleReadme(opts.imageRef, bioText, cacheBust));

    console.error(`Wrote ${opts.svg} (${svgOut.length} bytes) and ${opts.readme}`);
  }

  printSummary(stats);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
