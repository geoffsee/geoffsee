/**
 * Collect npm download counts from the official npm registry/downloads APIs
 * and crates.io data from the official crates.io API. Falls back to Playwright
 * HTML scraping only when the APIs fail.
 *
 * Requires: playwright (and `bunx playwright install chromium`) only for the
 * HTML fallback paths.
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

type NpmSearchPackage = {
  name?: string;
  version?: string | null;
};

type NpmSearchObject = {
  package?: NpmSearchPackage | null;
};

type NpmSearchResponse = {
  objects?: NpmSearchObject[] | null;
  total?: number | null;
};

type NpmDownloadsPoint = {
  downloads?: number | null;
  package?: string | null;
};

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": PLAYWRIGHT_BROWSER_USER_AGENT },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return response.json();
}

async function collectNpmPackagesFromApi(
  user: string,
  log: (msg: string) => void,
): Promise<NpmPackage[] | null> {
  const byName = new Map<string, { version: string | null }>();
  const pageSize = 250;
  let from = 0;
  let total: number | null = null;

  while (true) {
    const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(`maintainer:${user}`)}&size=${pageSize}&from=${from}`;
    let payload: unknown;
    try {
      payload = await fetchJson(url);
    } catch (error) {
      log(`Could not fetch npm search for ${user}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
    if (!isObject(payload)) return null;
    const data = payload as NpmSearchResponse;
    const objects = Array.isArray(data.objects) ? data.objects : [];
    if (typeof data.total === "number") total = data.total;

    for (const obj of objects) {
      const pkg = isObject(obj) ? obj.package : null;
      if (!isObject(pkg) || typeof pkg.name !== "string" || !pkg.name.trim()) continue;
      const name = pkg.name.trim();
      if (byName.has(name)) continue;
      byName.set(name, {
        version: typeof pkg.version === "string" && pkg.version ? pkg.version : null,
      });
    }

    from += objects.length;
    if (objects.length < pageSize) break;
    if (total !== null && from >= total) break;
    if (objects.length === 0) break;
  }

  const names = [...byName.keys()];
  if (names.length === 0) return [];

  const downloads = await fetchNpmWeeklyDownloads(names, log);

  const out: NpmPackage[] = names.map((name) => ({
    name,
    version: byName.get(name)?.version ?? null,
    weeklyDownloads: downloads.get(name) ?? null,
  }));
  for (const pkg of out) {
    log(`  ${pkg.name}: ${pkg.weeklyDownloads ?? "?"}/wk`);
  }
  return out;
}

const NPM_DOWNLOADS_CONCURRENCY = 8;

async function fetchNpmWeeklyDownloads(
  names: string[],
  log: (msg: string) => void,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  let next = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= names.length) return;
      const name = names[i]!;
      const url = `https://api.npmjs.org/downloads/point/last-week/${encodeURIComponent(name)}`;
      try {
        const payload = (await fetchJson(url)) as NpmDownloadsPoint | null;
        const downloads = isObject(payload) ? payload.downloads : null;
        if (typeof downloads === "number" && Number.isFinite(downloads)) {
          out.set(name, downloads);
        }
      } catch (error) {
        log(`Could not fetch npm downloads for ${name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(NPM_DOWNLOADS_CONCURRENCY, names.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return out;
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

type CratesApiCrate = {
  name?: string;
  max_version?: string | null;
  newest_version?: string | null;
  default_version?: string | null;
  downloads?: number | null;
  recent_downloads?: number | null;
};

type CratesApiPage = {
  crates?: CratesApiCrate[] | null;
  meta?: {
    next_page?: string | null;
    prev_page?: string | null;
    total?: number | null;
  };
};

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function numberOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

async function collectCratesFromApi(user: string, log: (msg: string) => void): Promise<Crate[] | null> {
  const userUrl = `https://crates.io/api/v1/users/${encodeURIComponent(user)}`;
  const userResponse = await fetch(userUrl, {
    headers: { "User-Agent": PLAYWRIGHT_BROWSER_USER_AGENT, Accept: "application/json" },
  });
  if (!userResponse.ok) {
    log(`Could not resolve crates.io user id for ${user}: ${userResponse.status}`);
    return null;
  }

  let userData: unknown;
  try {
    userData = await userResponse.json();
  } catch (error) {
    log(`Could not parse crates.io user response for ${user}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }

  const uid = isObject(userData) && isObject(userData.user) ? userData.user.id : null;
  if (!(typeof uid === "number" || typeof uid === "string")) {
    log(`Could not resolve crates.io id from API for ${user}.`);
    return null;
  }

  const out = new Map<string, Crate>();
  let next = `https://crates.io/api/v1/crates?per_page=100&user_id=${encodeURIComponent(String(uid))}&page=1`;
  while (next) {
    const response = await fetch(next, {
      headers: { "User-Agent": PLAYWRIGHT_BROWSER_USER_AGENT, Accept: "application/json" },
    });
    if (!response.ok) {
      log(`Could not fetch crates.io crates for ${user} at ${next}: ${response.status}`);
      return null;
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      log(`Could not parse crates.io crates response for ${user}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
    const pageData = payload as CratesApiPage;
    const rows = isObject(pageData) ? pageData.crates : null;
    if (!Array.isArray(rows)) {
      return null;
    }

    for (const item of rows) {
      if (!isObject(item) || typeof item.name !== "string" || !item.name.trim()) continue;
      const name = item.name.trim();
      out.set(name, {
        name,
        version: typeof item.max_version === "string" && item.max_version
          ? item.max_version
          : typeof item.newest_version === "string" && item.newest_version
            ? item.newest_version
            : typeof item.default_version === "string" && item.default_version
              ? item.default_version
              : null,
        allTimeDownloads: numberOrNull(item.downloads),
        recentDownloads: numberOrNull(item.recent_downloads),
      });
    }

    const nextPage = isObject(pageData.meta) ? pageData.meta.next_page : null;
    if (typeof nextPage === "string" && nextPage.length > 0) {
      next = new URL(nextPage, "https://crates.io").toString();
    } else {
      next = "";
    }
  }

  return [...out.values()];
}

async function collectCratesFromHtml(ctx: BrowserContext, page: Page, user: string): Promise<Crate[]> {
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

async function collectNpmFromHtml(
  ctx: BrowserContext,
  page: Page,
  user: string,
  log: (msg: string) => void,
): Promise<NpmPackage[]> {
  const names = await collectNpmPackageNames(page, user);
  return collectNpmPackageStatsParallel(ctx, names, log);
}

type BrowserHandle = {
  ctx: BrowserContext;
  page: Page;
  close: () => Promise<void>;
};

async function launchBrowser(headed: boolean): Promise<BrowserHandle> {
  const browser: Browser = await chromium.launch({ headless: !headed });
  const ctx = await browser.newContext({ userAgent: PLAYWRIGHT_BROWSER_USER_AGENT });
  const page = await ctx.newPage();
  return {
    ctx,
    page,
    close: () => browser.close(),
  };
}

export async function collectDownloadsStats(opts: {
  npmUser: string;
  cratesUser: string;
  headed?: boolean;
  onProgress?: (msg: string) => void;
}): Promise<DownloadsStats> {
  const log = opts.onProgress ?? (() => {});

  log(`Collecting npm packages for ${opts.npmUser} via registry API...`);
  let npmPackages = await collectNpmPackagesFromApi(opts.npmUser, log);
  let crates: Crate[] | null = null;
  let browser: BrowserHandle | null = null;
  try {
    log(`Collecting crates for ${opts.cratesUser} via crates.io API...`);
    const cratesFromApi = await collectCratesFromApi(opts.cratesUser, log);
    if (cratesFromApi !== null) {
      crates = cratesFromApi;
    }

    if (npmPackages === null || crates === null) {
      browser = await launchBrowser(opts.headed ?? false);
    }

    if (npmPackages === null) {
      log(`Falling back to HTML scraping for npm user ${opts.npmUser}...`);
      npmPackages = await collectNpmFromHtml(browser!.ctx, browser!.page, opts.npmUser, log);
    }
    if (crates === null) {
      log(`Falling back to HTML scraping for crates.io user ${opts.cratesUser}...`);
      crates = await collectCratesFromHtml(browser!.ctx, browser!.page, opts.cratesUser);
    }

    log(`Found ${npmPackages.length} npm packages.`);
    npmPackages.sort((a, b) => (b.weeklyDownloads ?? -1) - (a.weeklyDownloads ?? -1));
    log(`Found ${crates.length} crates.`);
    crates.sort((a, b) => (b.allTimeDownloads ?? -1) - (a.allTimeDownloads ?? -1));

    return {
      generatedAt: new Date().toISOString(),
      npm: { user: opts.npmUser, packages: npmPackages },
      crates: { user: opts.cratesUser, crates },
    };
  } finally {
    if (browser) await browser.close();
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
