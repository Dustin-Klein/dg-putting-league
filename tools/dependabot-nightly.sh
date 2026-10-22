#!/usr/bin/env bash
# Nightly unattended run of the dependabot-merge skill (.claude/skills/dependabot-merge).
#
# crontab (3am, outside league nights; every merge deploys to production):
#   0 3 * * * /path/to/dg-putting-league/tools/dependabot-nightly.sh >> ~/logs/dependabot-nightly.log 2>&1
#
# Use a dedicated clone: the script detaches it at origin/main every run.
#
# Needs a fine-grained GitHub token for this repo only, with Pull requests:
# read/write, Contents: read/write (merging), Actions: read/write (logs,
# artifacts, re-runs) and Checks/Commit statuses: read. Put it in
# ~/.config/dg-putting-league/gh-token (chmod 600).
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
token_file="${DEPENDABOT_NIGHTLY_TOKEN_FILE:-$HOME/.config/dg-putting-league/gh-token}"

GH_TOKEN="$(<"$token_file")"
export GH_TOKEN

cd "$repo_dir"

# One run at a time, even if a previous night overran.
exec 9>"${TMPDIR:-/tmp}/dg-putting-league-dependabot-nightly.lock"
flock -n 9 || { echo "$(date -Is) previous run still going, skipping"; exit 0; }

echo "=== $(date -Is) dependabot nightly"

# The skill reads the repo (dependabot.yml, usages of changed APIs) from main.
git fetch --quiet origin main
git checkout --quiet --detach origin/main

# dontAsk: anything not allowed below is denied instead of waiting for a prompt.
# No Edit/Write and no command runners (timeout, xargs, sed -i, find -exec): the
# run only reads code and talks to GitHub through gh. Nothing here can stop
# `gh pr merge --admin`; keep the main ruleset's bypass list empty.
mkdir -p /tmp/dependabot-nightly
timeout 2h claude -p "/dependabot-merge" \
  --permission-mode dontAsk \
  --allowedTools \
    "Bash(gh pr:*)" "Bash(gh run:*)" \
    "Bash(git fetch:*)" "Bash(git log:*)" "Bash(git show:*)" "Bash(git diff:*)" \
    "Bash(npm view:*)" "Bash(grep:*)" "Bash(head:*)" \
    "Read" "Grep" "Glob" "WebFetch" \
  --disallowedTools "Bash(gh pr close:*)"

echo "=== $(date -Is) done"
