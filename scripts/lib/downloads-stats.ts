/**
 * Scrape npm + crates.io profile pages with Playwright to collect package
 * download counts.
 *
 * Requires: playwright (and `bunx playwright install chromium`).
 */

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import {
  mapWithDedicatedPages,
  PLAYWRIGHT_BROWSER_USER_AGENT,
} from "./playwright-utils.ts";

export type NpmPackage = {
  name: string;
  version: string | null;
  weeklyDownloads: number | null;
};

export type Crate = {
  name: string;
  version: string | null;
  allTimeDownloads: number | null;
  recentDownloads: number | null;
};

export type DownloadsStats = {
  generatedAt: string;
  npm: { user: string; packages: NpmPackage[] };
  crates: { user: string; crates: Crate[] };
};

function parseIntLoose(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = s.replace(/,/g, "").match(/-?\d+/);
  return m ? parseInt(m[0], 10) : null;
}

async function collectNpmPackageNames(page: Page, user: string): Promise<string[]> {
  const names = new Set<string>();
  let pageIdx = 0;
  while (true) {
    const url = `https://www.npmjs.com/~${encodeURIComponent(user)}?page=${pageIdx}`;
    await page.goto(url, { waitUntil: "domcontentloaded" });
    const { pageNames, hasNext } = await page.evaluate(() => {
      const found: string[] = [];
      document.querySelectorAll('a[href^="/package/"]').forEach((a) => {
        const href = a.getAttribute("href") || "";
        const name = href.replace(/^\/package\//, "").split(/[?#]/)[0];
        if (name) found.push(name);
      });
      const next = !!document.querySelector('a[rel="next"], a[aria-label="Next page"]');
      return { pageNames: found, hasNext: next };
    });
    const before = names.size;
    for (const n of pageNames) names.add(n);
    if (!hasNext || names.size === before) break;
    pageIdx++;
  }
  return [...names];
}

async function fetchNpmPackageStats(page: Page, name: string): Promise<NpmPackage> {
  await page.goto(`https://www.npmjs.com/package/${name}`, { waitUntil: "domcontentloaded" });
  await page
    .waitForFunction(() => /Weekly Downloads[\s\S]{0,40}\d/.test(document.body.innerText), null, {
      timeout: 15000,
    })
    .catch(() => {});
  const data = await page.evaluate(() => {
    const t = document.body.innerText;
    const weeklyMatch = t.match(/Weekly Downloads\s*([\d,]+)/i);
    const versionMatch = t.match(/\bVersion\b\s*([^\s\n]+)/);
    return {
      weekly: weeklyMatch ? weeklyMatch[1] : null,
      version: versionMatch ? versionMatch[1] : null,
    };
  });
  return {
    name,
    version: data.version,
    weeklyDownloads: parseIntLoose(data.weekly),
  };
}

async function collectNpmPackageStatsParallel(
  ctx: BrowserContext,
  names: string[],
  log: (msg: string) => void,
): Promise<NpmPackage[]> {
  return mapWithDedicatedPages(ctx, names, async (page, name) => {
    let stats = await fetchNpmPackageStats(page, name);
    if (stats.weeklyDownloads === null) stats = await fetchNpmPackageStats(page, name);
    log(`  ${stats.name}: ${stats.weeklyDownloads ?? "?"}/wk`);
    return stats;
  });
}

type CratesListingRow = {
  name: string;
  version: string | null;
  allTime: string | null;
  recent: string | null;
};

type CratesListingPage = {
  items: CratesListingRow[];
  total: string | null;
};

async function fetchCratesListingPage(page: Page, user: string, pageIdx: number): Promise<CratesListingPage> {
  const url = `https://crates.io/users/${encodeURIComponent(user)}?page=${pageIdx}`;
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForSelector('a[href^="/crates/"]', { timeout: 15000 }).catch(() => {});

  return page.evaluate(() => {
    const items: CratesListingRow[] = [];
    const seen = new Set<string>();
    document.querySelectorAll('a[href^="/crates/"]').forEach((a) => {
      const href = a.getAttribute("href") || "";
      const m = href.match(/^\/crates\/([^/?#]+)$/);
      if (!m) return;
      const name = m[1];
      if (seen.has(name)) return;
      const row = a.closest("li, article");
      if (!row) return;
      const text = (row as HTMLElement).innerText || "";
      const versionMatch = text.match(/\bv([^\s\n]+)/);
      const allTimeMatch = text.match(/All-?Time:\s*([\d,]+)/i);
      const recentMatch = text.match(/Recent:\s*([\d,]+)/i);
      if (!allTimeMatch && !recentMatch) return;
      seen.add(name);
      items.push({
        name,
        version: versionMatch ? versionMatch[1] : null,
        allTime: allTimeMatch ? allTimeMatch[1] : null,
        recent: recentMatch ? recentMatch[1] : null,
      });
    });
    const total = (document.body.innerText.match(/of\s+(\d+)\s+total/i) || [])[1] || null;
    return { items, total };
  });
}

function listingRowsToCrates(rows: CratesListingRow[]): Crate[] {
  return rows.map((it) => ({
    name: it.name,
    version: it.version,
    allTimeDownloads: parseIntLoose(it.allTime),
    recentDownloads: parseIntLoose(it.recent),
  }));
}

async function collectCrates(ctx: BrowserContext, page: Page, user: string): Promise<Crate[]> {
  const byName = new Map<string, Crate>();

  const addPage = (listing: CratesListingPage): void => {
    for (const c of listingRowsToCrates(listing.items)) {
      if (!byName.has(c.name)) byName.set(c.name, c);
    }
  };

  const first = await fetchCratesListingPage(page, user, 1);
  if (first.items.length === 0) return [];

  addPage(first);

  const total = first.total ? parseInt(first.total, 10) : null;
  const perPage = first.items.length;

  if (total !== null) {
    if (byName.size < total) {
      const numPages = Math.max(1, Math.ceil(total / perPage));
      const rest = Array.from({ length: Math.max(0, numPages - 1) }, (_, i) => i + 2);
      for (const listing of await mapWithDedicatedPages(ctx, rest, (pw, idx) =>
        fetchCratesListingPage(pw, user, idx),
      )) {
        addPage(listing);
      }
      let tail = numPages + 1;
      while (byName.size < total && tail <= numPages + 24) {
        const listing = await fetchCratesListingPage(page, user, tail++);
        if (listing.items.length === 0) break;
        const before = byName.size;
        addPage(listing);
        if (byName.size === before) break;
      }
    }
  } else {
    let pageIdx = 2;
    while (true) {
      const listing = await fetchCratesListingPage(page, user, pageIdx);
      if (listing.items.length === 0) break;
      const before = byName.size;
      addPage(listing);
      if (byName.size === before) break;
      pageIdx++;
    }
  }

  return [...byName.values()];
}

export async function collectDownloadsStats(opts: {
  npmUser: string;
  cratesUser: string;
  headed?: boolean;
  onProgress?: (msg: string) => void;
}): Promise<DownloadsStats> {
  const log = opts.onProgress ?? (() => {});
  const browser: Browser = await chromium.launch({ headless: !opts.headed });
  const ctx = await browser.newContext({ userAgent: PLAYWRIGHT_BROWSER_USER_AGENT });
  const page = await ctx.newPage();
  try {
    log(`Collecting npm packages for ${opts.npmUser}...`);
    const names = await collectNpmPackageNames(page, opts.npmUser);
    log(`Found ${names.length} npm packages; fetching weekly downloads...`);
    const npmPackages = await collectNpmPackageStatsParallel(ctx, names, log);
    npmPackages.sort((a, b) => (b.weeklyDownloads ?? -1) - (a.weeklyDownloads ?? -1));

    log(`Collecting crates for ${opts.cratesUser}...`);
    const crates = await collectCrates(ctx, page, opts.cratesUser);
    log(`Found ${crates.length} crates.`);
    crates.sort((a, b) => (b.allTimeDownloads ?? -1) - (a.allTimeDownloads ?? -1));

    return {
      generatedAt: new Date().toISOString(),
      npm: { user: opts.npmUser, packages: npmPackages },
      crates: { user: opts.cratesUser, crates },
    };
  } finally {
    await browser.close();
  }
}

export function sumNpmWeekly(stats: DownloadsStats): number {
  return stats.npm.packages.reduce((sum, p) => sum + (p.weeklyDownloads ?? 0), 0);
}

export function sumCratesAllTime(stats: DownloadsStats): number {
  return stats.crates.crates.reduce((sum, c) => sum + (c.allTimeDownloads ?? 0), 0);
}

export function parseDownloadsStatsJson(raw: string): DownloadsStats {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    throw new Error("Invalid downloads JSON.");
  }
  if (
    typeof v !== "object" ||
    v === null ||
    !("npm" in v) ||
    !("crates" in v)
  ) {
    throw new Error("JSON does not look like downloads stats (need npm, crates).");
  }
  return v as DownloadsStats;
}
