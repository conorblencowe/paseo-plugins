import type { BuildkiteBuild, BuildkiteJob } from "../shared/buildkite";
import { failureExcerpt } from "../shared/log";

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

// Annotations are HTML (often tables and <details>); agents and the panel want plain text.
export function htmlToText(html: string): string {
  return (
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
      // HTML whitespace is not significant except in <pre>, whose line breaks we keep.
      .replace(
        /<pre\b[^>]*>([\s\S]*?)<\/pre>/gi,
        (_, body: string) => `<p>${body.replace(/\n/g, "<br>")}</p>`,
      )
      .replace(/\s+/g, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<li[^>]*>/gi, "\n- ")
      .replace(/<\/(td|th)>/gi, " | ")
      .replace(/<\/tr>/gi, "\n")
      .replace(
        /<\/?(p|div|table|thead|tbody|ul|ol|pre|h[1-6]|details|summary|blockquote)\b[^>]*>/gi,
        "\n",
      )
      .replace(/<[^>]+>/g, "")
      .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (match, entity: string) =>
        entity[0] !== "#"
          ? (ENTITIES[entity.toLowerCase()] ?? match)
          : String.fromCodePoint(
              entity[1].toLowerCase() === "x"
                ? parseInt(entity.slice(2), 16)
                : Number(entity.slice(1)),
            ),
      )
      .split("\n")
      .map((line) =>
        line
          .replace(/[ \t]+/g, " ")
          .replace(/\s*\|\s*$/, "")
          .trim(),
      )
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

// Reduces any git remote form (ssh, https, with or without .git) to "host/owner/repo".
export function repoKey(url: string): string {
  return url
    .trim()
    .replace(/^[a-z+]+:\/\//i, "")
    .replace(/^[^@/]+@/, "")
    .replace(":", "/")
    .replace(/\.git$/, "")
    .replace(/\/$/, "")
    .toLowerCase();
}

// Drops Buildkite timestamp markers, cursor and terminal-control codes (keeping SGR colors),
// and keeps only the final state of lines that progress bars redraw with carriage returns.
export function cleanLog(raw: string): string {
  return raw
    .replace(/\x1b_bk;[^\x07]*\x07/g, "")
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-9;?]*[A-Za-ln-z]/g, "")
    .replace(/\r+\n/g, "\n")
    .split("\n")
    .map((line) => line.slice(line.lastIndexOf("\r") + 1))
    .join("\n");
}

// Agents need the end of a failing log, not the setup noise at the start.
export function tail(text: string, maxLines: number, maxChars: number): string {
  return text.trimEnd().split("\n").slice(-maxLines).join("\n").slice(-maxChars);
}

export function stepContext(
  step: { branch: string; build: BuildkiteBuild; job: BuildkiteJob },
  log: string,
  selection?: { label: string; text: string },
): string {
  const { branch, build, job } = step;
  const lines = [
    `Buildkite step "${job.name}": ${job.softFailed ? "soft failed" : job.state.replace(/_/g, " ")}`,
    `Build: ${build.pipelineName} #${build.number} on ${branch} at ${build.commit.slice(0, 7)} (${build.webUrl})`,
  ];
  if (job.exitStatus !== null) lines.push(`Exit status: ${job.exitStatus}`);
  if (job.webUrl) lines.push(`Step: ${job.webUrl}`);
  if (selection) {
    lines.push("", `Selected log ${selection.label}:`, "```", selection.text, "```");
    return lines.join("\n");
  }
  const notes = build.annotations.filter(({ style }) => style === "error" || style === "warning");
  if (notes.length) {
    lines.push("", "Build annotations:");
    for (const note of notes)
      lines.push(`[${note.style}] ${note.context}`, tail(note.text, 120, 4_000), "");
  }
  const excerpt = failureExcerpt(log);
  if (excerpt) lines.push("", "Step output (failing parts and the end):", "```", excerpt, "```");
  return lines.join("\n");
}
