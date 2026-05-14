/**
 * Render profile-stats JSON → README fragment + metrics SVG.
 */

import type { ProfileStats } from "./profile-stats.ts";
import type { DownloadsStats } from "./downloads-stats.ts";
import { sumCratesAllTime, sumNpmWeekly } from "./downloads-stats.ts";

/** Panel fills — transparent so README / system theme shows through (avoids dark slabs in light mode). */
enum MetricsSvgPanelColor {
  Background = "transparent",
}

/** SVG CSS: defaults match dark UI; light scheme uses GitHub-like foreground/border colors. */
function metricsSvgThemeStyles(): string {
  return `<style><![CDATA[
    .svg-stroke-panel { stroke: #2b3448; }
    .svg-stroke-card { stroke: #34425f; }
    .svg-text-primary { fill: #e6edf3; }
    .svg-text-secondary { fill: #aab6c8; }
    .svg-text-heading { fill: #dce4ef; }
    .svg-text-handle { fill: #8b949e; }
    .svg-text-strong { fill: #ffffff; }
    .svg-text-muted-row { fill: #cdd8e5; }
    .svg-avatar-fill { fill: #121a2a; }
    .svg-avatar-stroke { stroke: #55607a; }
    .svg-avatar-letter { fill: #e6edf3; }
    .svg-chip-fill { fill: #18233a; }
    .svg-chip-stroke { stroke: #2b3c5d; }
    .svg-chip-text { fill: #cdd8e5; }
    .svg-repo-track { fill: #1a253a; }
    .svg-chart-grid { stroke: #2b3448; }
    .svg-chart-axis { stroke: #93a1b7; }
    .svg-link { fill: #58a6ff; }
    .svg-chart-line { stroke: #7ee787; }
    .svg-heat-0 { fill: #161b22; }
    .svg-heat-1 { fill: #0e4429; }
    .svg-heat-2 { fill: #006d32; }
    .svg-heat-3 { fill: #26a641; }
    .svg-heat-4 { fill: #39d353; }

    @media (prefers-color-scheme: light) {
      .svg-stroke-panel, .svg-stroke-card { stroke: #d0d7de; }
      .svg-text-primary { fill: #1f2328; }
      .svg-text-secondary { fill: #59636e; }
      .svg-text-heading { fill: #1f2328; }
      .svg-text-handle { fill: #59636e; }
      .svg-text-strong { fill: #1f2328; }
      .svg-text-muted-row { fill: #424a53; }
      .svg-avatar-fill { fill: #f6f8fa; }
      .svg-avatar-stroke { stroke: #d0d7de; }
      .svg-avatar-letter { fill: #24292f; }
      .svg-chip-fill { fill: #f6f8fa; }
      .svg-chip-stroke { stroke: #d0d7de; }
      .svg-chip-text { fill: #24292f; }
      .svg-repo-track { fill: #eff2f5; }
      .svg-chart-grid { stroke: #d8dee4; }
      .svg-chart-axis { stroke: #818b98; }
      .svg-link { fill: #0969da; }
      .svg-chart-line { stroke: #1a7f37; }
      .svg-heat-0 { fill: #ebedf0; }
      .svg-heat-1 { fill: #9be9a8; }
      .svg-heat-2 { fill: #40c463; }
      .svg-heat-3 { fill: #30a14e; }
      .svg-heat-4 { fill: #216e39; }
      #chartFill stop:first-child { stop-color: #2da44e; }
      #chartFill stop:last-child { stop-color: #2da44e; }
    }
  ]]></style>`;
}

function escXml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function fmt(n: number | null | undefined, fallback = "—"): string {
  if (n == null || !Number.isFinite(n)) return fallback;
  return String(n);
}

