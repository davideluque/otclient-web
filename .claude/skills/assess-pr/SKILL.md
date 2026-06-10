---
name: assess-pr
description: Assess a PR end-to-end and drive it to merged or closed — verify
  its claims against the code, address every review comment, fix what blocks it,
  and explain all reasoning in PR comments. Use when asked to "assess", "review
  and merge", or "get PR X into main".
---

# Assess a PR

The deliverable is a *decision executed*, not a review document: the PR ends up
merged, closed, or explicitly blocked-on-the-author — never "assessed" and left open.

## 1. Gather (parallel, before forming any opinion)

- `gh pr view N --json title,body,author,state,isDraft,additions,deletions,
  changedFiles,headRefName,mergeStateStatus,createdAt`
- `gh pr diff N`
- `gh pr checks N` — and on failure, `gh run view <id> --log-failed`. Read the
  actual error: a red check is often unrelated to the diff (stale lockfile,
  branch behind main).
- All review comments WITH thread ids: `gh api repos/:o/:r/pulls/N/comments`
- PR age vs main: a weeks-old branch means conflicts, dep drift, and reviews
  written against code that may have moved.

## 2. Verify, don't trust

Every claim — in the PR body AND in bot reviews — gets checked against the
current code before acting:

- PR says "fixes X": find X in the code and confirm the mechanism.
- Reviewer says "this throws": reproduce the reasoning (in this session, one
  "High" bot finding was wrong about optional-chaining semantics; one P1 about
  a transferred ArrayBuffer was real and fatal to the whole feature).
- Run the feature's tests mentally against the bug: would they have caught it?
  A green suite proves nothing about an untested path.

## 3. Judge value and overlap

- Does it belong in main at all? Check against project goals and YAGNI — a
  correct fix at the wrong altitude, or a feature nothing calls, gets closed,
  not polished.
- If sibling PRs overlap (agent swarms produce duplicates): diff the diffs.
  Keep the superset / the fix at the deepest correct layer; close the rest
  citing *specifically* what the keeper covers that they don't.

## 4. Bring it to mergeable (full autonomy on the branch)

- `gh pr checkout N` && merge main; resolve conflicts taking main's dep
  versions; regenerate lockfile (`npm install`) rather than hand-merging it.
- Fix verified review findings. One commit per concern, messages that say why.
- Run the repo's full local gate: lint, test, build. Paste real numbers in
  comments ("375 passing"), never "should pass".

## 5. Second opinion (critical paths)

For security, data-integrity, or boot/connection-path changes, get an
independent review (Codex agent) scoped to the changed surface, with the
specific failure modes to hunt. Verify *its* findings too before applying —
then credit it in the PR trail.

## 6. The comment protocol (non-negotiable)

- Reply to EVERY review comment in its thread (`.../comments/<id>/replies`):
  applied → fix SHA + one line; declined → technical reasoning.
- Tag `@gemini-code-assist` in replies and READ its follow-up — second-round
  answers sometimes change the call. Concede errors factually, no ceremony.
- Post one top-level assessment comment: verdict, what was verified, what was
  changed, what was declined and why. The author shouldn't need the chat log.
- Drafts: mark ready first (bots skip drafts); if a bot stays silent,
  summon it (`@gemini-code-assist review`).

## 7. Merge mechanics

- Match repo convention (here: squash). Enable `--auto`; if blocked BEHIND,
  `gh api .../update-branch` and let CI re-run. Serialize when merging several
  PRs — each merge strands the others behind main.
- Watch asynchronously (background `until` loop on PR state), confirm MERGED,
  and verify side effects (linked issues actually closed).

## Stop and ask only when

- The right outcome conflicts with the author's visible intent and they're a
  human teammate (bot/agent PRs: decide).
- Closing would discard work that's correct but out of scope — propose the
  follow-up issue instead.
