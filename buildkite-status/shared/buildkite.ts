import {
  defineAttachmentSource,
  defineRpc,
  PluginAttachmentSearchPayloadSchema,
} from "@getpaseo/plugin";
import { z } from "zod";

const job = z.object({
  id: z.string(),
  name: z.string(),
  state: z.string(),
  softFailed: z.boolean(),
  exitStatus: z.number().nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  webUrl: z.string().nullable(),
  logUrl: z.string().nullable(),
  // Jobs of one parallel step share a groupId; index is 0-based.
  groupId: z.string().nullable(),
  parallelIndex: z.number().nullable(),
  parallelTotal: z.number().nullable(),
});

const annotation = z.object({
  id: z.string(),
  context: z.string(),
  style: z.string(),
  text: z.string(),
});

const build = z.object({
  id: z.string(),
  number: z.number(),
  state: z.string(),
  message: z.string(),
  commit: z.string(),
  pipelineName: z.string(),
  webUrl: z.string(),
  pullRequest: z.string().nullable(),
  jobs: z.array(job),
  annotations: z.array(annotation),
});

export type BuildkiteBuild = z.infer<typeof build>;
export type BuildkiteJob = z.infer<typeof job>;
export type BuildkiteAnnotation = z.infer<typeof annotation>;

const buildSummary = z.object({
  id: z.string(),
  number: z.number(),
  state: z.string(),
  pipelineName: z.string(),
  webUrl: z.string(),
});

export type BuildkiteBuildSummary = z.infer<typeof buildSummary>;

// One request for every workspace, for header indicators and finish notifications.
export const statusesRpc = defineRpc({
  name: "buildkite.statuses",
  input: z.object({ directories: z.array(z.string()) }),
  output: z.object({
    signedIn: z.boolean(),
    results: z.array(z.object({ directory: z.string(), builds: z.array(buildSummary) })),
  }),
});

export const statusRpc = defineRpc({
  name: "buildkite.status",
  input: z.object({ directory: z.string() }),
  output: z.discriminatedUnion("signedIn", [
    z.object({ signedIn: z.literal(false) }),
    z.object({
      signedIn: z.literal(true),
      branch: z.string(),
      commit: z.string(),
      builds: z.array(build),
    }),
  ]),
});

export const logRpc = defineRpc({
  name: "buildkite.log",
  // full asks for the whole log (finished steps); otherwise only the tail, for live updates.
  input: z.object({ url: z.string(), full: z.boolean().optional() }),
  // firstLine is the 1-based number, in the full log, of the first line returned.
  output: z.object({ text: z.string(), truncated: z.boolean(), firstLine: z.number() }),
});

export const signInRpc = defineRpc({
  name: "buildkite.sign-in",
  input: z.object({ token: z.string().trim().min(1) }),
  output: z.object({}),
});

export const accountRpc = defineRpc({
  name: "buildkite.account",
  input: z.object({}),
  output: z.discriminatedUnion("signedIn", [
    z.object({ signedIn: z.literal(false) }),
    z.object({
      signedIn: z.literal(true),
      // Set when Buildkite rejects the stored token, so it can be replaced.
      error: z.string().nullable(),
      name: z.string().nullable(),
      email: z.string().nullable(),
      description: z.string().nullable(),
      expiresAt: z.string().nullable(),
      scopes: z.array(z.string()),
    }),
  ]),
});

export const signOutRpc = defineRpc({
  name: "buildkite.sign-out",
  input: z.object({}),
  output: z.object({}),
});

export const stepContextRpc = defineRpc({
  name: "buildkite.step-context",
  // With a selection, the context carries those lines instead of the end of the log.
  input: z.object({
    jobId: z.string(),
    selection: z.object({ label: z.string(), text: z.string() }).optional(),
  }),
  output: z.object({ text: z.string() }),
});

export const retryStepRpc = defineRpc({
  name: "buildkite.step.retry",
  input: z.object({ jobId: z.string() }),
  output: z.object({ jobId: z.string() }),
});

export const searchStepsRpc = defineRpc({
  name: "buildkite.steps.search",
  input: z.object({ query: z.string() }),
  output: PluginAttachmentSearchPayloadSchema,
});

export const stepAttachment = defineAttachmentSource({
  id: "step",
  title: "Buildkite step",
  icon: "Workflow",
  pickerTitle: "Attach Buildkite step",
  searchPlaceholder: "Search steps by name, pipeline or branch",
  search: searchStepsRpc,
});
