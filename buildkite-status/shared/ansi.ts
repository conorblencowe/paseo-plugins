// Parses ANSI SGR color codes the way Buildkite's terminal-to-html does, so logs keep the
// colors their tools printed. Colors are 0-255 palette indexes or "#rrggbb" for truecolor.
export type AnsiColor = number | string;

export interface AnsiStyle {
  fg?: AnsiColor;
  bg?: AnsiColor;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  inverse?: boolean;
}

export interface AnsiSpan extends AnsiStyle {
  text: string;
}

const SGR = /\x1b\[([0-9;]*)m/g;

export const stripAnsi = (text: string) => text.replace(SGR, "");

export function ansiSpans(text: string): AnsiSpan[] {
  const spans: AnsiSpan[] = [];
  let style: AnsiStyle = {};
  let last = 0;
  for (const match of text.matchAll(SGR)) {
    if (match.index > last) spans.push({ ...style, text: text.slice(last, match.index) });
    last = match.index + match[0].length;
    style = applySgr(style, match[1]);
  }
  if (last < text.length) spans.push({ ...style, text: text.slice(last) });
  return spans;
}

function applySgr(current: AnsiStyle, params: string): AnsiStyle {
  const codes = params === "" ? [0] : params.split(";").map(Number);
  let next: AnsiStyle = { ...current };
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i];
    if (code === 0) next = {};
    else if (code === 1) next.bold = true;
    else if (code === 2) next.dim = true;
    else if (code === 3) next.italic = true;
    else if (code === 4) next.underline = true;
    else if (code === 7) next.inverse = true;
    else if (code === 22) next.bold = next.dim = undefined;
    else if (code === 23) next.italic = undefined;
    else if (code === 24) next.underline = undefined;
    else if (code === 27) next.inverse = undefined;
    else if (code >= 30 && code <= 37) next.fg = code - 30;
    else if (code >= 90 && code <= 97) next.fg = code - 90 + 8;
    else if (code === 39) next.fg = undefined;
    else if (code >= 40 && code <= 47) next.bg = code - 40;
    else if (code >= 100 && code <= 107) next.bg = code - 100 + 8;
    else if (code === 49) next.bg = undefined;
    else if (code === 38 || code === 48) {
      const key = code === 38 ? "fg" : "bg";
      if (codes[i + 1] === 5) {
        next[key] = codes[i + 2];
        i += 2;
      } else if (codes[i + 1] === 2) {
        next[key] = `#${codes
          .slice(i + 2, i + 5)
          .map((value) => (value || 0).toString(16).padStart(2, "0"))
          .join("")}`;
        i += 4;
      }
    }
  }
  return next;
}

// Splits text into lines of spans, carrying a color across line breaks like a terminal does.
export function ansiLines(text: string): AnsiSpan[][] {
  const lines: AnsiSpan[][] = [[]];
  for (const span of ansiSpans(text)) {
    span.text.split("\n").forEach((part, index) => {
      if (index > 0) lines.push([]);
      if (part) lines[lines.length - 1].push({ ...span, text: part });
    });
  }
  return lines;
}
