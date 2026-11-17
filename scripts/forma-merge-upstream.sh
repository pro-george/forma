#!/usr/bin/env bash
# Merge an upstream SolidCraft tag or branch into the current Forma branch, keeping out what
# upstream publishes under its Brand and Interface Licence (LICENSE-BRAND, since 2026-11-10):
# the UI kit, the look, the theme, the logo and the app icon. Forma has its own of each.
#
#   scripts/forma-merge-upstream.sh v0.43.0
#
# The merge is left uncommitted: resolve what conflicts in upstream's MIT/Apache code, build
# (the interface crate may now call kit functions Forma's kit does not have yet: write them from
# the call sites, never from upstream's kit), then commit.
set -euo pipefail

ref="${1:?usage: scripts/forma-merge-upstream.sh <upstream tag or branch>}"
root="$(git rev-parse --show-toplevel)"
cd "$root"

# Paths that are Forma's own: upstream's versions never come in.
own=(crates/ui-kit crates/theme crates/look assets/icons/app assets/styles/web/loading-logo.svg assets/styles/web/loading.css)
# Paths upstream has and Forma does not carry at all.
gone=(LICENSE-BRAND assets/branding .github/workflows .github/CODEOWNERS .github/ISSUE_TEMPLATE .github/pull_request_template.md .github/release-notes.md .github/FUNDING.yml .coderabbit.yaml)

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "forma-merge: commit or stash your changes first" >&2
  exit 1
fi

git merge --no-commit --no-ff "$ref" || true

# Forma's own paths go back to exactly what they were before the merge.
for path in "${own[@]}"; do
  git rm -r -q --cached --ignore-unmatch -- "$path" >/dev/null
  rm -rf -- "$path"
  if git cat-file -e "HEAD:$path" 2>/dev/null; then
    git checkout -q HEAD -- "$path"
  fi
done
# Upstream-only paths stay out, except Forma's one workflow.
for path in "${gone[@]}"; do
  git rm -r -q --cached --ignore-unmatch -- "$path" >/dev/null
  rm -rf -- "$path"
done
git checkout -q HEAD -- .github/workflows/pages.yml

echo
echo "forma-merge: $ref merged, uncommitted. Still to resolve:"
git diff --name-only --diff-filter=U || true
echo
echo "Then: RUSTUP_TOOLCHAIN=stable cargo check -p solidcraft-ui-egui -p solidcraft -p solidcraft-cli"
