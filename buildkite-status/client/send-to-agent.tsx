import type { PluginTheme } from "@getpaseo/plugin";
import { type PluginWorkspacePanelProps, usePaseo, useRpc } from "@getpaseo/plugin/client";
import { Icon, Modal, useToast } from "@getpaseo/plugin/client/react-native";
import { type ReactNode, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { type BuildkiteJob, stepContextRpc } from "../shared/buildkite";
import { FONT, GhostButton, isHovered, present, ROW_HEIGHT, SPACE } from "./ui";

interface AgentChoice {
  id: string;
  title: string;
  status: string;
}

type Navigation = PluginWorkspacePanelProps["navigation"];

// Picks an agent in the workspace (asking when there are several), then sends it a message.
// `picker` must be rendered by the caller for the choice to appear.
export function useAgentSender({
  theme,
  workspaceId,
  navigation,
}: {
  theme: PluginTheme;
  workspaceId: string;
  navigation: Navigation;
}): {
  busy: boolean;
  start(compose: () => Promise<string>, onSent?: () => void): void;
  picker: ReactNode;
} {
  const paseo = usePaseo();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [choices, setChoices] = useState<AgentChoice[] | null>(null);
  const pending = useRef<{ compose: () => Promise<string>; onSent?: () => void } | null>(null);
  const muted = theme.colors.foregroundMuted;

  async function send(agentId: string) {
    setChoices(null);
    setBusy(true);
    try {
      await paseo.agents.ref(agentId).send(await pending.current!.compose());
      pending.current?.onSent?.();
      navigation?.openAgent({ agentId });
      toast.show("Sent to the agent", { variant: "success" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function start(compose: () => Promise<string>, onSent?: () => void) {
    pending.current = { compose, onSent };
    setBusy(true);
    try {
      const { entries } = await paseo.agents.list({
        filter: { statuses: ["idle", "running", "initializing", "error"] },
        sort: [{ key: "updated_at", direction: "desc" }],
      });
      const agents = entries
        .map(({ agent }) => agent)
        .filter((agent) => agent.workspaceId === workspaceId)
        .map((agent) => ({
          id: agent.id,
          title: agent.title?.trim() || agent.provider,
          status: agent.status,
        }));
      if (agents.length === 0) toast.error("Start an agent in this workspace first.");
      else if (agents.length === 1) return void (await send(agents[0].id));
      else setChoices(agents);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
    setBusy(false);
  }

  const picker = (
    <Modal
      title="Send to which agent?"
      icon={<Icon name="MessageSquarePlus" size={18} color={theme.colors.foreground} />}
      open={choices !== null}
      onOpenChange={(open) => !open && setChoices(null)}
    >
      <Modal.Content>
        <View>
          {choices?.map((agent) => (
            <Pressable
              key={agent.id}
              accessibilityRole="button"
              onPress={() => void send(agent.id)}
              style={(state) => ({
                minHeight: ROW_HEIGHT,
                flexDirection: "row",
                alignItems: "center",
                gap: SPACE[2],
                paddingHorizontal: SPACE[2],
                borderRadius: 6,
                backgroundColor: isHovered(state) ? theme.colors.surface2 : undefined,
              })}
            >
              <Text
                style={{ flex: 1, fontSize: FONT.base, color: theme.colors.foreground }}
                numberOfLines={1}
              >
                {agent.title}
              </Text>
              <Text style={{ fontSize: FONT.sm, color: muted }}>{agent.status}</Text>
            </Pressable>
          ))}
        </View>
      </Modal.Content>
    </Modal>
  );

  return { busy, start: (compose, onSent) => void start(compose, onSent), picker };
}

export function SendToAgentButton({
  theme,
  workspaceId,
  job,
  navigation,
}: {
  theme: PluginTheme;
  workspaceId: string;
  job: BuildkiteJob;
  navigation: Navigation;
}) {
  const getContext = useRpc(stepContextRpc);
  const sender = useAgentSender({ theme, workspaceId, navigation });
  const compose = async () => {
    const { text } = await getContext({ jobId: job.id });
    const failed = ["failure", "warning"].includes(present(job.state, job.softFailed));
    const ask = failed
      ? "Investigate why this Buildkite step failed and fix it."
      : "Here is the latest output of a Buildkite step for context.";
    return `${ask}\n\n${text}`;
  };
  return (
    <>
      <GhostButton
        theme={theme}
        icon="MessageSquarePlus"
        label="Send to agent"
        busy={sender.busy}
        onPress={() => sender.start(compose)}
      />
      {sender.picker}
    </>
  );
}
