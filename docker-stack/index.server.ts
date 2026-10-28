import type { PluginServerContext } from "@getpaseo/plugin/server";
import { downStack, getRunning, getStack, getStacks } from "./server/docker";
import { downRpc, runningRpc, stackRpc, stacksRpc } from "./shared/docker";

export default function contribute(server: PluginServerContext) {
  server.handle(stackRpc, getStack);
  server.handle(downRpc, downStack);
  server.handle(runningRpc, getRunning);
  server.handle(stacksRpc, getStacks);
  return () => {};
}
