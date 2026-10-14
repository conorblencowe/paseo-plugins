import type { PaseoAgent } from "@getpaseo/client";
import { getPaseoClient } from "@getpaseo/plugin/client";

// The same buckets Paseo uses for the workspace row's own status indicator.
export type AgentBucket = "needs_input" | "failed" | "running" | "attention" | "done";

export interface AgentNode {
  id: string;
  title: string;
  bucket: AgentBucket;
}

const RETRY_MS = 10_000;

interface HostAgents {
  agents: Map<string, PaseoAgent>;
  lifetime: AbortController;
}

// Keeps a live agent list per host and reports every change.
export function createAgentStore(onChange: () => void) {
  const hosts = new Map<string, HostAgents>();
  const failedAt = new Map<string, number>();

  function track(serverId: string): void {
    if (hosts.has(serverId)) return;
    if (Date.now() - (failedAt.get(serverId) ?? 0) < RETRY_MS) return;
    const host: HostAgents = { agents: new Map(), lifetime: new AbortController() };
    hosts.set(serverId, host);
    const fail = (error: unknown) => {
      if (host.lifetime.signal.aborted) return;
      console.warn("[sidebar-agent-tree] Agent list failed for", serverId, error);
      host.lifetime.abort();
      hosts.delete(serverId);
      failedAt.set(serverId, Date.now());
      onChange();
    };
    try {
      void getPaseoClient(serverId)
        .agents.list({ subscribe: {}, signal: host.lifetime.signal })
        .then(({ subscription }) => {
          subscription.subscribe({
            snapshot: ({ entries }) => {
              host.agents = new Map(entries.map(({ agent }) => [agent.id, agent]));
              onChange();
            },
            update: (message) => {
              if (message.type !== "agent_update") return;
              const update = message.payload;
              if (update.kind === "upsert") host.agents.set(update.agent.id, update.agent);
              else host.agents.delete(update.agentId);
              onChange();
            },
            error: fail,
          });
          return undefined;
        })
        .catch(fail);
    } catch (error) {
      fail(error);
    }
  }

  function agentsFor(serverId: string, workspaceId: string): AgentNode[] {
    const host = hosts.get(serverId);
    if (!host) return [];
    return [...host.agents.values()]
      .filter((agent) => agent.workspaceId === workspaceId && isOpen(agent))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((agent) => ({
        id: agent.id,
        title: agent.title?.trim() || agent.provider,
        bucket: bucketOf(agent),
      }));
  }

  function dispose(): void {
    for (const host of hosts.values()) host.lifetime.abort();
    hosts.clear();
  }

  return { track, agentsFor, dispose };
}

function isOpen(agent: PaseoAgent): boolean {
  return agent.status !== "closed" && !agent.archivedAt;
}

// Mirrors deriveAgentStateBucket in @getpaseo/protocol, which the client bundle can't import.
function bucketOf(agent: PaseoAgent): AgentBucket {
  if (agent.pendingPermissions.length > 0 || agent.attentionReason === "permission") {
    return "needs_input";
  }
  if (agent.status === "error" || agent.attentionReason === "error") return "failed";
  if (agent.status === "running") return "running";
  if (agent.requiresAttention) return "attention";
  return "done";
}
