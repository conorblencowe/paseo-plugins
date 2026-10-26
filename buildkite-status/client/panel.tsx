import type { PluginTheme } from "@getpaseo/plugin";
import {
  openExternalUrl,
  type PluginWorkspacePanelProps,
  useRpc,
  useWorkspace,
} from "@getpaseo/plugin/client";
import { ExternalLink, Icon } from "@getpaseo/plugin/client/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  type BuildkiteAnnotation,
  type BuildkiteBuild,
  type BuildkiteJob,
  signInRpc,
} from "../shared/buildkite";
import {
  duration,
  FONT,
  isHovered,
  type Presentation,
  present,
  ROW_HEIGHT,
  type SelectedStep,
  SPACE,
  StatusIcon,
  stateLabel,
  TOOLBAR_HEIGHT,
  ToolbarButton,
  toneColor,
  useBuildkiteStatus,
  useRetryStep,
  useSelectedStep,
  TOKEN_URL,
  worst,
  ConfirmModal,
  GhostButton,
  isActive,
  useBuildAction,
  useUnblockStep,
  useWriteGuard,
} from "./ui";
import { useBuildNotices } from "./header";
import { expiryWarning } from "../shared/token";

const PILL_ORDER: Presentation[] = ["failure", "warning", "pending", "manual", "success"];

type Styles = ReturnType<typeof makeStyles>;

function makeStyles(theme: PluginTheme) {
  const c = theme.colors;
  return {
    root: { flex: 1, minHeight: 0 },
    toolbar: {
      zIndex: 1,
      height: TOOLBAR_HEIGHT,
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACE[1],
      paddingHorizontal: SPACE[3],
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    toolbarText: { flex: 1, minWidth: 0, fontSize: FONT.sm, color: c.foregroundMuted },
    header: { gap: SPACE[2], paddingHorizontal: SPACE[4], paddingVertical: SPACE[4] },
    title: { fontSize: FONT.base, color: c.foreground, lineHeight: 22 },
    muted: { color: c.foregroundMuted },
    metaLine: { flexDirection: "row" as const, alignItems: "center" as const, gap: SPACE[1] },
    metaText: { fontSize: FONT.sm, color: c.foregroundMuted, flexShrink: 1 },
    sectionHeader: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACE[2],
      paddingHorizontal: SPACE[3],
      paddingVertical: SPACE[2],
    },
    sectionTitle: { fontSize: FONT.sm, fontWeight: "500" as const, color: c.foregroundMuted },
    pills: {
      marginLeft: "auto" as const,
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACE[2],
    },
    pill: { flexDirection: "row" as const, alignItems: "center" as const, gap: 3 },
    pillText: { fontSize: FONT.sm },
    row: {
      height: ROW_HEIGHT,
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACE[2],
      paddingHorizontal: SPACE[3],
    },
    rowActive: { backgroundColor: c.surface2 },
    rowHover: { backgroundColor: c.surface1 },
    rowName: { fontSize: FONT.base, color: c.foreground, flexShrink: 1 },
    rowTrailing: { marginLeft: "auto" as const, fontSize: FONT.sm, color: c.foregroundMuted },
    stepList: { paddingBottom: SPACE[3] },
    groupMembers: { paddingLeft: SPACE[4] + 2 },
    rowTrailingIcon: { marginLeft: "auto" as const },
    annotationBody: {
      maxHeight: 280,
      marginHorizontal: SPACE[3],
      marginBottom: SPACE[2],
      borderRadius: 8,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surface1,
    },
    annotationText: { fontSize: FONT.sm, lineHeight: 18, color: c.foreground, padding: SPACE[3] },
    divider: { height: 1, backgroundColor: c.border },
    empty: {
      fontSize: FONT.sm,
      color: c.foregroundMuted,
      paddingHorizontal: SPACE[3],
      paddingVertical: SPACE[2],
    },
    danger: { fontSize: FONT.sm, color: c.statusDanger },
    notice: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACE[2],
      paddingHorizontal: SPACE[3],
      paddingVertical: SPACE[2],
      borderBottomWidth: 1,
      borderBottomColor: c.border,
      backgroundColor: c.surface1,
    },
    noticeText: { flex: 1, fontSize: FONT.sm, color: c.foreground },
    link: { fontSize: FONT.sm, color: c.foregroundMuted, textDecorationLine: "underline" as const },
    actions: {
      flexDirection: "row" as const,
      flexWrap: "wrap" as const,
      gap: SPACE[1],
      paddingHorizontal: SPACE[3],
      marginTop: -SPACE[2],
      paddingBottom: SPACE[2],
    },
    signIn: { gap: SPACE[3], padding: SPACE[4] },
    body: { fontSize: FONT.sm, color: c.foregroundMuted, lineHeight: 18 },
    input: {
      height: ROW_HEIGHT,
      paddingHorizontal: SPACE[2],
      fontSize: FONT.base,
      color: c.foreground,
      backgroundColor: c.surface2,
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: 6,
    },
    button: {
      height: ROW_HEIGHT,
      alignSelf: "flex-start" as const,
      justifyContent: "center" as const,
      paddingHorizontal: SPACE[3],
      borderRadius: 6,
      backgroundColor: c.accent,
    },
    buttonText: { fontSize: FONT.base, fontWeight: "500" as const, color: c.accentForeground },
  };
}

