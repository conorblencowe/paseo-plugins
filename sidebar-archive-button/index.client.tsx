import type { PluginClientContext } from "@getpaseo/plugin/client";
import { installSidebarArchiveButtons } from "./client/web";

export default function contribute(_client: PluginClientContext) {
  return installSidebarArchiveButtons();
}
