# F-091-T02: Harness Job Scratch-Repository Check

Date: 2026-11-22  
Operator: Agent (`antigravity`)

## Scope

Verified the end-to-end pinned-tag harness job flow (`F-091-T01`) against an isolated neutral scratch repository and bare local remote:

1. Created a scratch git repository (`main`) with a bare local `origin` remote in a temporary directory.
2. Verified untagged branch ref (`templateTag: "main"`) was refused before creating a worktree (`untaggedRefused: true`).
3. Ran `runHarnessJobInWorktree` for `repoId: "scratch"`, `jobId: "hcheck1"`, `templateTag: "v10.1.0"`, writing `.harness.json` in the fresh worktree (`coding/hcheck1`) following `APPLY.md` and leaving the primary checkout untouched (`primaryClean: true`).
4. Proposed `buildHarnessPushProposal` (`coding.push_pr`, `stage: "production"`) through `Store.runAction`:
   - Outcome: `approval`, pattern: `orange`.
   - Before approval, `git ls-remote --heads <remote> coding/hcheck1` returned empty (`""`).
5. Approved via `store.decide(approvalId, "approve", "owner")`:
   - `decided.decision`: `"approve"`
   - `decided.result`: `{ branch: "coding/hcheck1", remote: "origin", prUrl: "https://example.invalid/scratch/pull/2?head=coding/hcheck1&base=main&t=chore(harness)%3A%20apply%20template%20v10.1.0" }`
   - `git ls-remote --heads <remote> coding/hcheck1` confirmed the branch was pushed (`remoteAfter: true`).

## Validation Commands

- `node --test test/coding-job.test.ts` — `7/7` passed (`F-084-T02`, `F-084-T03`, `F-091-T01`).
- End-to-end scratch-repo exercise via `runHarnessJobInWorktree` + `buildHarnessPushProposal` + `Store.runAction('coding.push_pr')` + `Store.decide('approve')` — passed.
