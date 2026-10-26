#!/usr/bin/env bash
# Nightly unattended run of the dependabot-merge skill (.claude/skills/dependabot-merge).
#
# Scheduled at 3am Central (after league nights; every merge deploys to
# production) by the devbox crontab: homelab kubernetes/apps/devbox/crontab.yaml,
# setup in homelab docs/devbox.md#scheduled-jobs. Runs from its own clone,
# ~/code/dg-putting-league-nightly, which it detaches at origin/main every run.
#
# Needs a fine-grained GitHub token for this repo only, with Pull requests:
# read/write, Contents: read/write (merging), Actions: read/write (logs,
# artifacts, re-runs), Workflows: read/write (merging GitHub Actions bumps) and
# Commit statuses: read. Fine-grained tokens have no Checks permission; Actions
# covers reading the checks. On the devbox it is the
# `dependabot-gh-token` key of the devbox-credentials Secret.
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
token_file="${DEPENDABOT_NIGHTLY_TOKEN_FILE:-/run/devbox/dependabot-gh-token}"

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
#
# Bounds: 90 minutes wall clock (SIGKILL 5 minutes after SIGTERM if it hangs),
# and an estimated-cost cap per run, checked between turns, so a run can
# overshoot by one turn and then ends with subtype error_max_budget_usd. Sonnet
# at medium effort is enough for reading changelogs and CI logs. The JSON result
# carries the run's turns and estimated cost, so each night's usage is in the log.
mkdir -p /tmp/dependabot-nightly
timeout -k 5m 90m claude -p "/dependabot-merge" \
  --model sonnet --effort medium \
  --max-budget-usd 5 \
  --output-format json \
  --permission-mode dontAsk \
  --allowedTools \
    "Bash(gh pr:*)" "Bash(gh run:*)" \
    "Bash(git fetch:*)" "Bash(git log:*)" "Bash(git show:*)" "Bash(git diff:*)" \
    "Bash(npm view:*)" "Bash(grep:*)" "Bash(head:*)" \
    "Read" "Grep" "Glob" "WebFetch" \
  --disallowedTools "Bash(gh pr close:*)" \
  | jq -r '.result, "--- turns: \(.num_turns)  est. cost: $\(.total_cost_usd)  subtype: \(.subtype)"' \
  || echo "=== $(date -Is) run failed or hit the time limit (exit $?); no report"

echo "=== $(date -Is) done"
