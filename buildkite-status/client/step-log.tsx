import type { PluginTheme } from "@getpaseo/plugin";
import {
  openExternalUrl,
  type PluginWorkspacePanelProps,
  useRpc,
  useWorkspace,
} from "@getpaseo/plugin/client";
import { copyText, Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import {
  Fragment,
  memo,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  FlatList,
  type GestureResponderEvent,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { type BuildkiteJob, logRpc, stepContextRpc } from "../shared/buildkite";
import { type AnsiColor, type AnsiSpan, ansiLines, stripAnsi } from "../shared/ansi";
import { type LogSection, logSections } from "../shared/log";
import { SendToAgentButton, useAgentSender } from "./send-to-agent";
import {
  duration,
  GhostButton,
  PrimaryButton,
  RETRYABLE,
  useRetryStep,
  useWriteGuard,
  FONT,
  isActive,
  isHovered,
  MONO,
  present,
  SPACE,
  StatusIcon,
  stateLabel,
  TOOLBAR_HEIGHT,
  ToolbarButton,
  useBuildkiteStatus,
  useSelectedStep,
} from "./ui";
import { useBuildNotices } from "./header";

function makeStyles(theme: PluginTheme) {
  const c = theme.colors;
  return {
    root: { flex: 1, minHeight: 0, backgroundColor: c.surface0 },
    toolbar: {
      zIndex: 1,
      height: TOOLBAR_HEIGHT,
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACE[2],
      paddingHorizontal: SPACE[3],
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    name: { fontSize: FONT.base, color: c.foreground, flexShrink: 1 },
    meta: { flex: 1, minWidth: 0, fontSize: FONT.sm, color: c.foregroundMuted },
    log: {
      fontFamily: MONO,
      fontSize: 12,
      lineHeight: 18,
      color: c.foreground,
      padding: SPACE[3],
    },
    lines: { paddingBottom: SPACE[2] },
    line: { flexDirection: "row" as const, alignItems: "flex-start" as const },
    // GitHub marks selected lines in yellow; the warning color is the theme's nearest.
    lineSelected: { backgroundColor: withAlpha(c.statusWarning, 0.16) ?? c.surface2 },
    gutter: { alignItems: "flex-end" as const, paddingRight: SPACE[3] },
    gutterText: { fontFamily: MONO, fontSize: 12, lineHeight: 18, color: c.foregroundMuted },
    gutterTextActive: { color: c.foreground },
    lineText: {
      flex: 1,
      minWidth: 0,
      fontFamily: MONO,
      fontSize: 12,
      lineHeight: 18,
      color: c.foreground,
      paddingRight: SPACE[3],
    },
    commentBox: {
      gap: SPACE[2],
      padding: SPACE[3],
      borderTopWidth: 1,
      borderTopColor: c.border,
      backgroundColor: c.surface1,
    },
    commentHeader: { flexDirection: "row" as const, alignItems: "center" as const, gap: SPACE[2] },
    commentTitle: { fontSize: FONT.base, fontWeight: "500" as const, color: c.foreground },
    commentHint: { flex: 1, fontSize: FONT.sm, color: c.foregroundMuted },
    commentInput: {
      minHeight: 56,
      maxHeight: 140,
      padding: SPACE[2],
      fontSize: FONT.base,
      color: c.foreground,
      backgroundColor: c.surface0,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 6,
      textAlignVertical: "top" as const,
    },
    commentActions: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "flex-end" as const,
      gap: SPACE[2],
    },
    sectionRow: {
      minHeight: 28,
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACE[2],
      paddingHorizontal: SPACE[3],
    },
    sectionRowHover: { backgroundColor: c.surface1 },
    sectionTitle: { flex: 1, fontFamily: MONO, fontSize: 12, color: c.foreground },
    sectionCount: { fontSize: FONT.sm, color: c.foregroundMuted },
    searchBar: {
      zIndex: 1,
      height: TOOLBAR_HEIGHT,
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACE[2],
      paddingHorizontal: SPACE[3],
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    searchInput: { flex: 1, height: 24, fontSize: FONT.base, color: c.foreground, padding: 0 },
    highlight: { backgroundColor: c.accent, color: c.accentForeground },
    muted: { color: c.foregroundMuted },
    danger: { color: c.statusDanger },
    empty: {
      flex: 1,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      padding: SPACE[4],
    },
    emptyText: { fontSize: FONT.sm, color: c.foregroundMuted, textAlign: "center" as const },
  };
}

export function StepLogPanel({ theme, workspaceId, navigation }: PluginWorkspacePanelProps) {
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const directory = useWorkspace(workspaceId, (workspace) => workspace.directory);
  const status = useBuildkiteStatus(directory);
  const selected = useSelectedStep(workspaceId);
  useBuildNotices();
  if (!selected) {
    return (
      <View style={[styles.root, styles.empty]}>
        <Text style={styles.emptyText}>
          Select a step in the Buildkite explorer panel to see its log here.
        </Text>
      </View>
    );
  }
  // Prefer the step's latest state from the shared status query so a running step updates.
  const live = status.data?.signedIn
    ? status.data.builds.flatMap((build) => build.jobs).find((job) => job.id === selected.job.id)
    : undefined;
  return (
    <StepLog
      key={selected.job.id}
      job={live ?? selected.job}
      buildLabel={selected.buildLabel}
      workspaceId={workspaceId}
      navigation={navigation}
      canWrite={status.data?.signedIn ? status.data.token.canWrite : false}
      styles={styles}
      theme={theme}
    />
  );
}

function StepLog({
  job,
  buildLabel,
  workspaceId,
  navigation,
  canWrite,
  styles,
  theme,
}: {
  job: BuildkiteJob;
  buildLabel: string;
  workspaceId: string;
  navigation: PluginWorkspacePanelProps["navigation"];
  canWrite: boolean;
  styles: ReturnType<typeof makeStyles>;
  theme: PluginTheme;
}) {
  const getLog = useRpc(logRpc);
  const running = isActive(job.state);
  // Finished steps load the whole log so earlier failures are reachable; running steps poll
  // only the tail unless the user asks for everything.
  const [wantFull, setWantFull] = useState(false);
  const full = wantFull || !running;
  const log = useQuery({
    queryKey: ["buildkite-log", job.logUrl, full],
    queryFn: () => getLog({ url: job.logUrl!, full }),
    enabled: !!job.logUrl,
    refetchInterval: running ? 5_000 : false,
  });
  const retry = useRetryStep(workspaceId);
  const requireWrite = useWriteGuard(canWrite);
  const toast = useToast();
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  // Sections the user toggled, keyed by position and title; others use Buildkite's defaults.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const sections = useMemo(() => logSections(log.data?.text ?? ""), [log.data?.text]);
  const needle = searching ? query.trim().toLowerCase() : "";
  const searchable = useMemo(
    () => sections.map((section) => `${section.title}\n${stripAnsi(section.body)}`.toLowerCase()),
    [sections],
  );
  const matchCounts = useMemo(
    () => (needle ? searchable.map((text) => countMatches(text, needle)) : null),
    [searchable, needle],
  );
  const openStates = useMemo(
    () =>
      sections.map((section, index) =>
        matchCounts ? matchCounts[index] > 0 : (toggled[keyOf(section, index)] ?? section.open),
      ),
    [sections, matchCounts, toggled],
  );
  const totalMatches = matchCounts ? matchCounts.reduce((sum, count) => sum + count, 0) : 0;
  const allOpen = openStates.every(Boolean);
  // Colors are parsed per section the first time it is shown, not for the whole log upfront.
  const spanCache = useMemo(() => new Map<number, AnsiSpan[][]>(), [sections]);
  const spansOf = (index: number) => {
    let spans = spanCache.get(index);
    if (!spans) spanCache.set(index, (spans = ansiLines(sections[index].body)));
    return spans;
  };
  const allLines = useMemo(() => (log.data?.text ?? "").split("\n"), [log.data?.text]);
  // Line numbers in the full Buildkite log, so a selection survives a running log being trimmed.
  const firstLine = log.data?.firstLine ?? 1;
  const gutterWidth = String(firstLine + allLines.length).length * 7 + SPACE[3] * 2;
  // `title` is set when a whole section was picked, and dropped once the range is changed.
  const [selection, setSelection] = useState<{
    anchor: number;
    start: number;
    end: number;
    title?: string;
  } | null>(null);
  const [comment, setComment] = useState("");
  const getContext = useRpc(stepContextRpc);
  const sender = useAgentSender({ theme, workspaceId, navigation });
  const selectionRange = selection
    ? selection.start === selection.end
      ? `line ${selection.start}`
      : `lines ${selection.start}–${selection.end}`
    : "";
  const selectionLabel = selection?.title
    ? `${selectionRange} (the "${selection.title}" section)`
    : selectionRange;

  const selectSection = useCallback(
    (section: LogSection, key: string) => {
      const start = firstLine + section.lineNumbers[0];
      const end = firstLine + section.lineNumbers[section.lineNumbers.length - 1];
      setToggled((value) => ({ ...value, [key]: true }));
      setSelection({ anchor: start, start, end, title: section.title });
    },
    [firstLine],
  );
  const toggleSection = useCallback(
    (key: string, open: boolean) => setToggled((value) => ({ ...value, [key]: !open })),
    [],
  );
  const selectedText = () =>
    selection
      ? allLines
          .slice(Math.max(0, selection.start - firstLine), selection.end - firstLine + 1)
          .map(stripAnsi)
          .join("\n")
      : "";

  // Click selects a line and shift-click extends, as on GitHub. Touch has no shift key, so a
  // second tap extends a single selected line instead.
  const selectLine = useCallback((number: number, event: GestureResponderEvent) => {
    const shift = Boolean((event.nativeEvent as { shiftKey?: boolean }).shiftKey);
    setSelection((current) => {
      const single = current && current.start === current.end;
      if (current && (shift || (Platform.OS !== "web" && single && current.start !== number))) {
        const [start, end] = [current.anchor, number].sort((a, b) => a - b);
        return { anchor: current.anchor, start, end };
      }
      if (single && current.start === number) return null;
      return { anchor: number, start: number, end: number };
    });
  }, []);

  function sendSelection() {
    const label = selectionLabel;
    const text = selectedText();
    const note = comment.trim() || "Look at these lines from a Buildkite step.";
    sender.start(
      async () => {
        const context = await getContext({ jobId: job.id, selection: { label, text } });
        return `${note}\n\n${context.text}`;
      },
      () => {
        setSelection(null);
        setComment("");
      },
    );
  }

  // One flat row per section header and per line of an open section, so the list can render
  // only what is on screen.
  const rows = useMemo(() => {
    const result: Row[] = [];
    sections.forEach((section, index) => {
      const open = openStates[index];
      result.push({ kind: "header", key: `h:${keyOf(section, index)}`, index, open });
      if (!open) return;
      section.lineNumbers.forEach((lineNumber, line) =>
        result.push({
          kind: "line",
          key: `l:${lineNumber}`,
          index,
          line,
          number: firstLine + lineNumber,
        }),
      );
    });
    return result;
  }, [sections, openStates, firstLine]);
  const firstFailing = sections.findIndex((section) => section.failing);
  const failingRow = rows.findIndex((row) => row.kind === "header" && row.index === firstFailing);
  const landed = useRef(false);
  const scroll = useRef<FlatList<Row>>(null);
  // Finished logs open once at their first failing section.
  useEffect(() => {
    if (running || landed.current || failingRow < 0) return;
    landed.current = true;
    const timer = setTimeout(() =>
      scroll.current?.scrollToIndex({ index: failingRow, animated: false, viewPosition: 0 }),
    );
    return () => clearTimeout(timer);
  }, [running, failingRow]);

  const renderRow = ({ item }: { item: Row }) => {
    const section = sections[item.index];
    if (item.kind === "header") {
      return (
        <SectionHeaderRow
          section={section}
          sectionKey={keyOf(section, item.index)}
          open={item.open}
          matches={matchCounts?.[item.index] ?? 0}
          needle={needle}
          theme={theme}
          styles={styles}
          onToggle={toggleSection}
          onSend={selectSection}
        />
      );
    }
    return (
      <LogLine
        number={item.number}
        spans={spansOf(item.index)[item.line]}
        selected={
          selection !== null && item.number >= selection.start && item.number <= selection.end
        }
        needle={needle}
        gutterWidth={gutterWidth}
        theme={theme}
        styles={styles}
        onSelect={selectLine}
      />
    );
  };
  // Follow the tail like a terminal until the user scrolls up to read.
  const following = useRef(true);
  const meta = [buildLabel, job.softFailed ? "soft failed" : stateLabel(job.state), duration(job)]
    .filter(Boolean)
    .join(" · ");

  return (
    <View style={styles.root}>
      <View style={styles.toolbar}>
        <StatusIcon theme={theme} presentation={present(job.state, job.softFailed)} />
        <Text style={styles.name} numberOfLines={1}>
          {job.name}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {meta}
        </Text>
        {job.logUrl && RETRYABLE.has(job.state) && (
          <GhostButton
            theme={theme}
            icon="RotateCcw"
            label="Retry"
            busy={retry.isPending}
            onPress={() => requireWrite(() => retry.mutate({ job, buildLabel }))}
          />
        )}
        <SendToAgentButton
          theme={theme}
          workspaceId={workspaceId}
          job={job}
          navigation={navigation}
        />
        <ToolbarButton
          theme={theme}
          icon="Search"
          label="Search log"
          active={searching}
          onPress={() => setSearching((value) => !value)}
        />
        {sections.length > 1 && (
          <ToolbarButton
            theme={theme}
            icon={allOpen ? "ChevronsDownUp" : "ChevronsUpDown"}
            label={allOpen ? "Collapse all sections" : "Expand all sections"}
            onPress={() =>
              setToggled(
                Object.fromEntries(sections.map((section, i) => [keyOf(section, i), !allOpen])),
              )
            }
          />
        )}
        <ToolbarButton
          theme={theme}
          icon="Copy"
          label="Copy log"
          disabled={!log.data}
          onPress={() =>
            void copyText(stripAnsi(log.data?.text ?? "")).then(
              () => toast.show("Log copied", { variant: "success" }),
              () => toast.error("Could not copy the log."),
            )
          }
        />
        {log.isFetching ? (
          <View style={{ width: 24, alignItems: "center" }}>
            <ActivityIndicator size="small" color={theme.colors.foregroundMuted} />
          </View>
        ) : (
          <ToolbarButton
            theme={theme}
            icon="RotateCw"
            label="Refresh log"
            onPress={() => log.refetch()}
          />
        )}
        {job.webUrl && (
          <ToolbarButton
            theme={theme}
            icon="ExternalLink"
            label="Open step in Buildkite"
            onPress={() => void openExternalUrl(job.webUrl!)}
          />
        )}
      </View>
      {searching && (
        <View style={styles.searchBar}>
          <Icon name="Search" size={14} color={theme.colors.foregroundMuted} />
          <TextInput
            autoFocus
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Search log"
            placeholderTextColor={theme.colors.foregroundMuted}
            accessibilityLabel="Search log"
            autoCapitalize="none"
            autoCorrect={false}
            onKeyPress={({ nativeEvent }) => nativeEvent.key === "Escape" && setSearching(false)}
          />
          {needle ? (
            <Text style={styles.sectionCount}>
              {totalMatches} {totalMatches === 1 ? "match" : "matches"}
            </Text>
          ) : null}
          <ToolbarButton
            theme={theme}
            icon="X"
            label="Close search"
            onPress={() => {
              setSearching(false);
              setQuery("");
            }}
          />
        </View>
      )}
      {log.error || !log.data || !log.data.text ? (
        <View style={styles.root}>
          <Text selectable style={[styles.log, log.error ? styles.danger : styles.muted]}>
            {log.error ? log.error.message : log.data ? "(no output yet)" : "Loading log…"}
          </Text>
        </View>
      ) : (
        <FlatList
          ref={scroll}
          style={styles.root}
          data={rows}
          keyExtractor={(row) => row.key}
          renderItem={renderRow}
          extraData={selection}
          initialNumToRender={80}
          maxToRenderPerBatch={80}
          windowSize={9}
          scrollEventThrottle={100}
          onScroll={({ nativeEvent: { contentOffset, layoutMeasurement, contentSize } }) => {
            following.current =
              contentOffset.y + layoutMeasurement.height >= contentSize.height - 24;
          }}
          onContentSizeChange={() => {
            // Running logs follow the tail; finished logs without a failure start at the end.
            if (running ? following.current : !landed.current && firstFailing === -1) {
              landed.current = true;
              scroll.current?.scrollToEnd({ animated: false });
            }
          }}
          onScrollToIndexFailed={({ index, averageItemLength }) => {
            // Rows far down are not measured yet: jump near them, then aim again.
            scroll.current?.scrollToOffset({ offset: index * averageItemLength, animated: false });
            setTimeout(() => scroll.current?.scrollToIndex({ index, animated: false }), 50);
          }}
          ListHeaderComponent={
            log.data.truncated ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => setWantFull(true)}
                style={(state) => [styles.sectionRow, isHovered(state) && styles.sectionRowHover]}
              >
                <Icon name="ChevronsUp" size={12} color={theme.colors.foregroundMuted} />
                <Text style={[styles.sectionCount, { flex: 1 }]}>
                  {full
                    ? `The first ${firstLine - 1} lines are too long to show here; open the step in Buildkite for them.`
                    : `Showing the end of the log from line ${firstLine}. Load the full log`}
                </Text>
              </Pressable>
            ) : null
          }
        />
      )}
      {selection && (
        <View style={styles.commentBox}>
          <View style={styles.commentHeader}>
            <Text style={styles.commentTitle}>
              {selection.title ?? selectionRange[0].toUpperCase() + selectionRange.slice(1)}
            </Text>
            {selection.title ? <Text style={styles.sectionCount}>{selectionRange}</Text> : null}
            <Text style={styles.commentHint} numberOfLines={1}>
              {Platform.OS === "web"
                ? "Shift-click a line number to extend"
                : "Tap another line number to extend"}
            </Text>
            <ToolbarButton
              theme={theme}
              icon="X"
              label="Clear selection"
              tooltipSide="left"
              onPress={() => setSelection(null)}
            />
          </View>
          <TextInput
            key={`${selection.start}-${selection.end}`}
            autoFocus
            multiline
            style={styles.commentInput}
            value={comment}
            onChangeText={setComment}
            placeholder="Add a note for the agent (optional)"
            placeholderTextColor={theme.colors.foregroundMuted}
            accessibilityLabel="Note for the agent"
          />
          <View style={styles.commentActions}>
            <GhostButton
              theme={theme}
              icon="Copy"
              label="Copy lines"
              onPress={() =>
                void copyText(selectedText()).then(
                  () => toast.show("Lines copied", { variant: "success" }),
                  () => toast.error("Could not copy the lines."),
                )
              }
            />
            <PrimaryButton
              theme={theme}
              icon="MessageSquarePlus"
              label="Send to agent"
              busy={sender.busy}
              onPress={sendSelection}
            />
          </View>
        </View>
      )}
      {sender.picker}
    </View>
  );
}

type Styles = ReturnType<typeof makeStyles>;

type Row =
  | { kind: "header"; key: string; index: number; open: boolean }
  | { kind: "line"; key: string; index: number; line: number; number: number };

const keyOf = (section: LogSection, index: number) => `${index}:${section.title}`;

// Memoized so selecting a line or typing a search only re-renders the rows that change.
const SectionHeaderRow = memo(function SectionHeaderRow({
  section,
  sectionKey,
  open,
  matches,
  needle,
  theme,
  styles,
  onToggle,
  onSend,
}: {
  section: LogSection;
  sectionKey: string;
  open: boolean;
  matches: number;
  needle: string;
  theme: PluginTheme;
  styles: Styles;
  onToggle(key: string, open: boolean): void;
  onSend(section: LogSection, key: string): void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${open ? "Collapse" : "Expand"} ${section.title}`}
      onPress={() => onToggle(sectionKey, open)}
      style={(state) => [styles.sectionRow, isHovered(state) && styles.sectionRowHover]}
    >
      {(state) => (
        <>
          <Icon
            name={open ? "ChevronDown" : "ChevronRight"}
            size={12}
            color={theme.colors.foregroundMuted}
          />
          <Text style={styles.sectionTitle} numberOfLines={1}>
            {highlight(section.title, needle, styles.highlight)}
          </Text>
          {matches > 0 ? <Text style={styles.sectionCount}>{matches}</Text> : null}
          {/* Desktop reveals it on hover; touch has no hover, so it stays. */}
          {section.body && (isHovered(state) || Platform.OS !== "web") ? (
            <ToolbarButton
              theme={theme}
              icon="MessageSquarePlus"
              label="Send this section to an agent"
              tooltipSide="left"
              onPress={() => onSend(section, sectionKey)}
            />
          ) : null}
        </>
      )}
    </Pressable>
  );
});

const LogLine = memo(function LogLine({
  number,
  spans,
  selected,
  needle,
  gutterWidth,
  theme,
  styles,
  onSelect,
}: {
  number: number;
  spans: AnsiSpan[];
  selected: boolean;
  needle: string;
  gutterWidth: number;
  theme: PluginTheme;
  styles: Styles;
  onSelect(number: number, event: GestureResponderEvent): void;
}) {
  return (
    <View style={[styles.line, selected && styles.lineSelected]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Select line ${number}`}
        onPress={(event) => onSelect(number, event)}
        style={[styles.gutter, { width: gutterWidth }]}
      >
        {(state) => (
          <Text
            style={[styles.gutterText, (selected || isHovered(state)) && styles.gutterTextActive]}
          >
            {number}
          </Text>
        )}
      </Pressable>
      <Text selectable style={styles.lineText}>
        {renderSpans(spans, needle, theme, styles.highlight)}
      </Text>
    </View>
  );
});

