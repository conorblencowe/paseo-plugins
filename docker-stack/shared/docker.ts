import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

const container = z.object({
  id: z.string(),
  name: z.string(),
  service: z.string(),
  project: z.string(),
  // Docker's state, e.g. running, exited, restarting.
  state: z.string(),
  // Human status, e.g. "Up 2 hours (healthy)" or "Exited (0) 5 days ago".
  status: z.string(),
  hostPorts: z.array(z.string()),
});

export type DockerContainer = z.infer<typeof container>;

export const stackRpc = defineRpc({
  name: "docker.stack",
  input: z.object({ directory: z.string() }),
  output: z.object({ containers: z.array(container) }),
});

// Stops and removes the workspace's Compose containers and networks; volumes are kept.
export const downRpc = defineRpc({
  name: "docker.down",
  input: z.object({ directory: z.string() }),
  output: z.object({}),
});

// Workspaces on this daemon with at least one running Compose container.
export const runningRpc = defineRpc({
  name: "docker.running",
  input: z.object({}),
  output: z.object({ workspaces: z.array(z.object({ workspaceId: z.string(), running: z.number() })) }),
});

const stackSummary = z.object({
  project: z.string(),
  directory: z.string(),
  // The Paseo workspace whose directory matches, if any.
  workspaceId: z.string().nullable(),
  workspaceTitle: z.string().nullable(),
  running: z.number(),
  total: z.number(),
  cpuPercent: z.number(),
  memoryBytes: z.number(),
});

export type DockerStackSummary = z.infer<typeof stackSummary>;

// Every Compose stack on the daemon's Docker host, with CPU and memory summed over its containers.
export const stacksRpc = defineRpc({
  name: "docker.stacks",
  input: z.object({}),
  output: z.object({ stacks: z.array(stackSummary) }),
});