function n0(n: number | null | undefined): number {
  if (n == null || !Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 1))}…`;
}

const REPO_UPDATED_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function fmtRepoUpdated(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${REPO_UPDATED_MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

export function statsToTextLines(s: ProfileStats): string[] {
  const lines: string[] = [];
  const title = s.name ? `${s.name} (@${s.login})` : `@${s.login}`;
  lines.push(title);
  if (s.location) lines.push(`📍 ${s.location}`);
  lines.push(
    `followers ${s.counts.followers}  ·  following ${s.counts.following}  ·  public repos ${s.counts.publicNonForkRepos}`,
  );
  lines.push(
    `stars on your repos ${fmt(s.counts.starsReceivedOnOwnedNonForkRepos)}  ·  stars given ${s.counts.starsGiven}  ·  releases ${fmt(s.counts.releasesOnOwnedNonForkRepos)}`,
  );
  const w = s.activityWindow;
  lines.push(
    `~1y public index: commits ${fmt(w.commitsMatchingSearchIndex)}  ·  PRs opened ${fmt(w.pullRequestsCreated)}`,
  );
  const ca = s.contributionsApi;
  lines.push(
    `contributions API: calendar ${ca.contributionCalendar.totalContributions}  ·  commits ${ca.totalCommitContributions}  ·  PRs ${ca.totalPullRequestContributions}`,
  );
  if (s.topPublicReposByStars.length) {
    lines.push("top public repos:");
    for (const r of s.topPublicReposByStars.slice(0, 6)) {
      lines.push(`  ${r.nameWithOwner} ★${r.stargazerCount}`);
    }
  }
  lines.push(`updated ${s.generatedAt.slice(0, 16).replace("T", " ")}Z`);
  return lines;
}

function fmtCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

export function statsToMetricsSvg(
  s: ProfileStats,
  opts?: { width?: number; downloads?: DownloadsStats | null },
): string {
  const width = opts?.width ?? 1280;
  const height = 940;
  const font = "ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif";
  const title = s.name ?? s.login;
  const updated = `Updated ${s.generatedAt.slice(0, 16).replace("T", " ")}Z`;
  const heat = s.contributionsApi.weeklyHeatmapBuckets.slice(-53);
  const recentRepos = s.recentlyUpdatedPublicRepos ?? [];
  const recentStars = s.recentStarsGiven.slice(0, 3);

  const leftX = 28;
  const leftW = 330;
  const mainX = leftX + leftW + 26;
  const mainW = width - mainX - 28;
  const topY = 28;
  const mainMetricsY = topY + 56;
  const mainMetricsH = 370;
  const recentActivityGap = 24;
  const graphY = mainMetricsY + mainMetricsH + recentActivityGap;

  const chartX = mainX + 26;
  const chartY = graphY + 56;
  const chartW = mainW - 52;
  const chartH = 128;
  const points: string[] = [];
  const maxBucket = Math.max(1, ...heat);
  for (let i = 0; i < Math.max(1, heat.length); i++) {
    const v = heat[i] ?? 0;
    const x = chartX + (i * chartW) / Math.max(1, heat.length - 1);
    const y = chartY + chartH - (v / maxBucket) * (chartH - 14);
    points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  const fillPath = `M ${chartX} ${chartY + chartH} L ${points.join(" L ")} L ${chartX + chartW} ${chartY + chartH} Z`;

  const parts: string[] = [];
  parts.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`);
  parts.push(`<defs>`);
  parts.push(`<linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#2ea043" stop-opacity="0.65"/><stop offset="100%" stop-color="#2ea043" stop-opacity="0.04"/></linearGradient>`);
  parts.push(`</defs>`);
  parts.push(metricsSvgThemeStyles());

  parts.push(
    `<rect x="${leftX}" y="${topY}" width="${leftW}" height="${height - 56}" rx="14" fill="${MetricsSvgPanelColor.Background}" class="svg-stroke-panel"/>`,
  );
  parts.push(
    `<circle cx="${leftX + 36}" cy="${topY + 34}" r="20" class="svg-avatar-fill svg-avatar-stroke"/>`,
  );
  parts.push(
    `<text x="${leftX + 36}" y="${topY + 40}" text-anchor="middle" font-family="${font}" font-size="18" font-weight="700" class="svg-avatar-letter">G</text>`,
  );
  parts.push(
    `<text x="${leftX + 78}" y="${topY + 30}" font-family="${font}" font-size="20" font-weight="700" class="svg-text-primary">${escXml(title)}</text>`,
  );
  parts.push(
    `<text x="${leftX + 78}" y="${topY + 56}" font-family="${font}" font-size="18" class="svg-text-handle">@${escXml(s.login)}</text>`,
  );

  let y = topY + 102;
  const line = (label: string, value: string, isHeader = false, categoryRow = false): void => {
    if (isHeader) {
      parts.push(
        `<text x="${leftX + 18}" y="${y}" font-family="${font}" font-size="24" font-weight="700" class="svg-text-heading">${escXml(value)}</text>`,
      );
      y += 28;
      return;
    }
    const rowWeight = categoryRow ? ` font-weight="700"` : "";
    const labelClass = categoryRow ? "svg-text-strong" : "svg-text-secondary";
    const valueClass = categoryRow ? "svg-text-strong" : "svg-text-primary";
    parts.push(
      `<text x="${leftX + 18}" y="${y}" font-family="${font}" font-size="13"${rowWeight} class="${labelClass}">${escXml(label)}</text>`,
    );
    parts.push(
      `<text x="${leftX + leftW - 18}" y="${y}" text-anchor="end" font-family="${font}" font-size="13"${rowWeight} class="${valueClass}">${escXml(value)}</text>`,
    );
    y += 24;
  };
  line("", "Profile", true);
  line("Followers", fmt(s.counts.followers));
  line("Following", fmt(s.counts.following));
  line("Public repos", fmt(s.counts.publicNonForkRepos));
  if (s.location) line("Location", s.location);
  if (s.websiteUrl) line("Website", clip(s.websiteUrl, 30));

  const downloads = opts?.downloads ?? null;
  if (downloads) {
    const npmTotal = sumNpmWeekly(downloads);
    const cratesTotal = sumCratesAllTime(downloads);
    const topNpm = [...downloads.npm.packages]
      .filter((p) => (p.weeklyDownloads ?? 0) > 0)
      .sort((a, b) => (b.weeklyDownloads ?? 0) - (a.weeklyDownloads ?? 0))
      .slice(0, 4);
    const topCrates = [...downloads.crates.crates]
      .filter((c) => (c.allTimeDownloads ?? 0) > 0)
      .sort((a, b) => (b.allTimeDownloads ?? 0) - (a.allTimeDownloads ?? 0))
      .slice(0, 4);

    y += 12;
    line("", "Packages", true);
    line(`npm (~${downloads.npm.packages.length})`, `${fmtCompact(npmTotal)}/wk`, false, true);
    for (const p of topNpm) {
      line(`  ${clip(p.name, 26)}`, fmtCompact(p.weeklyDownloads ?? 0));
    }
    y += 6;
    line(`crates.io (${downloads.crates.crates.length})`, fmtCompact(cratesTotal), false, true);
    for (const c of topCrates) {
      line(`  ${clip(c.name, 26)}`, fmtCompact(c.allTimeDownloads ?? 0));
    }
  }

  parts.push(
    `<rect x="${mainX}" y="${mainMetricsY}" width="${mainW}" height="${mainMetricsH}" rx="12" fill="${MetricsSvgPanelColor.Background}" class="svg-stroke-panel"/>`,
  );
  const gap = 18;
  const cardW = Math.floor((mainW - gap * 4) / 3);
  const cardX1 = mainX + gap;
  const cardX2 = cardX1 + cardW + gap;
  const cardX3 = cardX2 + cardW + gap;
  const cardY = topY + 78;
  const cardH = 326;
  const metricCard = (x: number, heading: string): void => {
    parts.push(
      `<rect x="${x}" y="${cardY}" width="${cardW}" height="${cardH}" rx="10" fill="${MetricsSvgPanelColor.Background}" class="svg-stroke-card"/>`,
    );
    parts.push(
      `<text x="${x + 16}" y="${cardY + 30}" font-family="${font}" font-size="16" font-weight="700" class="svg-text-primary">${escXml(heading)}</text>`,
    );
  };
  metricCard(cardX1, "Contribution Mix");
  metricCard(cardX2, "Momentum");
  metricCard(cardX3, "Recently Updated");

  // Render recent stars as compact chips near the top of the main panel.
  const chipsY = topY + 60;
  parts.push(
    `<text x="${mainX + 20}" y="${chipsY}" font-family="${font}" font-size="12" class="svg-text-secondary">Recent stars</text>`,
  );
  let chipX = mainX + 98;
  for (let i = 0; i < recentStars.length; i++) {
    const label = clip(recentStars[i].nameWithOwner, 22);
    const chipW = Math.min(220, Math.max(90, 16 + label.length * 7));
    parts.push(
      `<rect x="${chipX}" y="${chipsY - 12}" width="${chipW}" height="20" rx="10" class="svg-chip-fill svg-chip-stroke"/>`,
    );
    parts.push(
      `<text x="${chipX + 10}" y="${chipsY + 2}" font-family="${font}" font-size="12" class="svg-chip-text">${escXml(label)}</text>`,
    );
    chipX += chipW + 8;
    if (chipX > mainX + mainW - 220) break;
  }

  const mixRows: Array<[string, number, string]> = [
    ["Commits", Math.max(n0(s.contributionsApi.totalCommitContributions), n0(s.activityWindow.commitsMatchingSearchIndex))],
    ["Issues", Math.max(n0(s.contributionsApi.totalIssueContributions), n0(s.activityWindow.issuesCreated))],
    ["PRs", Math.max(n0(s.contributionsApi.totalPullRequestContributions), n0(s.activityWindow.pullRequestsCreated))],
    ["Reviews", Math.max(n0(s.contributionsApi.totalPullRequestReviewContributions), n0(s.activityWindow.pullRequestsReviewed))],
  ].map((v, i) => [v[0], v[1], ["#4f8df7", "#22c55e", "#a855f7", "#f59e0b"][i]]);

  let mixY = cardY + 82;
  const mixTotal = mixRows.reduce((sum, row) => sum + row[1], 0) || 1;
  const stackX = cardX1 + 16;
  const stackW = cardW - 32;
  let cursor = stackX;
  for (const [, value, color] of mixRows) {
    const segW = Math.max(2, Math.round((value / mixTotal) * stackW));
    parts.push(`<rect x="${cursor}" y="${cardY + 52}" width="${segW}" height="10" rx="4" fill="${color}"/>`);
    cursor += segW;
  }
  for (const [label, value, color] of mixRows) {
    parts.push(`<circle cx="${cardX1 + 20}" cy="${mixY - 4}" r="4" fill="${color}"/>`);
    parts.push(
      `<text x="${cardX1 + 32}" y="${mixY}" font-family="${font}" font-size="14" class="svg-text-muted-row">${escXml(String(label))}</text>`,
    );
    parts.push(
      `<text x="${cardX1 + cardW - 16}" y="${mixY}" text-anchor="end" font-family="${font}" font-size="14" class="svg-text-primary">${value}</text>`,
    );
    mixY += 44;
  }

  const momentumRows = [
    ["~1y PRs opened", fmt(s.activityWindow.pullRequestsCreated)],
    ["~1y issues opened", fmt(s.activityWindow.issuesCreated)],
    ["~1y reviews", fmt(s.activityWindow.pullRequestsReviewed)],
    ["Releases", fmt(s.counts.releasesOnOwnedNonForkRepos)],
    ["Stars given", fmt(s.counts.starsGiven)],
    ["Stars on repos", fmt(s.counts.starsReceivedOnOwnedNonForkRepos)],
  ];
  let mY = cardY + 64;
  for (const [label, value] of momentumRows) {
    parts.push(
      `<text x="${cardX2 + 16}" y="${mY}" font-family="${font}" font-size="14" class="svg-text-secondary">${escXml(label)}</text>`,
    );
    parts.push(
      `<text x="${cardX2 + cardW - 16}" y="${mY}" text-anchor="end" font-family="${font}" font-size="14" class="svg-text-primary">${escXml(value)}</text>`,
    );
    mY += 34;
  }

  const times = recentRepos.map((r) => new Date(r.updatedAt).getTime());
  const maxT = times.length ? Math.max(...times) : 0;
  const minT = times.length ? Math.min(...times) : 0;
  const recencySpan = maxT - minT;
  let rY = cardY + 64;
  for (let i = 0; i < Math.min(5, recentRepos.length); i++) {
    const r = recentRepos[i];
    const t = times[i] ?? 0;
    const ratio = recencySpan <= 0 ? 1 : (t - minT) / recencySpan;
    const barW = Math.max(6, Math.floor(ratio * (cardW - 120)));
    parts.push(
      `<text x="${cardX3 + 16}" y="${rY}" font-family="${font}" font-size="14" class="svg-text-muted-row">${i + 1}</text>`,
    );
    parts.push(
      `<text x="${cardX3 + 34}" y="${rY}" font-family="${font}" font-size="14" class="svg-text-muted-row">${escXml(clip(r.nameWithOwner.split("/")[1] ?? r.nameWithOwner, 16))}</text>`,
    );
    parts.push(
      `<text x="${cardX3 + cardW - 16}" y="${rY}" text-anchor="end" font-family="${font}" font-size="14" class="svg-text-primary">${escXml(fmtRepoUpdated(r.updatedAt))}</text>`,
    );
    parts.push(`<rect x="${cardX3 + 34}" y="${rY + 8}" width="${cardW - 90}" height="7" rx="3.5" class="svg-repo-track"/>`);
    parts.push(`<rect x="${cardX3 + 34}" y="${rY + 8}" width="${barW}" height="7" rx="3.5" fill="#8b5cf6"/>`);
    rY += 50;
  }

  parts.push(
    `<rect x="${mainX}" y="${graphY}" width="${mainW}" height="300" rx="12" fill="${MetricsSvgPanelColor.Background}" class="svg-stroke-panel"/>`,
  );
  parts.push(
    `<text x="${mainX + 24}" y="${graphY + 34}" font-family="${font}" font-size="18" class="svg-text-heading">Recent activity</text>`,
  );
  for (let i = 0; i < 5; i++) {
    const gy = chartY + (i * chartH) / 4;
    parts.push(`<line x1="${chartX}" y1="${gy}" x2="${chartX + chartW}" y2="${gy}" class="svg-chart-grid" stroke-dasharray="2 8"/>`);
  }
  const isFlat = heat.every((v) => v === 0);
  if (!isFlat) {
    parts.push(`<path d="${fillPath}" fill="url(#chartFill)"/>`);
    parts.push(
      `<polyline points="${points.join(" ")}" fill="none" stroke-width="1.5" class="svg-chart-line"/>`,
    );
  } else {
    parts.push(
      `<text x="${chartX + chartW / 2}" y="${chartY + chartH / 2}" text-anchor="middle" font-family="${font}" font-size="15" class="svg-text-secondary">No recent contribution detail available from API token.</text>`,
    );
  }
  parts.push(`<line x1="${chartX}" y1="${chartY + chartH}" x2="${chartX + chartW}" y2="${chartY + chartH}" class="svg-chart-axis"/>`);
  const cell = 9;
  const hGap = 4;
  const hX = chartX;
  const hY = chartY + chartH + 24;
  for (let i = 0; i < 53; i++) {
    const bucket = Math.min(4, Math.max(0, heat[i] ?? 0));
    parts.push(
      `<rect x="${hX + i * (cell + hGap)}" y="${hY}" width="${cell}" height="${cell}" rx="2" class="svg-heat-${bucket}"/>`,
    );
  }
  parts.push(
    `<text x="${mainX + mainW - 24}" y="${graphY + 262}" text-anchor="end" font-family="${font}" font-size="14" class="svg-text-secondary">${escXml(updated)}</text>`,
  );
  if (s.websiteUrl) {
    parts.push(
      `<text x="${mainX + mainW - 24}" y="${graphY + 262}" text-anchor="end" font-family="${font}" font-size="14" class="svg-link">${escXml(s.websiteUrl)}</text>`,
    );
  }
  parts.push(`</svg>`);
  return `${parts.join("\n")}\n`;
}

export function assembleReadme(
  statsImagePath: string,
  bioMarkdown: string,
  cacheBust?: string | null,
): string {
  const img = statsImagePath.trim() || "/github-metrics.svg";
  const v = (cacheBust ?? "").replace(/[^a-zA-Z0-9._-]/g, "");
  const url = v ? `${img}${img.includes("?") ? "&" : "?"}v=${v}` : img;
  const lines = [`![Stats](${url})`, "", bioMarkdown.trimEnd(), ""];
  return lines.join("\n");
}

export function parseProfileStatsJson(raw: string): ProfileStats {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    throw new Error("Invalid JSON.");
  }
  if (typeof v !== "object" || v === null || !("login" in v) || !("counts" in v)) {
    throw new Error("JSON does not look like profile stats (need login, counts, …).");
  }
  return v as ProfileStats;
}