export function BuildsPanel({
  theme,
  workspaceId,
  onOpenStep,
  onOpenSettings,
}: PluginWorkspacePanelProps & {
  onOpenStep(step: SelectedStep): void;
  onOpenSettings(): void;
}) {
  const directory = useWorkspace(workspaceId, (workspace) => workspace.directory);
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const status = useBuildkiteStatus(directory);
  const selected = useSelectedStep(workspaceId);
  const retry = useRetryStep(workspaceId);
  useBuildNotices();

  if (status.data?.signedIn === false) {
    return <SignIn styles={styles} theme={theme} />;
  }

  const data = status.data;
  const canWrite = data?.token.canWrite ?? false;
  const warning = expiryWarning(data?.token.expiresAt);
  return (
    <View style={styles.root}>
      <View style={styles.toolbar}>
        <Icon name="GitBranch" size={14} color={theme.colors.foregroundMuted} />
        <Text style={styles.toolbarText} numberOfLines={1}>
          {data ? (data.branch === "HEAD" ? data.commit.slice(0, 7) : data.branch) : "Buildkite"}
        </Text>
        {status.isFetching ? (
          <View style={{ width: 24, alignItems: "center" }}>
            <ActivityIndicator size="small" color={theme.colors.foregroundMuted} />
          </View>
        ) : (
          <ToolbarButton
            theme={theme}
            icon="RotateCw"
            label="Refresh Buildkite status"
            onPress={() => status.refetch()}
          />
        )}
        <ToolbarButton
          theme={theme}
          icon="Settings"
          label="Buildkite settings"
          onPress={onOpenSettings}
        />
      </View>
      {warning && (
        <View style={styles.notice}>
          <Icon name="TriangleAlert" size={14} color={theme.colors.statusWarning} />
          <Text style={styles.noticeText}>{warning}</Text>
          <Pressable accessibilityRole="button" onPress={onOpenSettings}>
            <Text style={styles.link}>Replace token</Text>
          </Pressable>
        </View>
      )}
      <ScrollView style={styles.root} showsVerticalScrollIndicator={false}>
        {status.error ? (
          <Text style={[styles.empty, styles.danger]}>{status.error.message}</Text>
        ) : !data ? (
          <Text style={styles.empty}>Loading builds…</Text>
        ) : data.builds.length === 0 ? (
          <Text style={styles.empty}>No Buildkite builds for this branch yet.</Text>
        ) : (
          data.builds.map((build, index) => (
            <View key={build.id}>
              {index > 0 && <View style={styles.divider} />}
              <BuildSection
                build={build}
                head={data.commit}
                selectedJobId={selected?.job.id}
                retryingJobId={retry.isPending ? retry.variables?.job.id : undefined}
                canWrite={canWrite}
                styles={styles}
                theme={theme}
                onOpenStep={onOpenStep}
                onRetryStep={(step) => retry.mutate(step)}
              />
            </View>
          ))
        )}
        {data && !canWrite && data.builds.length > 0 && (
          <Pressable accessibilityRole="button" onPress={onOpenSettings}>
            <Text style={styles.empty}>
              Read-only token: add the write_builds scope in Settings to retry, rebuild, cancel and
              unblock.
            </Text>
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}

function SignIn({ styles, theme }: { styles: Styles; theme: PluginTheme }) {
  const signIn = useRpc(signInRpc);
  const queryClient = useQueryClient();
  const [token, setToken] = useState("");
  const mutation = useMutation({
    mutationFn: () => signIn({ token }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["buildkite-status"] }),
  });
  const submit = () => token.trim() && !mutation.isPending && mutation.mutate();
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.signIn}>
      <Text style={styles.title}>Connect Buildkite</Text>
      <Text style={styles.body}>
        Paste an API access token with the read_builds and read_build_logs scopes. Add write_builds
        to retry steps from Paseo. The token is stored on this Paseo host only.
      </Text>
      <ExternalLink href={TOKEN_URL}>Create a token on buildkite.com</ExternalLink>
      <TextInput
        style={styles.input}
        value={token}
        onChangeText={setToken}
        placeholder="bkua_…"
        placeholderTextColor={theme.colors.foregroundMuted}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel="Buildkite API access token"
        onSubmitEditing={submit}
      />
      <Pressable
        accessibilityRole="button"
        disabled={!token.trim() || mutation.isPending}
        onPress={submit}
        style={(state) => [
          styles.button,
          { opacity: !token.trim() || mutation.isPending ? 0.5 : isHovered(state) ? 0.9 : 1 },
        ]}
      >
        <Text style={styles.buttonText}>{mutation.isPending ? "Checking…" : "Sign in"}</Text>
      </Pressable>
      {mutation.error && <Text style={styles.danger}>{mutation.error.message}</Text>}
    </ScrollView>
  );
}

