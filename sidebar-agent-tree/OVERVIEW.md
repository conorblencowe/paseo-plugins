Shows the agents inside each sidebar workspace as a collapsible list, so you can see which agents are running, need input, have finished, or hit an error without opening the workspace.

A small list appears under any workspace row that has two or more open agents. Its header shows how many agents there are and how many are active, and a click on it expands or collapses the list. The app remembers which workspaces you collapsed. Each agent shows the same indicator the sidebar uses for workspaces: a spinning ring while running, an alert icon when it needs input, a green dot when it has finished and you haven't looked yet, a red dot on error, and a faint dot when idle. Clicking an agent opens its workspace and selects its tab.

Agent status comes live from the Paseo host that owns each workspace. The plugin sends nothing anywhere else.

Limits: this works in the desktop app and the web app only, and does nothing on iOS or Android. Paseo has no plugin API for workspace rows, so the plugin adds its list to the sidebar's page structure directly and depends on internal test IDs. A Paseo update can break it. An agent whose tab has been closed can't be opened from the list.
