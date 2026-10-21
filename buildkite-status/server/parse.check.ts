// Run with: node server/parse.check.ts
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// Plugin sources use extensionless imports; let plain node resolve them.
registerHooks({
  resolve: (spec, context, next) => {
    try {
      return next(spec, context);
    } catch {
      return next(`${spec}.ts`, context);
    }
  },
});
const { cleanLog, htmlToText, repoKey, stepContext, tail } = await import("./parse.ts");
const { commandOutput, failureExcerpt, logSections, stripEmoji, trimForAgent } =
  await import("../shared/log.ts");
const { ansiLines, ansiSpans, stripAnsi } = await import("../shared/ansi.ts");

assert.deepEqual(ansiLines("a\x1b[31mb\nc\x1b[0m\n\nd"), [
  [{ text: "a" }, { text: "b", fg: 1 }],
  [{ text: "c", fg: 1 }],
  [],
  [{ text: "d" }],
]);

assert.deepEqual(ansiSpans("a\x1b[1;31mred\x1b[22m plain-red\x1b[0m b"), [
  { text: "a" },
  { text: "red", bold: true, fg: 1 },
  { text: " plain-red", bold: undefined, dim: undefined, fg: 1 },
  { text: " b" },
]);
assert.deepEqual(ansiSpans("\x1b[38;5;208mo\x1b[38;2;255;0;10mt\x1b[7;92mi\x1b[m"), [
  { text: "o", fg: 208 },
  { text: "t", fg: "#ff000a" },
  { text: "i", fg: 10, inverse: true },
]);
assert.equal(stripAnsi("\x1b[90m$\x1b[0m make"), "$ make");
assert.deepEqual(
  logSections("\x1b[90m~~~ Running commands\x1b[0m\n\x1b[31mboom\x1b[0m\n\x1b[0m^^^ +++").map(
    ({ title, body, open }) => [title, body, open],
  ),
  [["Running commands", "\x1b[31mboom\x1b[0m", true]],
);

const key = "github.com/acme/app";
assert.equal(repoKey("git@github.com:Acme/app.git"), key);
assert.equal(repoKey("https://github.com/acme/app.git"), key);
assert.equal(repoKey("https://token@github.com/acme/app/"), key);
assert.equal(repoKey("ssh://git@github.com/acme/app.git"), key);

assert.equal(
  cleanLog(
    "\x1b_bk;t=1700000000000\x07\x1b[32m~~~ Running\x1b[0m\x1b[K\x1b]8;;https://x\x07link\x1b]8;;\x07\r\n",
  ),
  "\x1b[32m~~~ Running\x1b[0mlink\n",
);
assert.equal(cleanLog("10%\r50%\r100%\nnext"), "100%\nnext");
assert.equal(cleanLog("export A=1\r\r\nexport B=2\r\r\n"), "export A=1\nexport B=2\n");

assert.equal(stripEmoji(":docker: Build  :rocket:"), "Build");
assert.equal(tail("a\nb\nc\n\n", 2, 100), "b\nc");
assert.equal(tail("abcdef", 10, 3), "def");

const build = {
  id: "b",
  apiUrl: "https://api.buildkite.com/v2/organizations/o/pipelines/p/builds/7",
  number: 7,
  state: "failed",
  message: "m",
  commit: "0123456789",
  pipelineName: "App",
  webUrl: "https://bk/b/7",
  pullRequest: null,
  jobs: [],
  annotations: [
    { id: "a1", context: "junit", style: "error", text: "2 tests failed\n- foo.test.ts" },
    { id: "a2", context: "plan", style: "info", text: "No changes" },
  ],
};
const job = {
  id: "j",
  name: "Unit tests",
  state: "timed_out",
  softFailed: false,
  exitStatus: 1,
  startedAt: null,
  finishedAt: null,
  webUrl: "https://bk/b/7#j",
  logUrl: null,
  groupId: null,
  parallelIndex: null,
  parallelTotal: null,
};
const context = stepContext({ branch: "feat", build, job }, "setup\nFAIL foo.test.ts");
assert.match(
  context,
  /^Buildkite step "Unit tests": timed out\nBuild: App #7 on feat at 0123456 \(https:\/\/bk\/b\/7\)\nExit status: 1\nStep: https:\/\/bk\/b\/7#j\n/,
);
assert.ok(
  context.endsWith(
    "```\n--- Earlier output\nsetup\nFAIL foo.test.ts\n\n--- End of output\nsetup\nFAIL foo.test.ts\n```",
  ),
);
assert.ok(context.includes("Build annotations:\n[error] junit\n2 tests failed\n- foo.test.ts"));
assert.ok(!context.includes("No changes"), "info annotations are left out");

assert.equal(
  htmlToText(
    '<details><summary><span class="ui-emoji">🟩</span> Plan</summary>\n<p><strong>Summary:</strong> a &amp; b &#39;c&#39;</p></details>' +
      "<table><tr><th>Test</th><th>Result</th></tr><tr><td>foo</td><td>failed</td></tr></table><ul><li>one</li></ul>",
  ),
  "🟩 Plan\n\nSummary: a & b 'c'\n\nTest | Result\nfoo | failed\n\n- one",
);

assert.equal(
  htmlToText(
    "<table>\n<tr>\n<th>No</th>\n<th>Action</th>\n</tr>\n<tr><td>1</td>\n<td>safe</td></tr></table><pre>line 1\nline 2</pre>",
  ),
  "No | Action\n1 | safe\n\nline 1\nline 2",
);

