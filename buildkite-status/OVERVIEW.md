Shows the Buildkite builds for the branch a workspace has checked out, in the explorer sidebar next to the pull request panel. Like a pull request's status checks, it lists each pipeline's latest build and every step's state and duration. Click a step to read its log in a "Buildkite log" tab.

Open it from the explorer sidebar, the build status icon in the workspace header, or "Buildkite" in the Command Center (⌘K).

## Builds and logs

Each build shows its annotations, such as test summaries, followed by its steps. Error and warning annotations start expanded. Parallel jobs share one row, such as "Unit tests, 2 of 8 failed", and a filter button hides everything except failed steps.

The log tab splits a log into Buildkite's collapsible sections and opens at the first failure: a failed test, a compiler error or a failed make target. You can search it, expand or collapse every section, and copy it. Logs keep the colors the tools printed.

Workspaces with builds get a status icon in their header, and Paseo shows a notification when a running build finishes. Notifications only appear while a Buildkite panel or header icon is on screen.

## Sending a step to an agent

"Send to agent" in the log tab asks an agent in the workspace to fix the step, or passes the step along as context if it didn't fail. When the workspace has several agents, you pick one. The message has the step and build details, the build's error and warning annotations, and the output around the failures plus the last lines. Cleanup hooks and long sections without failures are left out.

To send part of a log, click a line number and shift-click another to select a range (on touch screens, tap a second number), or use the send icon on a section header. A comment box opens where you can add a note before sending. Very large selections are trimmed to the lines around their failures, or to their last 300 lines.

You can also attach a step to your own prompt with "Buildkite step" in the composer's attach menu. The picker lists failing steps first, but it only knows builds the panel has loaded since Paseo started.

## Build actions

With the `write_builds` scope, you can retry a failed step, retry all of a build's failed steps (soft failures are skipped), rebuild a finished build, cancel a running one, and unblock a blocked step such as a release approval. Canceling and unblocking ask you to confirm first, since unblocking can start a deploy. Block steps that ask for input have to be unblocked in Buildkite. Without `write_builds`, the buttons still show and explain what the token is missing.

## Setup

The first time you open the panel, it asks for a Buildkite API access token and links to Buildkite's token page with the scopes selected. `read_builds` and `read_build_logs` are required, and `write_builds` enables build actions. The token is saved on the Paseo host in `~/.paseo/buildkite-status/token`, readable only by your user. All Buildkite requests come from the Paseo host; the app only receives build data.

Settings → Plugins → Buildkite shows the connected account and the token's scopes and expiry, and lets you replace the token or sign out. When the token has three days or less left, the panel and Settings warn you, and Paseo shows a notification once per session.

## How it finds the build

The plugin reads the workspace's branch, commit and `origin` remote with git, then asks Buildkite for that branch's builds in every organization the token can see. It keeps builds whose pipeline repository matches `origin` and shows the newest one per pipeline. A detached HEAD is matched by commit. If the newest build is for an older commit, the panel says so.

## Limits

- Branch names must match exactly, so builds from forked pull requests, which Buildkite names `owner:branch`, are not found.
- Running steps show the last 60,000 characters of their log, with a button to load the rest. Finished steps load up to 3 MB.
- After the app restarts, the log tab stays empty until you pick a step again.
- The panel refreshes every 10 seconds while a build runs and every minute otherwise.
