Adds an archive button beside the ⋮ menu on each sidebar workspace row. It appears when you hover a row, so archiving takes one click instead of two.

The button runs the menu's own Archive action, so Paseo still asks before archiving a worktree with uncommitted changes or unpushed commits.

Works in the desktop and web apps only. Paseo has no plugin API for sidebar rows, so the plugin finds the menu through internal IDs. A Paseo update can change them and hide the button until the plugin is updated.
