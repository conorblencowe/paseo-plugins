Shows the Buildkite build status for the branch a workspace has checked out, in the explorer sidebar beside the pull request panel. It works like the status checks on a GitHub pull request: you see each pipeline's latest build and every step's state and duration. Click a step to open its log in a "Buildkite log" tab; clicking another step shows that step in the same tab.

Open it from the explorer sidebar, from the build status icon in the workspace header, or by searching "Buildkite" in the Command Center (⌘K).

## What you see

- Each build lists its annotations (such as test summaries), which you can expand to read, then its steps. Error and warning annotations start expanded.
- Parallel jobs appear as one row, such as "Unit tests, 2 of 8 failed", which expands to the individual jobs.
- The filter button next to the step counts shows only failed steps.
- The log tab splits the log into Buildkite's collapsible sections and opens the failing one. You can search the log with highlighted matches, expand or collapse every section, and copy the log.
- Workspaces with Buildkite builds get a status icon in their header. When a build that was running finishes, Paseo shows a notification. Notifications appear while a Buildkite panel or header icon is on screen.

## Give a step to an agent

- "Send to agent" on the log tab sends the step to an agent in the workspace with a request to fix it, or to use it as context if the step did not fail. If the workspace has several agents, you pick one. The message includes the step name, state, exit status, build, branch and links, the build's error and warning annotations, and the parts of the step's output around its failures plus its last lines. Long noisy sections without failures and Buildkite's cleanup hooks are left out.
- Hover a log section's header and choose its send icon to select the whole section and open the comment box (on touch screens the icon is always shown). Very large sections are trimmed to the lines around their failures, or their last 300 lines, before they are sent.
- In the log tab, click a line number to select a line, and shift-click to select a range (on touch screens, tap a second line number). A comment box opens below the log. Write a note and choose "Send to agent" to send your note with just those lines and the step details, or copy the lines.
- In the composer's attach menu, "Buildkite step" adds the same details as an attachment, so you can write your own prompt. The picker lists failing steps first. It only knows the builds the Buildkite panel has loaded since Paseo started.

## Build actions

With a token that has the `write_builds` scope, the plugin can change builds:

- Retry a failed step from its row (on hover) or from the log tab, which then follows the new attempt.
- "Retry failed steps" retries every hard-failed step of a build; soft failures are left alone.
- "Rebuild" starts a new build of a finished one, and "Cancel build" stops a running or blocked one after you confirm.
- Blocked steps such as a release approval show "Unblock", which asks you to confirm first because it can start deploys. Block steps that ask for input fields need to be unblocked in Buildkite.

Without `write_builds` the buttons still show, and pressing one explains that the token needs that scope.

## Setup

The first time you open the panel, it asks for a Buildkite API access token. The panel links to Buildkite's token page with `read_builds` and `read_build_logs`, which it needs, and `write_builds`, which retrying needs. The plugin checks the token's scopes, then saves it on the Paseo host in `~/.paseo/buildkite-status/token`, readable only by your user. Settings → Plugins → Buildkite (also the gear in the explorer panel, or "Buildkite settings" in the Command Center) shows the connected account, the token's scopes and expiry, and whether build actions are allowed. When the token has three days or less left, the explorer panel and Settings show a warning and Paseo shows a notification once per session. You can replace the token there, or sign out, which deletes the file.

## How it finds the build

The plugin reads the workspace's current branch, commit and `origin` remote with git. It asks Buildkite for builds of that branch across every organization the token can see, keeps builds whose pipeline repository matches `origin`, and shows the newest build per pipeline. A detached HEAD is matched by commit instead. If the newest build is for an older commit than the one checked out, the panel says so.

## Behavior and limits

- The explorer panel refreshes every 10 seconds while a build is running and every minute otherwise. Header icons for all workspaces are refreshed together with one Buildkite request every 20 seconds while something is running and every minute otherwise. The log of a running step refreshes every 5 seconds and follows new output until you scroll up.
- Finished steps load their whole log, up to 3 MB, and open at the first section with a failure such as a failed test, a compiler error or a failed make target. Running steps show the last 60,000 characters so they can refresh quickly, with a button to load everything. Logs keep the colors the tools printed, as Buildkite's own log view does. Red, green and yellow follow your Paseo theme. Copying a log or sending it to an agent removes the colors.
- After the app restarts, the log tab is empty until you pick a step again.
- Canceling builds and unblocking steps happen in Buildkite through the "Open" links.
- Branch names must match exactly, so builds from forked pull requests that Buildkite names `owner:branch` are not found.
- The token and all Buildkite requests stay on the Paseo host; the app only receives build data.