function BuildSection({
  build,
  head,
  selectedJobId,
  retryingJobId,
  canWrite,
  styles,
  theme,
  onOpenStep,
  onRetryStep,
}: {
  build: BuildkiteBuild;
  head: string;
  selectedJobId: string | undefined;
  retryingJobId: string | undefined;
  canWrite: boolean;
  styles: Styles;
  theme: PluginTheme;
  onOpenStep(step: SelectedStep): void;
  onRetryStep(step: SelectedStep): void;
}) {
  const [stepsOpen, setStepsOpen] = useState(true);
  const [failedOnly, setFailedOnly] = useState(false);
  const [confirm, setConfirm] = useState<
    { kind: "cancel" } | { kind: "unblock"; job: BuildkiteJob } | null
  >(null);
  const buildAction = useBuildAction();
  const unblock = useUnblockStep();
  const hardFailed = build.jobs.filter(
    (job) =>
      job.logUrl && ["failed", "timed_out", "expired"].includes(job.state) && !job.softFailed,
  ).length;
  const running = isActive(build.state) || build.state === "blocked";
  const busyAction = buildAction.isPending ? buildAction.variables?.action : undefined;
  const requireWrite = useWriteGuard(canWrite);
  const presentation = present(build.state);
  const buildLabel = `${build.pipelineName} #${build.number}`;
  const counts = new Map<Presentation, number>();
  for (const job of build.jobs) {
    const p = present(job.state, job.softFailed);
    counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  const anyFailed = Boolean(counts.get("failure") || counts.get("warning"));
  const showFailedOnly = failedOnly && anyFailed;
  const jobs = showFailedOnly ? build.jobs.filter(isFailing) : build.jobs;
  const stepRow = (job: BuildkiteJob, label?: string) => (
    <StepRow
      key={job.id}
      job={job}
      label={label}
      active={job.id === selectedJobId}
      retrying={job.id === retryingJobId}
      unblocking={unblock.isPending && unblock.variables?.id === job.id}
      styles={styles}
      theme={theme}
      onPress={() => onOpenStep({ job, buildLabel })}
      onRetry={() => requireWrite(() => onRetryStep({ job, buildLabel }))}
      onUnblock={() => requireWrite(() => setConfirm({ kind: "unblock", job }))}
    />
  );

  return (
    <View>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`Open ${buildLabel} in Buildkite`}
        onPress={() => void openExternalUrl(build.webUrl)}
      >
        {(state) => (
          <View style={[styles.header, isHovered(state) && styles.rowHover]}>
            <Text style={styles.title} numberOfLines={2}>
              {build.message || build.pipelineName}
              <Text style={styles.muted}> #{build.number}</Text>
            </Text>
            <View style={styles.metaLine}>
              <StatusIcon theme={theme} presentation={presentation} />
              <Text style={[styles.metaText, { color: toneColor(theme, presentation) }]}>
                {stateLabel(build.state)}
              </Text>
              <Text style={styles.metaText} numberOfLines={1}>
                {" "}
                {build.pipelineName}
                {build.pullRequest ? ` · PR #${build.pullRequest}` : ""}
              </Text>
              <View style={{ opacity: isHovered(state) ? 1 : 0 }}>
                <Icon name="ExternalLink" size={12} color={theme.colors.foregroundMuted} />
              </View>
            </View>
            {build.commit !== head && (
              <Text style={styles.metaText}>
                Built {build.commit.slice(0, 7)}, not the checked-out commit {head.slice(0, 7)}.
              </Text>
            )}
          </View>
        )}
      </Pressable>

      <View style={styles.actions}>
        {hardFailed > 0 && (
          <GhostButton
            theme={theme}
            icon="RotateCcw"
            label={`Retry failed steps (${hardFailed})`}
            busy={busyAction === "retry-failed"}
            onPress={() =>
              requireWrite(() => buildAction.mutate({ buildId: build.id, action: "retry-failed" }))
            }
          />
        )}
        {running ? (
          <GhostButton
            theme={theme}
            icon="CircleStop"
            label="Cancel build"
            busy={busyAction === "cancel"}
            onPress={() => requireWrite(() => setConfirm({ kind: "cancel" }))}
          />
        ) : (
          <GhostButton
            theme={theme}
            icon="RefreshCw"
            label="Rebuild"
            busy={busyAction === "rebuild"}
            onPress={() =>
              requireWrite(() => buildAction.mutate({ buildId: build.id, action: "rebuild" }))
            }
          />
        )}
      </View>
      <ConfirmModal
        theme={theme}
        open={confirm !== null}
        title={
          confirm?.kind === "unblock" ? `Unblock ${confirm.job.name}?` : `Cancel ${buildLabel}?`
        }
        body={
          confirm?.kind === "unblock"
            ? "This lets the rest of the build run in Buildkite, which may include deploys."
            : "Running steps stop and the build is marked canceled for everyone."
        }
        confirmLabel={confirm?.kind === "unblock" ? "Unblock" : "Cancel build"}
        confirmIcon={confirm?.kind === "unblock" ? "Play" : "CircleStop"}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm?.kind === "unblock") unblock.mutate(confirm.job);
          else buildAction.mutate({ buildId: build.id, action: "cancel" });
        }}
      />

      {build.annotations.length > 0 && (
        <Annotations annotations={build.annotations} styles={styles} theme={theme} />
      )}

      <SectionHeader
        title="Steps"
        open={stepsOpen}
        onToggle={() => setStepsOpen((value) => !value)}
        styles={styles}
        theme={theme}
      >
        {PILL_ORDER.filter((p) => counts.get(p)).map((p) => (
          <View key={p} style={styles.pill}>
            <StatusIcon theme={theme} presentation={p} size={12} />
            <Text style={[styles.pillText, { color: toneColor(theme, p) }]}>{counts.get(p)}</Text>
          </View>
        ))}
        {anyFailed && (
          <ToolbarButton
            theme={theme}
            icon="ListFilter"
            label={showFailedOnly ? "Show all steps" : "Show only failed steps"}
            tooltipSide="left"
            active={showFailedOnly}
            onPress={() => {
              setFailedOnly((value) => !value);
              setStepsOpen(true);
            }}
          />
        )}
      </SectionHeader>

      {stepsOpen && (
        <View style={styles.stepList}>
          {build.jobs.length === 0 && <Text style={styles.empty}>No steps yet.</Text>}
          {groupParallel(jobs).map((entry) =>
            "job" in entry ? (
              stepRow(entry.job)
            ) : (
              <StepGroup
                key={entry.id}
                jobs={entry.jobs}
                selectedJobId={selectedJobId}
                styles={styles}
                theme={theme}
                renderJob={stepRow}
              />
            ),
          )}
        </View>
      )}
    </View>
  );
}

