import type { PluginClientContext } from "@getpaseo/plugin/client";
import { installSidebarAgentTree } from "./client/web";

export default function contribute(_client: PluginClientContext) {
  return installSidebarAgentTree();
}
