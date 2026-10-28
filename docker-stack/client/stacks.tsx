import type { PluginTheme } from "@getpaseo/plugin";
import { type PluginScreenProps, type PluginSidebarItemProps, useRpc } from "@getpaseo/plugin/client";
import { Icon, SidebarRow } from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { type DockerStackSummary, stacksRpc } from "../shared/docker";
import { ConfirmDownModal, useDownStack } from "./down";

const FONT = { sm: 12, base: 14 } as const;

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
  return `${Math.round(bytes / 1024 ** 2)} MiB`;
}

const basename = (directory: string) => directory.split("/").filter(Boolean).pop() ?? directory;

function makeStyles(theme: PluginTheme, compact: boolean) {
  const c = theme.colors;
  return {
    root: { flex: 1, minHeight: 0, backgroundColor: c.surface0 },
    summary: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 8,
      paddingHorizontal: compact ? 16 : 24,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    summaryText: { flex: 1, fontSize: FONT.sm, color: c.foregroundMuted },
    iconButton: { width: 24, alignItems: "center" as const },
    list: { paddingVertical: 8 },
    row: { gap: 2, paddingHorizontal: compact ? 16 : 24, paddingVertical: 8 },
    line: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
    dot: { width: 8, height: 8, borderRadius: 4 },
    title: { flex: 1, fontSize: FONT.base, color: c.foreground },
    meta: { paddingLeft: 16, fontSize: FONT.sm, color: c.foregroundMuted },
    empty: { padding: compact ? 16 : 24, fontSize: FONT.sm, color: c.foregroundMuted },
    danger: { color: c.statusDanger },
  };
}

export function StacksScreen({ theme, layout }: PluginScreenProps) {
  const styles = useMemo(() => makeStyles(theme, layout.compact), [theme, layout.compact]);
  const getStacks = useRpc(stacksRpc);
  const query = useQuery({
    queryKey: ["docker-stacks"],
    queryFn: () => getStacks({}),
    refetchInterval: 15_000,
  });
  const [confirming, setConfirming] = useState<DockerStackSummary | null>(null);
  const down = useDownStack(() => void query.refetch());
  const stacks = query.data?.stacks;
  const live = stacks?.filter((stack) => stack.running > 0) ?? [];
  const muted = theme.colors.foregroundMuted;

  return (
    <View style={styles.root}>
      <View style={styles.summary}>
        <Text style={styles.summaryText} numberOfLines={1}>
          {stacks
            ? `${live.length} of ${stacks.length} stacks running · ` +
              `${formatBytes(live.reduce((sum, stack) => sum + stack.memoryBytes, 0))} · ` +
              `${live.reduce((sum, stack) => sum + stack.cpuPercent, 0).toFixed(1)}% CPU`
            : "Docker stacks"}
        </Text>
        <View style={styles.iconButton}>
          {query.isFetching ? (
            <ActivityIndicator size="small" color={muted} />
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Refresh Docker stacks"
              onPress={() => query.refetch()}
            >
              <Icon name="RotateCw" size={14} color={muted} />
            </Pressable>
          )}
        </View>
      </View>
      <ScrollView style={styles.root} contentContainerStyle={styles.list}>
        {query.error ? (
          <Text style={[styles.empty, styles.danger]}>{query.error.message}</Text>
        ) : !stacks ? (
          <Text style={styles.empty}>Loading stacks…</Text>
        ) : stacks.length === 0 ? (
          <Text style={styles.empty}>No Docker Compose stacks on this host.</Text>
        ) : (
          stacks.map((stack) => (
            <View key={`${stack.project}:${stack.directory}`} style={styles.row}>
              <View style={styles.line}>
                <View
                  style={[
                    styles.dot,
                    { backgroundColor: stack.running > 0 ? theme.colors.statusSuccess : muted },
                  ]}
                />
                <Text style={styles.title} numberOfLines={1}>
                  {stack.workspaceTitle ?? basename(stack.directory)}
                </Text>
                <View style={styles.iconButton}>
                  {down.isPending && down.variables === stack.directory ? (
                    <ActivityIndicator size="small" color={muted} />
                  ) : (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Down ${stack.project}`}
                      onPress={() => setConfirming(stack)}
                    >
                      <Icon name="Square" size={14} color={muted} />
                    </Pressable>
                  )}
                </View>
              </View>
              <Text style={styles.meta} numberOfLines={1}>
                {[
                  stack.project,
                  `${stack.running}/${stack.total} running`,
                  ...(stack.running > 0
                    ? [formatBytes(stack.memoryBytes), `${stack.cpuPercent.toFixed(1)}% CPU`]
                    : []),
                ].join(" · ")}
              </Text>
            </View>
          ))
        )}
      </ScrollView>
      <ConfirmDownModal
        theme={theme}
        project={confirming?.project ?? null}
        onConfirm={() => confirming && down.mutate(confirming.directory)}
        onClose={() => setConfirming(null)}
      />
    </View>
  );
}

export function StacksSidebarItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  return (
    <SidebarRow
      icon="Container"
      active={currentScreen?.screenId === "stacks"}
      onPress={() => openScreen({ screenId: "stacks" })}
    />
  );
}
