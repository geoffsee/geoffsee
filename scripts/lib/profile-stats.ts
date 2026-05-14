/**
 * Collect profile-wide GitHub stats via `gh` (REST + GraphQL + Search).
 */

export type ProfileStats = {
  generatedAt: string;
  login: string;
  name: string | null;
  bio: string | null;
  url: string;
  websiteUrl: string | null;
  location: string | null;
  createdAt: string;
  counts: {
    followers: number;
    following: number;
    publicNonForkRepos: number;
    starsGiven: number;
    starsReceivedOnOwnedNonForkRepos: number | null;
    releasesOnOwnedNonForkRepos: number | null;
  };
  activityWindow: {
    sinceDate: string;
    throughDate: string;
    commitsMatchingSearchIndex: number | null;
    pullRequestsCreated: number | null;
    issuesCreated: number | null;
    pullRequestsReviewed: number | null;
  };
  contributionsApi: {
    window: { from: string; to: string };
    totalCommitContributions: number;
    totalIssueContributions: number;
    totalPullRequestContributions: number;
    totalPullRequestReviewContributions: number;
    contributionCalendar: { totalContributions: number };
    weeklyHeatmapBuckets: number[];
    note: string | null;
  };
  topPublicReposByStars: { nameWithOwner: string; stargazerCount: number }[];
  recentStarsGiven: { nameWithOwner: string; starredAt: string }[];
};

type GhResult =
  | { ok: true; stdout: string }
  | { ok: false; stderr: string; status: number };

type UserGraph = {
  data?: {
    user: {
      login: string;
      name: string | null;
      bio: string | null;
      url: string;
      websiteUrl: string | null;
      location: string | null;
      createdAt: string;
      followers: { totalCount: number };
      following: { totalCount: number };
      starredRepositories: { totalCount: number };
      ownedPublicNonForkRepos: { totalCount: number };
      topStars: {
        nodes: { nameWithOwner: string; stargazerCount: number }[];
      };
      reposForReleaseCount: {
        nodes: { releases: { totalCount: number } }[];
      };
      recentStarsGiven: {
        edges: { starredAt: string; node: { nameWithOwner: string } }[];
      };
      contributionsCollection: {
        totalCommitContributions: number;
        totalIssueContributions: number;
        totalPullRequestContributions: number;
        totalPullRequestReviewContributions: number;
        contributionCalendar: {
          totalContributions: number;
          weeks: { contributionDays: { contributionCount: number }[] }[];
        };
      };
    } | null;
  };
  errors?: { message: string }[];
};

const PROFILE_QUERY = `
query ProfileStats($login: String!, $from: DateTime!, $to: DateTime!) {
  user(login: $login) {
    login
    name
    bio
    url
    websiteUrl
    location
    createdAt
    followers { totalCount }
    following { totalCount }
    starredRepositories { totalCount }
    ownedPublicNonForkRepos: repositories(isFork: false, privacy: PUBLIC) { totalCount }
    topStars: repositories(isFork: false, privacy: PUBLIC, first: 8, orderBy: { field: STARGAZERS, direction: DESC}) {
      nodes { nameWithOwner stargazerCount }
    }
    reposForReleaseCount: repositories(isFork: false, privacy: PUBLIC, first: 100) {
      nodes { releases { totalCount } }
    }
    recentStarsGiven: starredRepositories(first: 3, orderBy: { field: STARRED_AT, direction: DESC }) {
      edges { starredAt node { nameWithOwner } }
    }
    contributionsCollection(from: $from, to: $to) {
      totalCommitContributions
      totalIssueContributions
      totalPullRequestContributions
      totalPullRequestReviewContributions
      contributionCalendar {
        totalContributions
        weeks {
          contributionDays { contributionCount }
        }
      }
    }
  }
}`;

