import type { PluginClientContext } from "@getpaseo/plugin/client";
import { StackPanel } from "./client/panel";
import { StacksScreen, StacksSidebarItem } from "./client/stacks";
import { installSidebarIndicators } from "./client/web";

export default function contribute(client: PluginClientContext) {
  client.addWorkspacePanel({
    id: "stack",
    title: "Docker",
    icon: "Container",
    locations: ["explorer"],
    Component: StackPanel,
  });
  client.addCommandCenterItem({
    id: "open-stack",
    title: "Show Docker stack",
    icon: "Container",
    keywords: ["docker", "compose", "containers"],
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel("stack", { location: "explorer" });
    },
  });
  client.addScreen({ id: "stacks", title: "Docker stacks", Component: StacksScreen });
  client.addSidebarFooterItem({ id: "stacks", title: "Docker stacks", Component: StacksSidebarItem });
  return installSidebarIndicators(client);
}
