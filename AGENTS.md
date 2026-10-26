# Creating Paseo plugins

This folder holds Paseo plugins, one directory per plugin (for example `sidebar-archive-button/`).
Follow this process whenever you're asked to create or change a plugin.

## Environment

| Thing | Value |
| --- | --- |
| Paseo CLI | `/Applications/Paseo.app/Contents/Resources/bin/paseo`. It isn't on `PATH`, so set `P=/Applications/Paseo.app/Contents/Resources/bin/paseo` |
| Daemon home and config | `~/.paseo/config.json`. Run `$P daemon status --json` for `home`, `serverId` and `daemonVersion` |
| App web bundle (for UI internals) | `/Applications/Paseo.app/Contents/Resources/app-dist/_expo/static/js/web/index-*.js` |
| Skill | `paseo-plugin`. Load it first; it has the full contribution catalogue and rules |

## Process

### 1. Read the current contract

1. Invoke the `paseo-plugin` skill.
2. Fetch `https://paseo.sh/llms.txt`, then `https://paseo.sh/docs/plugins/reference.md`. Save the
   reference to a temp file and grep its headings (`grep -n "^#"`). It's about 2,500 lines, so don't
   read all of it.
3. If the docs and the skill disagree, the deployed docs win.

### 2. Confirm the requested surface is supported

Map the request to a registration (`addHeaderButton`, `addWorkspacePanel`, `addCommandCenterItem`,
`addSidebarHeaderItem`, `addComposerPill`, `addSlashCommand`, and so on). Then check the
installed SDK, which is the source of truth:

```bash
grep -oE "add[A-Z][A-Za-z]+\(" node_modules/@getpaseo/plugin/dist/client/contracts.d.ts | sort -u
grep -n "archive\|<operation>" node_modules/@getpaseo/client/dist/index.d.ts   # SDK operations
```

(Before scaffolding, run `npm pack @getpaseo/plugin` in a temp directory to get the same files.)

- **Supported:** use the documented API. Stop reading this section and go to step 3.
- **Not supported:** tell the user plainly and name the closest supported placement. If they want the
  exact placement anyway, use the DOM-injection fallback (step 4). It works on desktop and web only
  and can break when Paseo updates. Say so in the final report.

### 3. Scaffold

From the repository root:

```bash
$P plugin init "$PWD/<plugin-id>"
cd "$PWD/<plugin-id>" && npm install
```

- Delete the scaffold's greeting example (`client/greeting.tsx`, `server/`, `shared/`, and
  `index.server.ts` if no daemon-side code is needed). A plugin needs at least one entry.
- In `paseo-plugin.json`, add `"name"`, remove `$comment`, and keep `requirements.paseo` (`init`
  sets `>=<cli version>`). Raise it if you use newer APIs.
- Check that `pluginsEnabled` is `true` in `~/.paseo/config.json`. If it isn't, stop and ask the user
  for permission, using the trust warning from the skill.

### 4. DOM-injection fallback (only when no API exists)

Find the target UI's internals in the app's web bundle. It's minified and about 20 MB, so search
it with Python. `grep`/`ugrep` with wide context regexes fails with "exceeds complexity limits".

```bash
F=$(ls /Applications/Paseo.app/Contents/Resources/app-dist/_expo/static/js/web/index-*.js)
python3 - "$F" <<'EOF'
import re, sys
s = open(sys.argv[1], encoding="utf-8", errors="ignore").read()
print(sorted(set(re.findall(r"sidebar-workspace[\w\-]*", s))))   # list test IDs for an area
i = s.find("sidebar-workspace-kebab-"); print(s[i-800:i+400])     # read the component around one
EOF
```

What to look for:

- **Test IDs.** React Native Web renders `testID` as `data-testid`. These are the most stable hooks.
- **Key formats.** For example, `workspaceKey` is `${serverId}:${workspaceId}`.
- **Native action flows.** Check whether the built-in action confirms, toasts or updates
  optimistically. If it does, drive the native control (`.click()` the trigger, wait for the menu
  item, `.click()` it) instead of calling the SDK directly, so that behaviour still applies.
- **Mount conditions.** Some controls only exist while hovered. Use a `MutationObserver` on
  `document.body` to inject whenever they appear.

Implementation rules:

- Put all DOM code in `client/web.ts`. Gate it on `Platform.OS === "web"` and return a no-op cleanup
  on native.
