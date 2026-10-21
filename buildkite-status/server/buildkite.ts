/// <reference types="node" />
import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type {
  accountRpc,
  BuildkiteAnnotation,
  buildActionRpc,
  unblockStepRpc,
  BuildkiteBuild,
  BuildkiteJob,
  logRpc,
  retryStepRpc,
  searchStepsRpc,
  signInRpc,
  statusesRpc,
  statusRpc,
  stepContextRpc,
} from "../shared/buildkite";
import { stripAnsi } from "../shared/ansi";
import { stripEmoji, trimForAgent } from "../shared/log";
import { cleanLog, htmlToText, repoKey, stepContext } from "./parse";

const API = "https://api.buildkite.com/v2/";
const TOKEN_FILE = join(homedir(), ".paseo", "buildkite-status", "token");
const REQUIRED_SCOPES = ["read_builds", "read_build_logs"];
const LOG_LIMIT = 60_000;
const FULL_LOG_LIMIT = 3_000_000;
const LOG_CACHE_MS = 30_000;
const SEARCH_LIMIT = 8;

interface RawJob {
  id: string;
  type: string;
  name?: string | null;
  label?: string | null;
  step_key?: string | null;
  state: string;
  soft_failed?: boolean;
  exit_status?: number | null;
  started_at?: string | null;
  finished_at?: string | null;
  web_url?: string | null;
  log_url?: string | null;
  step?: { id: string } | null;
  parallel_group_index?: number | null;
  parallel_group_total?: number | null;
}

interface RawBuild {
  id: string;
  url: string;
  branch: string;
  number: number;
  state: string;
  message: string | null;
  commit: string;
  web_url: string;
  pull_request?: { id: string } | null;
  pipeline: { id: string; name: string; repository: string };
  jobs?: RawJob[];
}

const run = promisify(execFile);

interface Step {
  branch: string;
  build: BuildkiteBuild;
  job: BuildkiteJob;
}

// Attachment search and step context only receive a query or job ID, so they read the
// builds the panels last fetched. Re-inserting keeps the most recent directory last.
const lastStatus = new Map<string, { branch: string; builds: BuildkiteBuild[] }>();
const logCache = new Map<string, { at: number; text: string }>();

function knownSteps(): Step[] {
  return [...lastStatus.values()]
    .reverse()
    .flatMap(({ branch, builds }) =>
      builds.flatMap((build) => build.jobs.map((job) => ({ branch, build, job }))),
    );
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await run("git", args, { cwd })).stdout.trim();
}

