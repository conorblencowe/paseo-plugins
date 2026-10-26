import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, Modal, useToast } from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  type PressableStateCallbackType,
  Text,
  View,
} from "react-native";
import {
  buildActionRpc,
  type BuildkiteJob,
  retryStepRpc,
  statusRpc,
  unblockStepRpc,
} from "../shared/buildkite";

// Mirrors Paseo's own tokens (packages/app/src/styles/theme.ts) so the panels sit flush
// with the built-in pull request pane; the plugin theme only exposes colors.
export const SPACE = { 0.5: 2, 1: 4, 2: 8, 3: 12, 4: 16, 6: 24 } as const;
export const TOKEN_URL =
  "https://buildkite.com/user/api-access-tokens/new?description=Paseo&scopes[]=read_builds&scopes[]=read_build_logs&scopes[]=write_builds";
export const FONT = { sm: 12, base: 14 } as const;
export const TOOLBAR_HEIGHT = 36;
export const ROW_HEIGHT = 32;
export const MONO = Platform.select({
  ios: "ui-monospace",
  web: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  default: "monospace",
});

const ACTIVE = new Set([
  "creating",
  "scheduled",
  "assigned",
  "accepted",
  "running",
  "canceling",
  "waiting",
  "limited",
  "limiting",
]);

export const isActive = (state: string) => ACTIVE.has(state) || state === "failing";

export type Presentation = "success" | "failure" | "warning" | "pending" | "manual" | "ignored";

export function present(state: string, softFailed = false): Presentation {
  if (state === "passed" || state === "unblocked") return "success";
  if (state === "failed" || state === "timed_out" || state === "expired" || state === "failing")
    return softFailed ? "warning" : "failure";
  if (ACTIVE.has(state)) return "pending";
  if (state === "blocked") return "manual";
  return "ignored";
}

const SEVERITY: Presentation[] = ["failure", "warning", "pending", "manual", "success", "ignored"];

export const worst = (presentations: Presentation[]): Presentation =>
  SEVERITY.find((p) => presentations.includes(p)) ?? "ignored";

const ICONS: Record<Presentation, string> = {
  success: "CircleCheck",
  failure: "CircleX",
  warning: "CircleX",
  pending: "CircleDot",
  manual: "CirclePause",
  ignored: "CircleSlash",
};

export function toneColor(theme: PluginTheme, presentation: Presentation): string {
  const c = theme.colors;
  if (presentation === "success") return c.statusSuccess;
  if (presentation === "failure") return c.statusDanger;
  if (presentation === "warning" || presentation === "pending") return c.statusWarning;
  return c.foregroundMuted;
}

export function StatusIcon({
  theme,
  presentation,
  size = 14,
}: {
  theme: PluginTheme;
  presentation: Presentation;
  size?: number;
}) {
  return <Icon name={ICONS[presentation]} size={size} color={toneColor(theme, presentation)} />;
}

export const stateLabel = (state: string) => state.replace(/_/g, " ");

