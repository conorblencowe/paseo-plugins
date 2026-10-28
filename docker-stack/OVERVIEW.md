Shows the Docker Compose stack running for a workspace in a Docker tab in the explorer sidebar. Each service shows its status (up, healthy, exited), how long it has been in that state, and the host ports it publishes. The toolbar shows the Compose project name and how many containers are running. The list refreshes every 10 seconds, and you can also refresh it by hand.

The stop button in the toolbar runs `docker compose down` for the stack after you confirm. It stops and removes the containers and networks and keeps volumes. It works without the compose file or its environment variables.

A Docker stacks item in the sidebar footer opens a screen listing every Compose stack on the daemon's Docker host, running ones first. Each row shows its workspace (or folder name when no workspace matches, such as an archived worktree), how many containers are running, and their combined memory and CPU, with a stop button that runs the same confirmed `docker compose down`. The header totals the running stacks. The screen refreshes every 15 seconds.

On desktop and web, a small container icon appears on each sidebar workspace row that has running containers. Hover over it to see how many. Paseo has no plugin API for sidebar rows, so the icon is added to the app's own markup and may break after a Paseo update. It only reflects the host you have selected, and it doesn't appear on mobile.

A container belongs to a workspace when Compose's `com.docker.compose.project.working_dir` label matches the workspace directory exactly. That label is the directory where `docker compose up` ran, so each worktree sees only its own stack. Stacks started from a subdirectory of the workspace, and containers started with plain `docker run`, are not shown.

The daemon runs the `docker` CLI, so Docker must be installed on the daemon machine.
