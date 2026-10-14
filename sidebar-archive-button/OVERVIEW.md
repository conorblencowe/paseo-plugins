Adds an archive button to each workspace row in the sidebar, beside the three-dot menu. It appears when you hover a row, so you can archive a workspace in one click instead of opening the menu first.

The button selects the menu's own Archive action, so Paseo still asks for confirmation before archiving a worktree with uncommitted changes or unpushed commits.

Works in the desktop and web apps only. Paseo has no plugin API for sidebar rows, so the plugin locates the menu through the app's internal element IDs; a future Paseo update may change them and hide the button until the plugin is updated.