export function duration(job: BuildkiteJob): string {
  if (!job.startedAt) return "";
  const end = job.finishedAt ? Date.parse(job.finishedAt) : Date.now();
  const seconds = Math.max(0, Math.round((end - Date.parse(job.startedAt)) / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

// React Native Web passes `hovered`; native platforms omit it.
export const isHovered = (state: PressableStateCallbackType) =>
  Boolean((state as { hovered?: boolean }).hovered);

// Paseo's own tooltip is not exposed to plugins; this copies its look and behavior:
// desktop only, 300ms delay, a small rounded popover. RN-web Views are stacking contexts,
// so callers pick a side that stays inside their own row or toolbar.
export function Tooltip({
  theme,
  label,
  side,
  children,
}: {
  theme: PluginTheme;
  label: string;
  side: "below" | "left";
  children: (hover: { onHoverIn(): void; onHoverOut(): void }) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const hover = {
    onHoverIn() {
      if (Platform.OS === "web") timer.current = setTimeout(() => setOpen(true), 300);
    },
    onHoverOut() {
      clearTimeout(timer.current);
      setOpen(false);
    },
  };
  return (
    <View>
      {children(hover)}
      {open && (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            zIndex: 1000,
            width: 320,
            alignItems: "flex-end",
            ...(side === "below"
              ? { top: "100%", right: 0, marginTop: SPACE[2] }
              : {
                  top: 0,
                  bottom: 0,
                  right: "100%",
                  marginRight: SPACE[2],
                  justifyContent: "center",
                }),
          }}
        >
          <View
            style={{
              paddingVertical: SPACE[1],
              paddingHorizontal: SPACE[2],
              borderRadius: 12,
              borderWidth: 1,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.surface2,
              shadowColor: "#000",
              shadowOpacity: 0.15,
              shadowRadius: 8,
              shadowOffset: { width: 0, height: 2 },
            }}
          >
            <Text style={{ fontSize: FONT.sm, color: theme.colors.foreground }}>{label}</Text>
          </View>
        </View>
      )}
    </View>
  );
}

export function ToolbarButton({
  theme,
  icon,
  label,
  onPress,
  disabled,
  active,
  tooltipSide = "below",
}: {
  theme: PluginTheme;
  icon: string;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  active?: boolean;
  tooltipSide?: "below" | "left";
}) {
  return (
    <Tooltip theme={theme} label={label} side={tooltipSide}>
      {(hover) => (
        <Pressable
          {...hover}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={{ selected: active, disabled }}
          hitSlop={8}
          disabled={disabled}
          onPress={(event) => {
            event.stopPropagation();
            hover.onHoverOut();
            onPress();
          }}
          style={(state) => ({
            width: 24,
            height: 24,
            borderRadius: 4,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor:
              active || isHovered(state) || state.pressed ? theme.colors.surface2 : undefined,
            opacity: disabled ? 0.5 : 1,
          })}
        >
          <Icon
            name={icon}
            size={14}
            color={active ? theme.colors.foreground : theme.colors.foregroundMuted}
          />
        </Pressable>
      )}
    </Tooltip>
  );
}

// Matches the ghost "xs" buttons in Paseo's pull request pane, such as "Add to chat".
export function GhostButton({
  theme,
  icon,
  label,
  busy,
  onPress,
}: {
  theme: PluginTheme;
  icon: string;
  label: string;
  busy?: boolean;
  onPress: () => void;
}) {
  const muted = theme.colors.foregroundMuted;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={busy}
      onPress={onPress}
      style={(state) => ({
        height: 24,
        flexDirection: "row",
        alignItems: "center",
        gap: SPACE[1],
        paddingHorizontal: SPACE[1],
        borderRadius: 4,
        backgroundColor: isHovered(state) || state.pressed ? theme.colors.surface2 : undefined,
      })}
    >
      {busy ? (
        <ActivityIndicator size="small" color={muted} />
      ) : (
        <Icon name={icon} size={14} color={muted} />
      )}
      <Text style={{ fontSize: FONT.sm, color: muted }}>{label}</Text>
    </Pressable>
  );
}

export function PrimaryButton({
  theme,
  icon,
  label,
  busy,
  onPress,
}: {
  theme: PluginTheme;
  icon: string;
  label: string;
  busy?: boolean;
  onPress: () => void;
}) {
  const color = theme.colors.accentForeground;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={busy}
      onPress={onPress}
      style={(state) => ({
        height: 28,
        flexDirection: "row",
        alignItems: "center",
        gap: SPACE[1],
        paddingHorizontal: SPACE[3],
        borderRadius: 6,
        backgroundColor: theme.colors.accent,
        opacity: busy ? 0.6 : isHovered(state) ? 0.9 : 1,
      })}
    >
      {busy ? (
        <ActivityIndicator size="small" color={color} />
      ) : (
        <Icon name={icon} size={14} color={color} />
      )}
      <Text style={{ fontSize: FONT.sm, fontWeight: "500", color }}>{label}</Text>
    </Pressable>
  );
}

