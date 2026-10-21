import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  buildAction,
  getAccount,
  getLog,
  getStatus,
  getStatuses,
  getStepContext,
  retryStep,
  searchSteps,
  signIn,
  signOut,
  unblockStep,
} from "./server/buildkite";
import {
  accountRpc,
  buildActionRpc,
  unblockStepRpc,
  logRpc,
  retryStepRpc,
  searchStepsRpc,
  signInRpc,
  signOutRpc,
  statusesRpc,
  statusRpc,
  stepContextRpc,
} from "./shared/buildkite";

export default function contribute(server: PluginServerContext) {
  server.handle(statusRpc, getStatus);
  server.handle(accountRpc, getAccount);
  server.handle(statusesRpc, getStatuses);
  server.handle(logRpc, getLog);
  server.handle(signInRpc, signIn);
  server.handle(signOutRpc, signOut);
  server.handle(stepContextRpc, getStepContext);
  server.handle(searchStepsRpc, searchSteps);
  server.handle(retryStepRpc, retryStep);
  server.handle(buildActionRpc, buildAction);
  server.handle(unblockStepRpc, unblockStep);
  return () => {};
}
