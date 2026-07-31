# Linked files

A per-repo list (**Settings → Linked Files**) of repo-relative paths that are
symlinked into every worktree the panel creates.

**Why:** `git worktree add` only checks out tracked content, so gitignored local
config a build or integration test needs (an `appsettings.*.json`, a `.env`, a
certs directory) is missing in a fresh worktree. The link points back at the
primary worktree's copy, so all worktrees share one source of truth.

## Adding paths

Three ways:

- **Add from .gitignore** lists everything git ignores in a multi-select quick
  pick. The files this feature exists for are gitignored almost by definition,
  which is precisely why the worktree lacks them.
- A folder button opens VS Code's native open dialog (`showOpenDialog`, rooted at
  the repo, multi-select).
- The path is typed.

A selection outside the repository is rejected, since a link is only meaningful as
a repo-relative path.

The ignore list comes from `git ls-files --others --ignored --exclude-standard
--directory --no-empty-directory` (`listIgnoredPaths`):

- `--directory` collapses a wholly-ignored tree into one entry, so `node_modules`
  is a single row rather than tens of thousands.
- `-z` keeps odd filenames parseable.
- Already-linked paths, git's own `.git`, and the panel's `.claude/worktrees`
  storage are filtered out (linking a worktree into a worktree would recurse).
- The list is capped at 2000 entries, with the cap stated in the picker title
  rather than silently truncated.

## Where the list lives, and when it applies

- In the extension's `globalState` keyed by the repository's **primary worktree**
  path, **not** the repo's `.vscode/settings.json`, so each repository keeps its
  own. The key is deliberately not `git rev-parse --show-toplevel`: in a window
  with a linked worktree open that reports the worktree, so the same repository
  would answer to a different key per window and a worktree's panel would show an
  empty list (`repoSettingsKey` in `worktreeUtils.ts` resolves both to the
  primary).
- Linking runs after both creation paths: **New Worktree** and the branches view's
  **Create worktree & start agent**.
- **Link existing worktrees** applies the whole list to worktrees that already
  exist.

## Safety rules

`src/links.ts` holds the filesystem logic, VS Code-free and unit-tested:

- never replaces a real file;
- re-points only a link of its own;
- skips paths absent from the primary worktree, or resolving outside the repo;
- reports every failure per path without ever aborting the worktree creation.

Removing a path from the list unlinks it again, but only where the target is
provably ours. A real file, or a link the user pointed elsewhere, is left
untouched, and unlinking never affects the data pointed at.

## Windows

Creating a *file* symlink on Windows needs Developer Mode or an elevated process,
which most users have neither of, so a plain `symlink()` would hand them `EPERM`
and nothing else. Two fallbacks keep the feature working unelevated, neither
needing a privilege:

- a directory uses a **junction**;
- a file falls back to a **hard link**.

A hard link is a second directory entry for the same data, so reads and in-place
writes are shared exactly like a symlink, with two limits:

- both entries must be on one volume (always true here, since worktrees are
  nested inside the repo);
- an editor that saves by writing a temp file and renaming over the original
  replaces the entry rather than the data, breaking the pairing.

Symlinks are therefore always preferred and the hard link is only a fallback
(`LinkOutcome.method` records which was used).

Three Windows-specific traps, handled explicitly:

- `readlink` reports a junction as an extended-length path (`\\?\C:\…`), which a
  naive compare reads as a different target and rebuilds the link on every
  refresh.
- A directory junction must be removed with `rmdir`, not `unlink`.
- Path comparison must be case-insensitive.

A hard link is invisible to `lstat`, so it is recognized by device + inode
identity instead.
