import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  getAccount,
  getLog,
  getStatus,
  getStatuses,
  getStepContext,
  retryStep,
  searchSteps,
  signIn,
  signOut,
} from "./server/buildkite";
import {
  accountRpc,
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
  return () => {};
}