// For actions that change a build other people may rely on: canceling and unblocking.
export function ConfirmModal({
  theme,
  open,
  title,
  body,
  confirmLabel,
  confirmIcon,
  onConfirm,
  onClose,
}: {
  theme: PluginTheme;
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  confirmIcon: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      title={title}
      icon={<Icon name="TriangleAlert" size={18} color={theme.colors.statusWarning} />}
      open={open}
      onOpenChange={(next) => !next && onClose()}
    >
      <Modal.Content>
        <Text style={{ fontSize: FONT.base, lineHeight: 20, color: theme.colors.foreground }}>
          {body}
        </Text>
        <View
          style={{
            flexDirection: "row",
            justifyContent: "flex-end",
            gap: SPACE[2],
            marginTop: SPACE[3],
          }}
        >
          <GhostButton theme={theme} icon="X" label="Cancel" onPress={onClose} />
          <PrimaryButton
            theme={theme}
            icon={confirmIcon}
            label={confirmLabel}
            onPress={() => {
              onClose();
              onConfirm();
            }}
          />
        </View>
      </Modal.Content>
    </Modal>
  );
}

function useStatusMutation<Input>(run: (input: Input) => Promise<string>) {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: run,
    onSuccess: (message) => {
      toast.show(message, { variant: "success" });
      return queryClient.invalidateQueries({ queryKey: ["buildkite-status"] });
    },
    onError: (error) => toast.error(error.message),
  });
}

// Write actions stay visible so they can be found; a read-only token explains itself on press.
export function useWriteGuard(canWrite: boolean) {
  const toast = useToast();
  return (run: () => void) =>
    canWrite
      ? run()
      : toast.error(
          "This needs a token with the write_builds scope. Replace it in Settings → Plugins → Buildkite.",
        );
}

export function useBuildAction() {
  const run = useRpc(buildActionRpc);
  return useStatusMutation(
    async (input: { buildId: string; action: "rebuild" | "cancel" | "retry-failed" }) =>
      (await run(input)).message,
  );
}

export function useUnblockStep() {
  const unblock = useRpc(unblockStepRpc);
  return useStatusMutation(async (job: BuildkiteJob) => {
    await unblock({ jobId: job.id });
    return `Unblocked ${job.name}`;
  });
}

export const RETRYABLE = new Set(["failed", "timed_out", "canceled", "expired", "passed"]);

// Retrying creates a new job; follow it in the log tab if the old one was showing.
export function useRetryStep(workspaceId: string) {
  const retry = useRpc(retryStepRpc);
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (step: SelectedStep) => retry({ jobId: step.job.id }),
    onSuccess: ({ jobId }, step) => {
      const old = step.job.id;
      if (selected.get(workspaceId)?.job.id === old) {
        const swap = (url: string | null) => url && url.replace(old, jobId);
        selectStep(workspaceId, {
          ...step,
          job: {
            ...step.job,
            id: jobId,
            state: "scheduled",
            exitStatus: null,
            startedAt: null,
            finishedAt: null,
            webUrl: swap(step.job.webUrl),
            logUrl: swap(step.job.logUrl),
          },
        });
      }
      toast.show(`Retrying ${step.job.name}`, { variant: "success" });
      return queryClient.invalidateQueries({ queryKey: ["buildkite-status"] });
    },
    onError: (error) => toast.error(error.message),
  });
}

export function useBuildkiteStatus(directory: string | null | undefined) {
  const getStatus = useRpc(statusRpc);
  return useQuery({
    queryKey: ["buildkite-status", directory],
    queryFn: () => getStatus({ directory: directory! }),
    enabled: !!directory,
    refetchInterval: ({ state }) =>
      state.data?.signedIn && state.data.builds.some((build) => isActive(build.state))
        ? 10_000
        : 60_000,
  });
}

// The step tab has no params, so the explorer records which step it should show.
export interface SelectedStep {
  job: BuildkiteJob;
  buildLabel: string;
}

const selected = new Map<string, SelectedStep>();
const listeners = new Set<() => void>();

export function selectStep(workspaceId: string, step: SelectedStep) {
  selected.set(workspaceId, step);
  listeners.forEach((listener) => listener());
}

export function useSelectedStep(workspaceId: string): SelectedStep | undefined {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => selected.get(workspaceId),
  );
}
