import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { downRpc, runningRpc, stackRpc, stacksRpc } from "../shared/docker";

const run = promisify(execFile);

const WORKING_DIR = "com.docker.compose.project.working_dir";

const FORMAT = [
  "{{.ID}}",
  "{{.Names}}",
  '{{.Label "com.docker.compose.service"}}',
  '{{.Label "com.docker.compose.project"}}',
  "{{.State}}",
  "{{.Status}}",
  "{{.Ports}}",
].join("\t");

async function docker(...args: string[]): Promise<string> {
  const { stdout } = await run("docker", args, {
    // Run outside any workspace so `compose` doesn't load (and validate) a compose file.
    cwd: "/",
    // The daemon may not inherit a login shell PATH, so include the usual Docker install locations.
    env: { ...process.env, PATH: `${process.env.PATH}:/usr/local/bin:/opt/homebrew/bin` },
  }).catch((error: { stderr?: string; code?: string; message: string }) => {
    if (error.code === "ENOENT") throw new Error("docker CLI not found on the daemon's PATH.");
    throw new Error(error.stderr?.trim() || error.message);
  });
  return stdout;
}

const lines = (stdout: string) => stdout.split("\n").filter(Boolean);

// "0.0.0.0:5432->5432/tcp, [::]:5432->5432/tcp" -> ["5432"]
export function hostPorts(ports: string): string[] {
  return [...new Set([...ports.matchAll(/:(\d+)->/g)].map((match) => match[1]))];
}

// shortcut: exact match on Compose's working_dir label, so stacks started from a subdirectory or with
// plain `docker run` are not shown; switch to listing all containers and prefix-matching if that matters.
export async function getStack({
  directory,
}: RpcInput<typeof stackRpc>): Promise<RpcOutput<typeof stackRpc>> {
  const stdout = await docker("ps", "--all", "--filter", `label=${WORKING_DIR}=${directory}`, "--format", FORMAT);
  const containers = lines(stdout)
    .map((line) => {
      const [id, name, service, project, state, status, ports] = line.split("\t");
      return { id, name, service: service || name, project, state, status, hostPorts: hostPorts(ports) };
    })
    .sort((a, b) => a.service.localeCompare(b.service));
  return { containers };
}

export async function downStack({ directory }: RpcInput<typeof downRpc>): Promise<RpcOutput<typeof downRpc>> {
  const stdout = await docker(
    "ps",
    "--all",
    "--filter",
    `label=${WORKING_DIR}=${directory}`,
    "--format",
    '{{.Label "com.docker.compose.project"}}',
  );
  // `compose -p` finds the project's containers and networks by label, without its compose file.
  for (const project of new Set(lines(stdout))) await docker("compose", "-p", project, "down");
  return {};
}

export async function getRunning(
  _input: RpcInput<typeof runningRpc>,
  { paseo }: PluginHandlerContext,
): Promise<RpcOutput<typeof runningRpc>> {
  const stdout = await docker("ps", "--filter", `label=${WORKING_DIR}`, "--format", `{{.Label "${WORKING_DIR}"}}`);
  const counts = new Map<string, number>();
  for (const directory of lines(stdout)) counts.set(directory, (counts.get(directory) ?? 0) + 1);
  if (counts.size === 0) return { workspaces: [] };

  const workspaces: RpcOutput<typeof runningRpc>["workspaces"] = [];
  for (const [directory, { id }] of await workspacesByDirectory(paseo)) {
    const running = counts.get(directory);
    if (running) workspaces.push({ workspaceId: id, running });
  }
  return { workspaces };
}

async function workspacesByDirectory(
  paseo: PluginHandlerContext["paseo"],
): Promise<Map<string, { id: string; title: string }>> {
  const byDirectory = new Map<string, { id: string; title: string }>();
  let cursor: string | undefined;
  do {
    const page = await paseo.workspaces.list({ page: { limit: 200, cursor } });
    for (const workspace of page.entries) {
      byDirectory.set(workspace.workspaceDirectory ?? workspace.projectRootPath, {
        id: workspace.id,
        title: workspace.title || workspace.name,
      });
    }
    cursor = page.pageInfo.hasMore ? (page.pageInfo.nextCursor ?? undefined) : undefined;
  } while (cursor);
  return byDirectory;
}

const UNITS: Record<string, number> = {
  B: 1, KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3, TiB: 1024 ** 4,
  kB: 1e3, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12,
};

// "784.8MiB / 24.4GiB" -> bytes used
export function memoryBytes(usage: string): number {
  const match = /^([\d.]+)\s*([A-Za-z]+)/.exec(usage.trim());
  return match ? Number(match[1]) * (UNITS[match[2]] ?? 0) : 0;
}

export async function getStacks(
  _input: RpcInput<typeof stacksRpc>,
  { paseo }: PluginHandlerContext,
): Promise<RpcOutput<typeof stacksRpc>> {
  // `docker stats --no-stream` takes a few seconds, so run it alongside the rest.
  const [ps, stats, workspaces] = await Promise.all([
    docker(
      "ps",
      "--all",
      "--filter",
      "label=com.docker.compose.project",
      "--format",
      `{{.ID}}\t{{.Label "com.docker.compose.project"}}\t{{.Label "${WORKING_DIR}"}}\t{{.State}}`,
    ),
    docker("stats", "--no-stream", "--format", "{{.ID}}\t{{.CPUPerc}}\t{{.MemUsage}}"),
    workspacesByDirectory(paseo),
  ]);
  const usage = new Map(
    lines(stats).map((line) => {
      const [id, cpu, memory] = line.split("\t");
      return [id, { cpu: Number.parseFloat(cpu) || 0, memory: memoryBytes(memory) }];
    }),
  );
  const stacks = new Map<string, RpcOutput<typeof stacksRpc>["stacks"][number]>();
  for (const line of lines(ps)) {
    const [id, project, directory, state] = line.split("\t");
    const key = `${project}\t${directory}`;
    let stack = stacks.get(key);
    if (!stack) {
      const workspace = workspaces.get(directory);
      stack = {
        project,
        directory,
        workspaceId: workspace?.id ?? null,
        workspaceTitle: workspace?.title ?? null,
        running: 0,
        total: 0,
        cpuPercent: 0,
        memoryBytes: 0,
      };
      stacks.set(key, stack);
    }
    stack.total += 1;
    if (state === "running") stack.running += 1;
    stack.cpuPercent += usage.get(id)?.cpu ?? 0;
    stack.memoryBytes += usage.get(id)?.memory ?? 0;
  }
  return {
    stacks: [...stacks.values()].sort(
      (a, b) => b.running - a.running || b.memoryBytes - a.memoryBytes || a.project.localeCompare(b.project),
    ),
  };
}