const log = [
  "~~~ Preparing working directory",
  "git clone",
  "~~~ Running commands",
  "$ npm test",
  "--- :jest: Unit tests",
  "PASS a.test.ts",
  "FAIL b.test.ts",
  "^^^ +++",
  "~~~ Running agent pre-exit hook",
  "cleanup",
].join("\n");
assert.deepEqual(
  logSections(log).map(({ title, open }) => [title, open]),
  [
    ["Preparing working directory", false],
    ["Running commands", false],
    ["Unit tests", true],
    ["Running agent pre-exit hook", false],
  ],
);
assert.equal(logSections(log)[2].body, "PASS a.test.ts\nFAIL b.test.ts");
assert.deepEqual(logSections(log)[2].lineNumbers, [5, 6]);
assert.deepEqual(
  logSections("x\n~~~ A\none\n\n\n").map(({ body, lineNumbers }) => [body, lineNumbers]),
  [
    ["x", [0]],
    ["one", [2]],
  ],
);
const selected = stepContext({ branch: "feat", build, job }, "ignored", {
  label: "lines 6–7",
  text: "PASS a\nFAIL b",
});
assert.ok(selected.endsWith("Selected log lines 6–7:\n```\nPASS a\nFAIL b\n```"));
assert.ok(!selected.includes("annotations"), "a selection replaces annotations and log tail");
assert.deepEqual(
  logSections("partial line\n~~~ Running agent pre-exit hook\nx").map(({ title, open }) => [
    title,
    open,
  ]),
  [
    ["Earlier output", true],
    ["Running agent pre-exit hook", false],
  ],
);
assert.equal(
  commandOutput(log),
  "~~~ Running commands\n$ npm test\n--- :jest: Unit tests\nPASS a.test.ts\nFAIL b.test.ts",
);
assert.equal(commandOutput("no headers\nat all"), "no headers\nat all");
assert.ok(
  !stepContext({ branch: "feat", build, job: { ...job, exitStatus: null } }, "").includes(
    "Exit status",
  ),
);

// Modelled on a real E2E log: the failure sits mid-log, and Buildkite's marker lands on teardown.
const e2e = [
  "~~~ Running commands",
  "--- Starting infra services",
  ...Array.from({ length: 500 }, (_, i) => `service log ${i}`),
  "--- Running Playwright suite",
  ...Array.from({ length: 100 }, (_, i) => `  ✓ test ${i}`),
  "  ✘  16 [chromium] › tests/award.spec.ts:62:7 › awards",
  ...Array.from({ length: 100 }, (_, i) => `  ✓ later ${i}`),
  "  1 failed",
  "--- Tearing down stack",
  ...Array.from({ length: 400 }, (_, i) => `removing container ${i}`),
  "make: *** [e2e/Makefile:201: test-e2e-ci] Error 1",
  "^^^ +++",
  "~~~ Running agent pre-exit hook",
  "cleanup",
].join("\n");
const e2eSections = logSections(e2e);
assert.deepEqual(
  e2eSections.map(({ title, open, failing }) => [title, open, failing]),
  [
    ["Running commands", false, false],
    ["Starting infra services", false, false],
    ["Running Playwright suite", true, true],
    ["Tearing down stack", true, true],
    ["Running agent pre-exit hook", false, false],
  ],
);
const excerpt = failureExcerpt(e2e);
assert.ok(excerpt.includes("--- Running Playwright suite\n… 70 earlier lines omitted"));
assert.ok(excerpt.includes("✘  16 [chromium] › tests/award.spec.ts:62:7"));
assert.ok(excerpt.includes("  1 failed"));
assert.ok(!excerpt.includes("service log"), "noisy sections without failures are left out");
assert.ok(
  excerpt.endsWith("removing container 399\nmake: *** [e2e/Makefile:201: test-e2e-ci] Error 1"),
);
assert.ok(excerpt.length < 20_000);
assert.equal(failureExcerpt("just\nsome output"), "just\nsome output");
assert.equal(trimForAgent("short\nselection"), "short\nselection");
const noisy = Array.from({ length: 1000 }, (_, i) => `line ${i} ${"x".repeat(40)}`);
assert.ok(trimForAgent(noisy.join("\n")).startsWith("… 700 earlier lines omitted\nline 700 "));
const withFailure = [...noisy.slice(0, 500), "  ✘ broken test", ...noisy.slice(500)].join("\n");
const trimmed = trimForAgent(withFailure);
assert.ok(trimmed.startsWith("… 470 earlier lines omitted\nline 470 "));
assert.ok(trimmed.includes("  ✘ broken test") && trimmed.endsWith("later lines omitted"));

const { expiryWarning } = await import("../shared/token.ts");
const now = Date.parse("2026-10-21T00:00:00Z");
assert.equal(expiryWarning(null, now), null);
assert.equal(expiryWarning("2026-10-27T04:41:57Z", now), null);
assert.equal(expiryWarning("2026-10-23T12:00:00Z", now), "Your Buildkite token expires in 2 days.");
assert.equal(expiryWarning("2026-10-22T01:00:00Z", now), "Your Buildkite token expires in 1 day.");
assert.equal(expiryWarning("2026-10-21T05:00:00Z", now), "Your Buildkite token expires today.");
assert.equal(expiryWarning("2026-10-20T05:00:00Z", now), "Your Buildkite token has expired.");

console.log("parse checks passed");