function runGh(args: string[]): GhResult {
  const proc = Bun.spawnSync(["gh", ...args], { stdout: "pipe", stderr: "pipe" });
  const stdout = new TextDecoder().decode(proc.stdout);
  const stderr = new TextDecoder().decode(proc.stderr);
  if (proc.exitCode !== 0) {
    return { ok: false, stderr: stderr.trim() || `gh exited with ${proc.exitCode}`, status: proc.exitCode };
  }
  return { ok: true, stdout: stdout.trimEnd() };
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function contributionWindow(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - 364 * 24 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}

export function resolveGhLogin(spec: string | null): GhResult & { value?: string } {
  if (spec) return { ok: true, stdout: spec, value: spec };
  const r = runGh(["api", "user", "-q", ".login"]);
  if (!r.ok) {
    return { ok: false, stderr: `${r.stderr}\n(Set a login with --login or run gh auth login.)`, status: r.status };
  }
  return { ok: true, stdout: r.stdout, value: r.stdout };
}

function searchTotal(login: string, q: string): number | null {
  const r = runGh(["api", `/search/${q}`, "-q", ".total_count"]);
  if (!r.ok) return null;
  const n = Number(r.stdout);
  return Number.isFinite(n) ? n : null;
}

function starsReceivedSum(login: string): number | null {
  const r = runGh([
    "api",
    `users/${login}/repos`,
    "--paginate",
    "--jq",
    "[.[] | select(.fork | not) | .stargazers_count] | add // 0",
  ]);
  if (!r.ok) return null;
  const n = Number(r.stdout);
  return Number.isFinite(n) ? n : null;
}

function coarseHeatmapBuckets(weeks: { contributionDays: { contributionCount: number }[] }[]): number[] {
  const weeklySums = weeks.map((w) =>
    w.contributionDays.reduce((sum, d) => sum + d.contributionCount, 0)
  );
  const max = weeklySums.reduce((m, n) => (n > m ? n : m), 0);
  if (max <= 0) return weeklySums.map(() => 0);
  return weeklySums.map((n) => {
    const r = n / max;
    if (r <= 0) return 0;
    if (r < 0.2) return 1;
    if (r < 0.45) return 2;
    if (r < 0.75) return 3;
    return 4;
  });
}

export function collectProfileStats(login: string): ProfileStats {
  const { from, to } = contributionWindow();
  const since = isoDaysAgo(364);
  const gqlRes = runGh([
    "api",
    "graphql",
    "-f",
    `query=${PROFILE_QUERY}`,
    "-f",
    `login=${login}`,
    "-f",
    `from=${from}`,
    "-f",
    `to=${to}`,
  ]);
  if (!gqlRes.ok) {
    throw new Error(gqlRes.stderr);
  }
  let gql: UserGraph;
  try {
    gql = JSON.parse(gqlRes.stdout) as UserGraph;
  } catch {
    throw new Error("Failed to parse GraphQL response.");
  }
  if (gql.errors?.length) {
    throw new Error(gql.errors.map((e) => e.message).join("\n"));
  }
  const u = gql.data?.user;
  if (!u) {
    throw new Error(`User not found: ${login}`);
  }

  const commitsIndexed = searchTotal(
    login,
    `commits?q=${encodeURIComponent(`author:${login} committer-date:>${since}`)}&per_page=1`,
  );
  const prsCreated = searchTotal(
    login,
    `issues?q=${encodeURIComponent(`type:pr author:${login} created:>${since}`)}&per_page=1`,
  );
  const issuesCreated = searchTotal(
    login,
    `issues?q=${encodeURIComponent(`type:issue author:${login} created:>${since}`)}&per_page=1`,
  );
  const prsReviewed = searchTotal(
    login,
    `issues?q=${encodeURIComponent(`type:pr reviewed-by:${login} updated:>${since}`)}&per_page=1`,
  );

  const starsReceived = starsReceivedSum(login);
  const releasesCount = u.reposForReleaseCount.nodes.reduce((sum, repo) => sum + repo.releases.totalCount, 0);

  const contrib = u.contributionsCollection.contributionCalendar.totalContributions;
  const weeklyHeatmapBuckets = coarseHeatmapBuckets(u.contributionsCollection.contributionCalendar.weeks);
  const contribLikelyBlocked =
    contrib === 0 &&
    u.contributionsCollection.totalCommitContributions === 0 &&
    (commitsIndexed ?? 0) > 0;

  return {
    generatedAt: new Date().toISOString(),
    login: u.login,
    name: u.name,
    bio: u.bio,
    url: u.url,
    websiteUrl: u.websiteUrl,
    location: u.location,
    createdAt: u.createdAt,
    counts: {
      followers: u.followers.totalCount,
      following: u.following.totalCount,
      publicNonForkRepos: u.ownedPublicNonForkRepos.totalCount,
      starsGiven: u.starredRepositories.totalCount,
      starsReceivedOnOwnedNonForkRepos: starsReceived,
      releasesOnOwnedNonForkRepos: releasesCount,
    },
    activityWindow: {
      sinceDate: since,
      throughDate: isoDaysAgo(0),
      commitsMatchingSearchIndex: commitsIndexed,
      pullRequestsCreated: prsCreated,
      issuesCreated,
      pullRequestsReviewed: prsReviewed,
    },
    contributionsApi: {
      window: { from, to },
      totalCommitContributions: u.contributionsCollection.totalCommitContributions,
      totalIssueContributions: u.contributionsCollection.totalIssueContributions,
      totalPullRequestContributions: u.contributionsCollection.totalPullRequestContributions,
      totalPullRequestReviewContributions: u.contributionsCollection.totalPullRequestReviewContributions,
      contributionCalendar: u.contributionsCollection.contributionCalendar,
      weeklyHeatmapBuckets,
      note: contribLikelyBlocked
        ? "GraphQL contribution totals are zero but Search shows commits; try a classic PAT with read:user or compare on github.com/profiles."
        : null,
    },
    topPublicReposByStars: u.topStars.nodes.filter((r) => r.stargazerCount > 0),
    recentStarsGiven: u.recentStarsGiven.edges.map((e) => ({
      nameWithOwner: e.node.nameWithOwner,
      starredAt: e.starredAt,
    })),
  };
}