const isFailing = (job: BuildkiteJob) =>
  ["failure", "warning"].includes(present(job.state, job.softFailed));

type StepEntry = { job: BuildkiteJob } | { id: string; jobs: BuildkiteJob[] };

// Parallel jobs ("Unit 1/8" to "8/8") collapse into one row, placed where the first one was.
function groupParallel(jobs: BuildkiteJob[]): StepEntry[] {
  const entries: StepEntry[] = [];
  const groups = new Map<string, BuildkiteJob[]>();
  for (const job of jobs) {
    if (!job.groupId) {
      entries.push({ job });
      continue;
    }
    const group = groups.get(job.groupId);
    if (group) group.push(job);
    else {
      const members = [job];
      groups.set(job.groupId, members);
      entries.push({ id: job.groupId, jobs: members });
    }
  }
  return entries;
}

function SectionHeader({
  title,
  open,
  onToggle,
  styles,
  theme,
  children,
}: {
  title: string;
  open: boolean;
  onToggle(): void;
  styles: Styles;
  theme: PluginTheme;
  children?: ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${open ? "Collapse" : "Expand"} ${title.toLowerCase()}`}
      onPress={onToggle}
      style={styles.sectionHeader}
    >
      <Icon
        name={open ? "ChevronDown" : "ChevronRight"}
        size={14}
        color={theme.colors.foregroundMuted}
      />
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.pills}>{children}</View>
    </Pressable>
  );
}

const ANNOTATION_LOOK: Record<string, { icon: string; tone: Presentation }> = {
  error: { icon: "CircleX", tone: "failure" },
  warning: { icon: "TriangleAlert", tone: "warning" },
  success: { icon: "CircleCheck", tone: "success" },
  info: { icon: "Info", tone: "ignored" },
};

function Annotations({
  annotations,
  styles,
  theme,
}: {
  annotations: BuildkiteAnnotation[];
  styles: Styles;
  theme: PluginTheme;
}) {
  const important = annotations.some(({ style }) => style === "error" || style === "warning");
  const [open, setOpen] = useState(important);
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <View>
      <SectionHeader
        title="Annotations"
        open={open}
        onToggle={() => setOpen((value) => !value)}
        styles={styles}
        theme={theme}
      >
        <Text style={styles.pillText}>
          <Text style={styles.muted}>{annotations.length}</Text>
        </Text>
      </SectionHeader>
      {open && (
        <View style={styles.stepList}>
          {annotations.map((annotation) => {
            const look = ANNOTATION_LOOK[annotation.style] ?? ANNOTATION_LOOK.info;
            const isOpen = expanded === annotation.id;
            const title = annotation.text.split("\n")[0] || annotation.context;
            return (
              <View key={annotation.id}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${annotation.style} annotation: ${title}`}
                  onPress={() => setExpanded(isOpen ? null : annotation.id)}
                  style={(state) => [styles.row, isHovered(state) && styles.rowHover]}
                >
                  <Icon name={look.icon} size={14} color={toneColor(theme, look.tone)} />
                  <Text style={styles.rowName} numberOfLines={1}>
                    {title}
                  </Text>
                  <View style={styles.rowTrailingIcon}>
                    <Icon
                      name={isOpen ? "ChevronDown" : "ChevronRight"}
                      size={12}
                      color={theme.colors.foregroundMuted}
                    />
                  </View>
                </Pressable>
                {isOpen && (
                  <ScrollView style={styles.annotationBody} nestedScrollEnabled>
                    <Text selectable style={styles.annotationText}>
                      {annotation.text}
                    </Text>
                  </ScrollView>
                )}
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

function StepGroup({
  jobs,
  selectedJobId,
  styles,
  theme,
  renderJob,
}: {
  jobs: BuildkiteJob[];
  selectedJobId: string | undefined;
  styles: Styles;
  theme: PluginTheme;
  renderJob(job: BuildkiteJob, label: string): ReactNode;
}) {
  const failing = jobs.filter(isFailing).length;
  const [open, setOpen] = useState(failing > 0 || jobs.some((job) => job.id === selectedJobId));
  const presentation = worst(jobs.map((job) => present(job.state, job.softFailed)));
  const total = jobs[0].parallelTotal ?? jobs.length;
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${jobs[0].name}, ${total} parallel jobs`}
        onPress={() => setOpen((value) => !value)}
        style={(state) => [styles.row, isHovered(state) && styles.rowHover]}
      >
        <StatusIcon theme={theme} presentation={presentation} />
        <Text style={styles.rowName} numberOfLines={1}>
          {jobs[0].name}
        </Text>
        <Text style={styles.rowTrailing} numberOfLines={1}>
          {failing ? `${failing} of ${total} failed` : `${total} jobs`}
        </Text>
        <Icon
          name={open ? "ChevronDown" : "ChevronRight"}
          size={12}
          color={theme.colors.foregroundMuted}
        />
      </Pressable>
      {open && (
        <View style={styles.groupMembers}>
          {jobs.map((job) => renderJob(job, `${(job.parallelIndex ?? 0) + 1}/${total}`))}
        </View>
      )}
    </View>
  );
}

function StepRow({
  job,
  label,
  active,
  retrying,
  unblocking,
  styles,
  theme,
  onPress,
  onRetry,
  onUnblock,
}: {
  job: BuildkiteJob;
  label?: string;
  active: boolean;
  retrying: boolean;
  unblocking: boolean;
  styles: Styles;
  theme: PluginTheme;
  onPress(): void;
  onRetry(): void;
  onUnblock(): void;
}) {
  const presentation = present(job.state, job.softFailed);
  const trailing = job.softFailed ? `soft failed · ${duration(job)}` : duration(job);
  const failed = presentation === "failure" || presentation === "warning";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${job.name}, ${stateLabel(job.state)}${job.logUrl ? ", open log" : ""}`}
      disabled={!job.logUrl}
      onPress={onPress}
      style={(state) => [
        styles.row,
        active ? styles.rowActive : isHovered(state) && job.logUrl ? styles.rowHover : null,
      ]}
    >
      {(state) => (
        <>
          <StatusIcon theme={theme} presentation={presentation} />
          <Text style={styles.rowName} numberOfLines={1}>
            {label ?? job.name}
          </Text>
          <Text style={styles.rowTrailing} numberOfLines={1}>
            {trailing || stateLabel(job.state)}
          </Text>
          {/* Hover reveals retry on desktop; touch platforms have no hover, so keep it shown. */}
          {job.state === "blocked" && !job.logUrl && (
            <GhostButton
              theme={theme}
              icon="Play"
              label="Unblock"
              busy={unblocking}
              onPress={onUnblock}
            />
          )}
          {failed && job.logUrl && (retrying || isHovered(state) || Platform.OS !== "web") && (
            <ToolbarButton
              theme={theme}
              icon="RotateCcw"
              label="Retry step"
              tooltipSide="left"
              disabled={retrying}
              onPress={onRetry}
            />
          )}
        </>
      )}
    </Pressable>
  );
}