- Don't add `"DOM"` to `tsconfig`. Declare minimal `document` / `MutationObserver` / element
  interfaces at the top of `web.ts`.
- Mark injected nodes with a `data-*` attribute so injection is idempotent and cleanup can remove
  them. Return a cleanup that disconnects the observer and removes those nodes.
- Position injected elements absolutely (`right: 100%` and so on). RN-web Views are
  `position: relative`, so this avoids disturbing React's layout. Don't change React-owned styles.
- Call `stopPropagation()` on `pointerdown/up`, `mousedown/up`, `touchstart/end` and `click`, so the
  host row doesn't navigate or start a drag.
- Copy colours and sizes from the neighbouring native element (`svg` `stroke`/`width`, scrim
  `stop-color`) so the result matches every theme.
- Add a comment saying which internal test IDs the code depends on.

### 5. Verify

```bash
npm run typecheck                 # never pipe through tail/head: that hides the failing exit code
$P plugin install "$PWD"          # first time; afterwards: $P plugin reload <plugin-id>
$P plugin ls                      # require STATUS running, empty ERROR
$P plugin logs <plugin-id>
```

- Never restart the daemon. It can kill the running agent.
- Agents can't see the Paseo desktop window, and the daemon (`127.0.0.1:6767`) doesn't serve the
  web UI. To inspect rendered plugin DOM, open `https://app.paseo.sh` with the Paseo `browser_*`
  MCP tools: it connects to the local daemon (allowed by `cors.allowedOrigins`) and loads the
  installed plugins. Its bundle can differ from the desktop app's, so still ask the user to check
  the UI and try the action, including any confirmation or error path. For destructive actions,
  suggest a throwaway workspace.

### 6. Write `OVERVIEW.md`

Replace the scaffold comment with plain sentence-case prose: what the plugin does, how it behaves,
and its limits (platforms, dependence on internals). No install commands, no em dashes.

### 7. Report

Report what was built and where. Include the verification you actually ran and what still needs the
user to check in the UI. List any limits (unsupported surfaces, platforms, fragility), the reload
command, and a supported alternative if you used the fallback.

## Known app internals (Paseo 0.13.0)

Check these again after Paseo updates. Run `$P --version` and search the bundle again.

| Area | Test ID / fact |
| --- | --- |
| Sidebar workspace row | `sidebar-workspace-row-<workspaceKey>` |
| Row ⋮ menu trigger (mounted on hover only) | `sidebar-workspace-kebab-<workspaceKey>` |
| Row menu items | `sidebar-workspace-menu-{archive,rename,pin,copy-path,copy-branch-name,open-folder,labels,mark-as-read,mark-as-unread}-<workspaceKey>` |
| Trailing fade behind ⋮ | `sidebar-workspace-trailing-scrim`; the backdrop colour is the last SVG `stop`'s `stop-color` |
| Sidebar archive flow | Confirms risky worktree archives (dirty or unpushed), then archives optimistically |
| Workspace agent tab | `workspace-tab-agent_<agentId>`; only exists while the agent's tab is open |
| Agent status buckets | `needs_input`, `failed`, `running`, `attention`, `done` (`deriveAgentStateBucket` in `@getpaseo/protocol`) |

## Existing plugins

| Plugin | What it does | Approach |
| --- | --- | --- |
| `sidebar-archive-button` | Archive icon beside the ⋮ on hovered sidebar workspace rows | DOM-injection fallback; drives the native menu's Archive item |
| `sidebar-agent-tree` | Collapsible list of a workspace's agents and their status under its sidebar row | DOM-injection fallback; opens agents by clicking the row, then the agent's tab |
| `buildkite-status` | Buildkite builds, steps and step logs for the workspace's branch | Supported APIs: explorer panel opens a shared step-log workspace panel (panels take no params, so the selected step lives in a client-side store); daemon RPCs hold the token and call the Buildkite REST API. Styling mirrors Paseo's PR pane tokens. Plugins can't insert into the composer: step context goes via an attachment source (search only gets `query`, so the server caches the last status per directory) or `paseo.agents.ref(id).send`. Plugins get no tooltip component; `client/ui.tsx` has one copied from Paseo's. Buildkite log lines end in `\r\r\n`. Header indicators use `addHeaderButton` with a component icon fed by one batched `builds?branch[]=…` poll; toasts need a mounted component, so surfaces drain a notice queue |
