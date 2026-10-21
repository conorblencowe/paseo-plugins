Shows each sidebar workspace's agents as a collapsible list, so you can see which are running, need input, have finished or have failed without opening the workspace.

The list appears under any workspace with two or more open agents. Its header shows how many agents there are and how many are active. Click it to collapse or expand the list, and Paseo remembers your choice. Each agent uses the sidebar's own status indicators, and clicking one opens its workspace at that agent's tab.

Status comes live from the Paseo host that owns the workspace. The plugin sends nothing anywhere else.

Works in the desktop and web apps only. Paseo has no plugin API for sidebar rows, so the plugin edits the sidebar's page directly and relies on internal IDs that a Paseo update could change. An agent whose tab has been closed can't be opened from the list.