function countMatches(haystack: string, needle: string): number {
  let count = 0;
  for (
    let at = haystack.indexOf(needle);
    at !== -1;
    at = haystack.indexOf(needle, at + needle.length)
  )
    count++;
  return count;
}

function highlight(text: string, needle: string, style: object): ReactNode {
  if (!needle) return text;
  const lower = text.toLowerCase();
  const parts: ReactNode[] = [];
  let from = 0;
  for (let at = lower.indexOf(needle); at !== -1; at = lower.indexOf(needle, from)) {
    parts.push(text.slice(from, at));
    parts.push(
      <Text key={at} style={style}>
        {text.slice(at, at + needle.length)}
      </Text>,
    );
    from = at + needle.length;
  }
  parts.push(text.slice(from));
  return parts;
}

// Theme colors cover red, green and yellow; blue, magenta and cyan have no theme token, so
// these mid tones stay readable on light and dark surfaces. Black and white follow the text
// color so they never vanish against the background.
const BLUE = "#4c8dff";
const MAGENTA = "#c15cd6";
const CYAN = "#1aa8b8";

function ansiColor(theme: PluginTheme, color: AnsiColor): string {
  if (typeof color === "string") return color;
  const c = theme.colors;
  if (color < 16) {
    return [
      c.foreground,
      c.statusDanger,
      c.statusSuccess,
      c.statusWarning,
      BLUE,
      MAGENTA,
      CYAN,
      c.foreground,
      c.foregroundMuted,
      c.statusDanger,
      c.statusSuccess,
      c.statusWarning,
      BLUE,
      MAGENTA,
      CYAN,
      c.foreground,
    ][color];
  }
  const hex = (...values: number[]) =>
    `#${values.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
  if (color < 232) {
    const levels = [0, 95, 135, 175, 215, 255];
    const index = color - 16;
    return hex(
      levels[Math.floor(index / 36)],
      levels[Math.floor(index / 6) % 6],
      levels[index % 6],
    );
  }
  const gray = 8 + (color - 232) * 10;
  return hex(gray, gray, gray);
}

function spanStyle(theme: PluginTheme, span: AnsiSpan) {
  let color = span.fg === undefined ? undefined : ansiColor(theme, span.fg);
  let backgroundColor = span.bg === undefined ? undefined : ansiColor(theme, span.bg);
  if (span.inverse) {
    [color, backgroundColor] = [
      backgroundColor ?? theme.colors.surface0,
      color ?? theme.colors.foreground,
    ];
  }
  if (span.dim && !color) color = theme.colors.foregroundMuted;
  return {
    color,
    backgroundColor,
    fontWeight: span.bold ? ("600" as const) : undefined,
    fontStyle: span.italic ? ("italic" as const) : undefined,
    textDecorationLine: span.underline ? ("underline" as const) : undefined,
  };
}

// Turns a hex theme color into a translucent fill; other color formats fall back to null.
function withAlpha(color: string, alpha: number): string | null {
  return /^#[0-9a-f]{6}$/i.test(color)
    ? `${color}${Math.round(alpha * 255)
        .toString(16)
        .padStart(2, "0")}`
    : null;
}

function renderSpans(
  spans: AnsiSpan[],
  needle: string,
  theme: PluginTheme,
  highlightStyle: object,
) {
  return spans.map((span, index) => {
    const content = highlight(span.text, needle, highlightStyle);
    const plain = Object.keys(span).length === 1;
    return plain ? (
      <Fragment key={index}>{content}</Fragment>
    ) : (
      <Text key={index} style={spanStyle(theme, span)}>
        {content}
      </Text>
    );
  });
}
