---
name: dependabot-merge
description: Triage every open Dependabot PR in dg-putting-league — check CI and the visual regression screenshots, read changelogs for breaking changes, merge the safe ones one at a time, and leave a comment on the rest saying why. Runs unattended nightly from tools/dependabot-nightly.sh; also use when asked to review/merge Dependabot PRs.
---

# dependabot-merge — merge the safe Dependabot PRs, explain the rest

Runs headless (no one is watching). Every merge to `main` deploys to production:
`ci.yml` migrates the production DB and Vercel promotes the build. So the bar is
"a human would merge this without looking", not "probably fine". When in doubt,
don't merge — comment and leave it for the morning.

`.github/dependabot.yml` is the source of truth for groups, ignores and
cooldowns. Read it first.

## Ground rules

- **Never** merge with a failing, pending or missing required check, and never
  use `gh pr merge --admin` or anything else that bypasses protection.
- **Never** push to a Dependabot branch, edit its files, or update visual
  baselines. A screenshot diff on a dependency bump is either a regression or an
  upstream style change, and both are a human's call.
- **Never** close a PR, change repo settings, rulesets or `dependabot.yml`.
  Suggest config changes in the final report instead.
- **Merge one PR at a time.** Confirm `MERGED`, then take the next.
- PR comments: short, factual, no AI attribution footer. Start every comment
  with `**Nightly dependabot triage:**` so they're easy to find, and don't post
  a new one if your last comment on that PR already says the same thing.

## Step 1 — enumerate

```bash
gh pr list --author app/dependabot --state open \
  --json number,title,headRefName,mergeStateStatus,labels,createdAt
gh pr view <N> --json body,files -q '.body, (.files[].path)'
gh pr checks <N>
```

## Step 2 — classify

| Kind | Examples | Merge when |
|---|---|---|
| **Low risk** | `types` group, `all-github-actions` (minor/patch), devDependency minor/patch (eslint plugins, jest, testing-library, drizzle-kit, tsx, @playwright/test) | all checks green |
| **Runtime, non-UI** | `drizzle-orm`, `postgres`, `zod`, `@supabase/*`, `brackets-manager`, `date-fns` minor/patch | all checks green **and** the changelog has nothing that touches how this repo uses it (see Step 3) |
| **UI** | `next`, `react`/`react-dom`, `radix-ui` group, `tailwindcss`, `lucide-react`, `tw-animate-css`, `class-variance-authority` minor/patch | all checks green, including **Visual Regression**, and the changelog check passes |
| **Major** (any package) | `x.y.z` → `(x+1).0.0`, or a GitHub Action `vN` → `vN+1` | **never** — review and comment only |

A group PR takes the riskiest class of any package in it.

Majors: read the release notes, grep the repo for the APIs they change, and post
a comment listing each breaking change and whether it affects this repo (with
file paths). That turns the morning review into a two-minute read.

## Step 3 — changelog check (runtime and UI packages)

Find the release notes for the exact version range (the PR body usually has
them; otherwise `npm view <pkg> repository.url` → GitHub releases). Look for:
breaking changes, deprecations of APIs the repo calls, changed defaults,
security notes, and Node or peer-dependency floor changes (CI uses Node 22).
`grep -rn "<api>" app components lib` before deciding something is unused.

Respect the pins documented in `dependabot.yml` (eslint 10, typescript ≥6.1)
and in `AGENTS.md` (this Next.js has breaking changes vs. training data — check
`node_modules/next/dist/docs/` on the PR branch when a `next` note is unclear).

## Step 4 — failing checks

```bash
gh pr checks <N>
gh run view <run-id> --log-failed | grep -iE "error|fail|expected|timeout" | head -50
```

- **Transient** (network, registry 5xx, a runner that died, `supabase start`
  pulling images): `gh run rerun <run-id> --failed` once, then move on and come
  back to it at the end. Fails again → treat as real.
- **Visual Regression failed:** download the report and look at the diffs:

  ```bash
  gh run download <run-id> -n visual-report -D /tmp/dependabot-nightly/visual-<N>
  ```

  then Glob `/tmp/dependabot-nightly/visual-<N>/**/*-diff.png`.

  Read each `*-diff.png` with its `*-expected.png` / `*-actual.png` and
  describe what moved in the comment (page, viewport, what changed). Don't merge.
- **Real failure** (type errors, lint, tests, build): summarize the root cause
  and the likely fix in a comment. Don't merge.

## Step 5 — merge, one at a time

```bash
gh pr merge <N> --squash --delete-branch
gh pr view <N> --json state -q .state        # expect MERGED
```

After each merge, the other npm PRs usually conflict on `package-lock.json`.
Dependabot rebases conflicted PRs on its own within a few minutes; if one is
still `DIRTY` after ~10 minutes, comment `@dependabot rebase`. Wait for the
rebased PR's checks before merging it:

```bash
gh pr checks <N> --watch --fail-fast
```

Waiting is where a run spends its budget. Run each wait as one Bash call with
the maximum timeout (600000 ms) rather than polling in short calls, and wait
for at most three rebases per run. The run is killed at 90 minutes; if more PRs
are still waiting, stop, report them as "waiting on rebase", and leave them for
tomorrow.

## Step 6 — watch production

After the last merge, watch `main`'s CI/CD run (it runs `migrate-production`,
which gates the Vercel production promotion):

```bash
gh run list --workflow ci.yml --branch main -L1 --json databaseId -q '.[0].databaseId'   # → <id>
gh run watch <id> --exit-status
```

If it fails, that is the first line of the report, in capitals.

## Step 7 — report

Print a short plain-text report (it lands in the cron log):

- merged: `#N title`
- left open: `#N title` — one-line reason (major / visual diff / failing check / changelog concern / waiting on rebase)
- `main` CI/CD result
- any systemic problem worth a config change (e.g. a package that fails every
  week, a group that keeps mixing risk classes, a flaky check)