async function readToken(): Promise<string | null> {
  try {
    return (await readFile(TOKEN_FILE, "utf8")).trim() || null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function api(token: string, url: string, method = "GET"): Promise<Response> {
  const response = await fetch(url, { method, headers: { Authorization: `Bearer ${token}` } });
  if (response.status === 401)
    throw new Error(
      "Buildkite rejected the token; it may have expired. Replace it in Settings → Plugins → Buildkite.",
    );
  if (response.status === 403 && method !== "GET")
    throw new Error(
      "Your token can't change builds. Replace it in Settings → Plugins → Buildkite with one that has write_builds.",
    );
  if (!response.ok) {
    const body = await response.text();
    let message = body.slice(0, 200);
    try {
      message = (JSON.parse(body) as { message?: string }).message ?? message;
    } catch {}
    throw new Error(`Buildkite returned ${response.status}: ${message}`);
  }
  return response;
}

const TOKEN_INFO_MS = 10 * 60_000;
let tokenInfo: { token: string; at: number; expiresAt: string | null; canWrite: boolean } | null =
  null;

// Scopes and expiry change rarely; check them every ten minutes, not on every poll.
async function tokenState(token: string) {
  if (tokenInfo?.token !== token || Date.now() - tokenInfo.at > TOKEN_INFO_MS) {
    const info = (await (await api(token, `${API}access-token`)).json()) as {
      scopes: string[];
      expires_at?: string | null;
    };
    tokenInfo = {
      token,
      at: Date.now(),
      expiresAt: info.expires_at ?? null,
      canWrite: info.scopes.includes("write_builds"),
    };
  }
  return { expiresAt: tokenInfo.expiresAt, canWrite: tokenInfo.canWrite };
}

async function requireToken(): Promise<string> {
  const token = await readToken();
  if (!token) throw new Error("Sign in to Buildkite first.");
  return token;
}

function toBuild(raw: RawBuild, annotations: BuildkiteAnnotation[]): BuildkiteBuild {
  return {
    id: raw.id,
    apiUrl: raw.url,
    number: raw.number,
    state: raw.state,
    message: (raw.message ?? "").split("\n")[0],
    commit: raw.commit,
    pipelineName: raw.pipeline.name,
    webUrl: raw.web_url,
    pullRequest: raw.pull_request?.id ?? null,
    annotations,
    jobs: (raw.jobs ?? [])
      .filter((job) => job.type !== "waiter")
      .map((job) => ({
        id: job.id,
        name: stripEmoji(job.name ?? job.label ?? job.step_key ?? job.type) || job.type,
        state: job.state,
        softFailed: job.soft_failed ?? false,
        exitStatus: job.exit_status ?? null,
        startedAt: job.started_at ?? null,
        finishedAt: job.finished_at ?? null,
        webUrl: job.web_url ?? null,
        logUrl: job.type === "script" ? (job.log_url ?? null) : null,
        groupId: job.parallel_group_total ? (job.step?.id ?? job.name ?? null) : null,
        parallelIndex: job.parallel_group_index ?? null,
        parallelTotal: job.parallel_group_total ?? null,
      })),
  };
}

// Builds come newest first; keep the latest per pipeline building this repository.
function latestPerPipeline(raw: RawBuild[], origin: string): RawBuild[] {
  const repo = origin && repoKey(origin);
  const latest = new Map<string, RawBuild>();
  for (const build of raw) {
    if (repo && repoKey(build.pipeline.repository) !== repo) continue;
    if (!latest.has(build.pipeline.id)) latest.set(build.pipeline.id, build);
  }
  return [...latest.values()];
}

async function fetchAnnotations(token: string, buildUrl: string): Promise<BuildkiteAnnotation[]> {
  try {
    const raw = (await (await api(token, `${buildUrl}/annotations`)).json()) as {
      id: string;
      context: string;
      style: string;
      body_html: string;
    }[];
    return raw.map(({ id, context, style, body_html }) => ({
      id,
      context,
      style,
      text: htmlToText(body_html).slice(0, 20_000),
    }));
  } catch (error) {
    // Annotations are extra detail; a failure here should not hide the build.
    console.warn("[buildkite-status] annotations failed:", (error as Error).message);
    return [];
  }
}

export async function getStatuses({
  directories,
}: RpcInput<typeof statusesRpc>): Promise<RpcOutput<typeof statusesRpc>> {
  const token = await readToken();
  if (!token) return { signedIn: false, token: null, results: [] };
  const access = await tokenState(token);
  const checkouts = (
    await Promise.all(
      directories.map(async (directory) => {
        try {
          const [branch, origin] = await Promise.all([
            git(directory, "rev-parse", "--abbrev-ref", "HEAD"),
            git(directory, "remote", "get-url", "origin").catch(() => ""),
          ]);
          return branch === "HEAD" ? null : { directory, branch, origin };
        } catch {
          return null; // Not a git checkout, or it has been removed.
        }
      }),
    )
  ).filter((checkout) => checkout !== null);
  if (checkouts.length === 0) return { signedIn: true, token: access, results: [] };

  const branches = [...new Set(checkouts.map(({ branch }) => branch))];
  const query = branches.map((branch) => `branch[]=${encodeURIComponent(branch)}`).join("&");
  // shortcut: one page of 100 builds across all branches; a very busy branch can crowd out others.
  const raw = (await (
    await api(token, `${API}builds?${query}&per_page=100&exclude_jobs=true`)
  ).json()) as RawBuild[];
  return {
    signedIn: true,
    token: access,
    results: checkouts.map(({ directory, branch, origin }) => ({
      directory,
      builds: latestPerPipeline(
        raw.filter((build) => build.branch === branch),
        origin,
      ).map((build) => ({
        id: build.id,
        number: build.number,
        state: build.state,
        pipelineName: build.pipeline.name,
        webUrl: build.web_url,
      })),
    })),
  };
}

export async function getStatus({
  directory,
}: RpcInput<typeof statusRpc>): Promise<RpcOutput<typeof statusRpc>> {
  const token = await readToken();
  if (!token) return { signedIn: false };

  const [branch, commit, origin] = await Promise.all([
    git(directory, "rev-parse", "--abbrev-ref", "HEAD"),
    git(directory, "rev-parse", "HEAD"),
    git(directory, "remote", "get-url", "origin").catch(() => ""),
  ]);
  // A detached HEAD has no branch to match, so look the build up by commit instead.
  const filter = branch === "HEAD" ? `commit=${commit}` : `branch=${encodeURIComponent(branch)}`;
  const raw = (await (await api(token, `${API}builds?${filter}&per_page=50`)).json()) as RawBuild[];

  const builds = await Promise.all(
    latestPerPipeline(raw, origin).map(async (build) =>
      toBuild(build, await fetchAnnotations(token, build.url)),
    ),
  );
  lastStatus.delete(directory);
  lastStatus.set(directory, { branch, builds });
  return { signedIn: true, branch, commit, builds, token: await tokenState(token) };
}

async function fetchLog(url: string): Promise<string> {
  // The URL comes from the client; never send the token anywhere but the Buildkite API.
  if (!url.startsWith(API)) throw new Error(`Not a Buildkite API log URL: ${url}`);
  const cached = logCache.get(url);
  if (cached && Date.now() - cached.at < LOG_CACHE_MS) return cached.text;
  const token = await requireToken();
  const { content } = (await (await api(token, url)).json()) as { content: string | null };
  const text = cleanLog(content ?? "");
  logCache.set(url, { at: Date.now(), text });
  return text;
}

export async function getLog({
  url,
  full,
}: RpcInput<typeof logRpc>): Promise<RpcOutput<typeof logRpc>> {
  logCache.delete(url);
  const text = await fetchLog(url);
  const limit = full ? FULL_LOG_LIMIT : LOG_LIMIT;
  if (text.length <= limit) return { text, truncated: false, firstLine: 1 };
  // Start at a line boundary so a cut escape code or half line is not shown.
  const cut = text.indexOf("\n", text.length - limit) + 1;
  const firstLine = text.slice(0, cut).split("\n").length;
  return { text: text.slice(cut), truncated: true, firstLine };
}

async function contextFor(step: Step): Promise<string> {
  return stepContext(step, step.job.logUrl ? stripAnsi(await fetchLog(step.job.logUrl)) : "");
}

// Build and job actions go to URLs built from the build's API URL, which must be Buildkite's.
function buildUrl(build: BuildkiteBuild, path: string): string {
  if (!build.apiUrl.startsWith(API)) throw new Error(`Not a Buildkite API URL: ${build.apiUrl}`);
  return `${build.apiUrl}${path}`;
}

async function retryJob(build: BuildkiteBuild, jobId: string, token: string): Promise<string> {
  const url = buildUrl(build, `/jobs/${jobId}/retry`);
  return ((await (await api(token, url, "PUT")).json()) as { id: string }).id;
}

export async function retryStep({ jobId }: RpcInput<typeof retryStepRpc>) {
  const step = knownSteps().find(({ job }) => job.id === jobId);
  if (!step?.job.logUrl) throw new Error("That step can't be retried from here.");
  return { jobId: await retryJob(step.build, jobId, await requireToken()) };
}

const HARD_FAILURES = new Set(["failed", "timed_out", "expired"]);

export async function buildAction({
  buildId,
  action,
}: RpcInput<typeof buildActionRpc>): Promise<RpcOutput<typeof buildActionRpc>> {
  const build = [...lastStatus.values()]
    .flatMap(({ builds }) => builds)
    .find(({ id }) => id === buildId);
  if (!build) throw new Error("That build is no longer the latest. Refresh and try again.");
  const token = await requireToken();
  const label = `${build.pipelineName} #${build.number}`;
  if (action === "rebuild") {
    const rebuilt = (await (await api(token, buildUrl(build, "/rebuild"), "PUT")).json()) as {
      number: number;
    };
    return { message: `Started ${build.pipelineName} #${rebuilt.number}` };
  }
  if (action === "cancel") {
    await api(token, buildUrl(build, "/cancel"), "PUT");
    return { message: `Canceling ${label}` };
  }
  const failed = build.jobs.filter(
    (job) => job.logUrl && HARD_FAILURES.has(job.state) && !job.softFailed,
  );
  if (failed.length === 0) throw new Error(`${label} has no failed steps to retry.`);
  await Promise.all(failed.map((job) => retryJob(build, job.id, token)));
  return {
    message: `Retrying ${failed.length} failed ${failed.length === 1 ? "step" : "steps"} in ${label}`,
  };
}

export async function unblockStep({ jobId }: RpcInput<typeof unblockStepRpc>) {
  const step = knownSteps().find(({ job }) => job.id === jobId);
  if (!step || step.job.state !== "blocked")
    throw new Error("That step is not waiting to be unblocked.");
  await api(await requireToken(), buildUrl(step.build, `/jobs/${jobId}/unblock`), "PUT");
  return {};
}

export async function getStepContext({ jobId, selection }: RpcInput<typeof stepContextRpc>) {
  const step = knownSteps().find(({ job }) => job.id === jobId);
  if (!step) throw new Error("That step is no longer in the latest build. Refresh and try again.");
  return {
    text: selection
      ? stepContext(step, "", { ...selection, text: trimForAgent(stripAnsi(selection.text)) })
      : await contextFor(step),
  };
}

const URGENCY = ["failed", "timed_out", "expired", "running"];
const urgency = ({ job }: Step) => {
  const index = URGENCY.indexOf(job.state);
  return index === -1 ? URGENCY.length : index + (job.softFailed ? 0.5 : 0);
};

export async function searchSteps({
  query,
}: RpcInput<typeof searchStepsRpc>): Promise<RpcOutput<typeof searchStepsRpc>> {
  const needle = query.trim().toLowerCase();
  const steps = knownSteps()
    .filter(({ job }) => job.logUrl)
    .filter(({ branch, build, job }) =>
      `${job.name} ${build.pipelineName} ${branch}`.toLowerCase().includes(needle),
    )
    .sort((a, b) => urgency(a) - urgency(b))
    .slice(0, SEARCH_LIMIT);
  const items = await Promise.all(
    steps.map(async (step) => ({
      id: step.job.id,
      identifier: `${step.build.pipelineName} #${step.build.number}`,
      title: step.job.name,
      subtitle: `${step.job.softFailed ? "soft failed" : step.job.state.replace(/_/g, " ")} · ${step.branch}`,
      url: step.job.webUrl ?? step.build.webUrl,
      text: await contextFor(step),
      resourceType: "buildkite_step",
    })),
  );
  return { items };
}

export async function signIn({ token }: RpcInput<typeof signInRpc>) {
  const { scopes } = (await (await api(token, `${API}access-token`)).json()) as {
    scopes: string[];
  };
  const missing = REQUIRED_SCOPES.filter((scope) => !scopes.includes(scope));
  if (missing.length) throw new Error(`The token is missing these scopes: ${missing.join(", ")}`);
  tokenInfo = null;
  await mkdir(dirname(TOKEN_FILE), { recursive: true, mode: 0o700 });
  await writeFile(TOKEN_FILE, token, { mode: 0o600 });
  return {};
}

export async function getAccount(): Promise<RpcOutput<typeof accountRpc>> {
  const token = await readToken();
  if (!token) return { signedIn: false };
  const empty = { name: null, email: null, description: null, expiresAt: null, scopes: [] };
  try {
    const info = (await (await api(token, `${API}access-token`)).json()) as {
      scopes: string[];
      description?: string | null;
      expires_at?: string | null;
      user?: { name?: string; email?: string } | null;
    };
    return {
      signedIn: true,
      error: null,
      name: info.user?.name ?? null,
      email: info.user?.email ?? null,
      description: info.description ?? null,
      expiresAt: info.expires_at ?? null,
      scopes: info.scopes,
    };
  } catch (error) {
    return { signedIn: true, error: (error as Error).message, ...empty };
  }
}

export async function signOut() {
  tokenInfo = null;
  await rm(TOKEN_FILE, { force: true });
  return {};
}
