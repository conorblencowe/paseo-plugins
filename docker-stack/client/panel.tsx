import type { PluginTheme } from "@getpaseo/plugin";
import { type PluginWorkspacePanelProps, useRpc, useWorkspace } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { type DockerContainer, stackRpc } from "../shared/docker";
import { ConfirmDownModal, useDownStack } from "./down";

const FONT = { sm: 12, base: 14 } as const;

function tone(theme: PluginTheme, { state, status }: DockerContainer): string {
  const c = theme.colors;
  if (status.includes("(unhealthy)")) return c.statusDanger;
  if (status.includes("(health: starting)")) return c.statusWarning;
  if (state === "running") return c.statusSuccess;
  // `docker compose stop` exits with SIGTERM (143) or SIGKILL (137); treat those as stopped, not failed.
  if (state === "exited" && /^Exited \((0|137|143)\)/.test(status)) return c.foregroundMuted;
  if (state === "exited" || state === "dead") return c.statusDanger;
  return c.statusWarning;
}

function makeStyles(theme: PluginTheme) {
  const c = theme.colors;
  return {
    root: { flex: 1, minHeight: 0 },
    toolbar: {
      height: 36,
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 4,
      paddingHorizontal: 12,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    toolbarText: { flex: 1, minWidth: 0, fontSize: FONT.sm, color: c.foregroundMuted },
    refresh: { width: 24, alignItems: "center" as const },
    row: { gap: 2, paddingHorizontal: 12, paddingVertical: 6 },
    line: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
    dot: { width: 8, height: 8, borderRadius: 4 },
    name: { fontSize: FONT.base, color: c.foreground, flexShrink: 1 },
    status: { marginLeft: "auto" as const, fontSize: FONT.sm, color: c.foregroundMuted },
    ports: { paddingLeft: 16, fontSize: FONT.sm, color: c.foregroundMuted },
    empty: { padding: 12, fontSize: FONT.sm, color: c.foregroundMuted },
    danger: { color: c.statusDanger },
  };
}

export function StackPanel({ theme, workspaceId }: PluginWorkspacePanelProps) {
  const directory = useWorkspace(workspaceId, (workspace) => workspace.directory);
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const getStack = useRpc(stackRpc);
  const stack = useQuery({
    queryKey: ["docker-stack", directory],
    queryFn: () => getStack({ directory: directory! }),
    enabled: !!directory,
    refetchInterval: 10_000,
  });
  const containers = stack.data?.containers;
  const [confirming, setConfirming] = useState(false);
  const down = useDownStack(() => void stack.refetch());
  const running = containers?.filter((container) => container.state === "running").length ?? 0;

  return (
    <View style={styles.root}>
      <View style={styles.toolbar}>
        <Icon name="Container" size={14} color={theme.colors.foregroundMuted} />
        <Text style={styles.toolbarText} numberOfLines={1}>
          {containers?.length
            ? `${containers[0].project} · ${running}/${containers.length} running`
            : "Docker"}
        </Text>
        {containers?.length ? (
          <View style={styles.refresh}>
            {down.isPending ? (
              <ActivityIndicator size="small" color={theme.colors.foregroundMuted} />
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Down Docker stack"
                onPress={() => setConfirming(true)}
              >
                <Icon name="Square" size={14} color={theme.colors.foregroundMuted} />
              </Pressable>
            )}
          </View>
        ) : null}
        <View style={styles.refresh}>
          {stack.isFetching ? (
            <ActivityIndicator size="small" color={theme.colors.foregroundMuted} />
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Refresh Docker stack"
              onPress={() => stack.refetch()}
            >
              <Icon name="RotateCw" size={14} color={theme.colors.foregroundMuted} />
            </Pressable>
          )}
        </View>
      </View>
      <ScrollView style={styles.root}>
        {stack.error ? (
          <Text style={[styles.empty, styles.danger]}>{stack.error.message}</Text>
        ) : !containers ? (
          <Text style={styles.empty}>Loading containers…</Text>
        ) : containers.length === 0 ? (
          <Text style={styles.empty}>No Docker Compose containers for this workspace.</Text>
        ) : (
          containers.map((container) => (
            <View key={container.id} style={styles.row}>
              <View style={styles.line}>
                <View style={[styles.dot, { backgroundColor: tone(theme, container) }]} />
                <Text style={styles.name} numberOfLines={1}>
                  {container.service}
                </Text>
                <Text style={styles.status} numberOfLines={1}>
                  {container.status}
                </Text>
              </View>
              {container.hostPorts.length > 0 && (
                <Text style={styles.ports} numberOfLines={1}>
                  {container.hostPorts.map((port) => `:${port}`).join("  ")}
                </Text>
              )}
            </View>
          ))
        )}
      </ScrollView>
      <ConfirmDownModal
        theme={theme}
        project={confirming ? (containers?.[0]?.project ?? "this stack") : null}
        onConfirm={() => down.mutate(directory!)}
        onClose={() => setConfirming(false)}
      />
    </View>
  );
}
