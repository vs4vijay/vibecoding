# DRFT Patches

Patches that customize the upstream Firefox/Focus source tree. They are applied
by `scripts/patch.sh` after `scripts/fetch.sh` extracts the upstream snapshot.

## Layout

| Directory | Applied at (relative to upstream tree)    | Use for                  |
| --------- | ----------------------------------------- | ------------------------ |
| `focus-android/` | `mobile/android/focus-android/`    | Focus UI / branding      |
| `components/`    | `mobile/android/android-components/` | Mozilla a-c overrides  |
| `tree/`          | repo root                          | Gecko or anywhere else   |

Patches within a directory are applied in **lexicographic order**. Use a numeric
prefix like `0001-`, `0002-` to control sequencing.

## Creating a patch

The simplest path: edit files inside the extracted tree, then capture the diff.

```bash
# 1. Make your change inside build/firefox-src/mobile/android/focus-android/...
# 2. Generate a patch from inside that subtree:
cd build/firefox-src/mobile/android/focus-android
diff -ruN --exclude=build a/ b/ > ~/my-change.patch
# Or use `git diff` if you initialized the upstream tree as a git repo locally.

# 3. Move the patch into the right bucket:
mv ~/my-change.patch ../../../../patches/focus-android/0001-rename-app-to-drft.patch
```

The patch is applied with `patch -p1` from the target directory, so paths in
the patch should be relative to that target (e.g. `app/build.gradle`, not
`mobile/android/focus-android/app/build.gradle`).

## Iteration loop

```bash
scripts/patch.sh --reverse       # undo current patches
# edit / regenerate
scripts/patch.sh --dry-run       # sanity-check without writing
scripts/patch.sh                 # apply for real
```

## Notes

- Keep patches small and focused. One concern per file.
- Add a header comment to each `.patch` explaining *why* the change exists,
  not what it does (the diff already shows what).
- When upstream rebases break a patch, `patch` prints the failing hunk; fix
  it by regenerating against the new tree.
