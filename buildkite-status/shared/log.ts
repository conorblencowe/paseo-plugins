import { stripAnsi } from "./ansi";

// Buildkite log conventions: "~~~" and "---" start collapsed sections, "+++" starts an
// expanded one, and "^^^ +++" expands the section it appears in (usually a failure).
const HEADER = /^(~~~|---|\+\+\+) (.*)$/;
const EXPAND_CURRENT = /^\^\^\^ \+\+\+\s*$/;
// Hooks that run after the command; their output is agent cleanup, not the failure.
const AFTER_COMMAND =
  /^Running .*\b(post-command|pre-artifact|post-artifact|pre-exit) hook|^Stopping ssh-agent|^Uploading artifacts/i;

// Lines that usually mark the actual failure: test runner summaries and markers, compiler and
// runtime errors, failed make targets. Case-sensitive so ordinary log chatter is not matched.
const FAILURE =
  /\b\d+ (failed|failing|errors?)\b|^\s*(✘|✗|×)\s|\bFAIL(ED)?\b|^\s*(\w+)?Error: |Traceback \(most recent call last\)|^panic: |npm ERR!|make: \*\*\* |error TS\d+|##\[error\]/;

export const isFailureLine = (line: string) => FAILURE.test(stripAnsi(line));

export interface LogSection {
  title: string;
  body: string;
  // 0-based index in the whole text of each body line, for line numbers and selection.
  lineNumbers: number[];
  open: boolean;
  failing: boolean;
}

// Buildkite renders ":docker:" style emoji codes as images; as text they are noise.
export function stripEmoji(name: string): string {
  return name
    .replace(/:[\w+.-]+:/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function logSections(text: string): LogSection[] {
  const sections: {
    title: string;
    lines: string[];
    lineNumbers: number[];
    open: boolean;
    hook: boolean;
  }[] = [];
  let current: (typeof sections)[number] | undefined;
  for (const [index, line] of text.split("\n").entries()) {
    // Lines keep their color codes for display; markers are matched on the plain text.
    const plain = stripAnsi(line);
    if (EXPAND_CURRENT.test(plain)) {
      if (current) current.open = true;
      continue;
    }
    const header = HEADER.exec(plain);
    if (header || !current) {
      const title = header ? stripEmoji(header[2]) || header[2] : "Earlier output";
      current = {
        title,
        lines: [],
        lineNumbers: [],
        open: header?.[1] === "+++",
        hook: AFTER_COMMAND.test(title),
      };
      sections.push(current);
      if (header) continue;
    }
    current.lines.push(line);
    current.lineNumbers.push(index);
  }
  // Sections holding failure lines open too, since Buildkite's marker often lands on teardown.
  for (const section of sections) {
    if (!section.hook && section.lines.some(isFailureLine)) section.open = true;
  }
  // Without any of those, open the last section that is not post-command cleanup.
  if (!sections.some((section) => section.open)) {
    const last = [...sections].reverse().find((section) => !section.hook) ?? sections.at(-1);
    if (last) last.open = true;
  }
  return sections.map(({ title, lines, lineNumbers, open }) => {
    // Drop trailing blank lines, keeping line numbers aligned with the body.
    let end = lines.length;
    while (end > 0 && lines[end - 1] === "") end--;
    return {
      title,
      body: lines.slice(0, end).join("\n"),
      lineNumbers: lineNumbers.slice(0, end),
      open,
      failing: lines.some(isFailureLine),
    };
  });
}

// The part of a log an agent needs: from the step's commands up to the cleanup hooks.
export function commandOutput(text: string): string {
  const lines = text.split("\n");
  let start = 0;
  lines.forEach((line, index) => {
    if (line.startsWith("~~~ Running commands")) start = index;
  });
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index++) {
    const header = HEADER.exec(lines[index]);
    if (header && AFTER_COMMAND.test(stripEmoji(header[2]))) {
      end = index;
      break;
    }
  }
  return lines
    .slice(start, end)
    .filter((line) => !EXPAND_CURRENT.test(line))
    .join("\n");
}

// Keeps about 30 lines either side of the failures (at most 200), or the last 300 lines when
// nothing looks like a failure, and says how much was left out.
function trimLines(lines: string[]): string[] {
  const hits = lines.flatMap((line, index) => (isFailureLine(line) ? [index] : []));
  const from = hits.length ? Math.max(0, hits[0] - 30) : Math.max(0, lines.length - 300);
  const to = hits.length
    ? Math.min(lines.length, Math.max(hits[hits.length - 1] + 30, from + 60), from + 200)
    : lines.length;
  return [
    from > 0 ? `… ${from} earlier lines omitted` : null,
    ...lines.slice(from, to),
    to < lines.length ? `… ${lines.length - to} later lines omitted` : null,
  ].filter((line) => line !== null);
}

// A selection small enough is sent whole; a big one (a whole section) is trimmed.
export function trimForAgent(text: string, maxChars = 20_000): string {
  return text.length <= maxChars ? text : trimLines(text.split("\n")).join("\n").slice(0, maxChars);
}

// What an agent needs from a long log: the failing sections, trimmed to the area around their
// failure lines, then the last lines of the command. Falls back to the end of the output.
export function failureExcerpt(plain: string, maxChars = 20_000): string {
  const output = commandOutput(plain);
  const parts: string[] = [];
  for (const section of logSections(output)) {
    if (!section.failing || parts.length === 3) continue;
    parts.push([`--- ${section.title}`, ...trimLines(section.body.split("\n"))].join("\n"));
  }
  const ending = output.trimEnd().split("\n").slice(-20).join("\n");
  if (parts.length === 0)
    return output.trimEnd().split("\n").slice(-300).join("\n").slice(-maxChars);
  return `${parts.join("\n\n").slice(0, maxChars - ending.length - 40)}\n\n--- End of output\n${ending}`;
}
