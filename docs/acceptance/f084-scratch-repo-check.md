# F-084-T04: Coding Job Scratch-Repository Check

Date: 2026-11-22  
Operator: Agent (`antigravity`)

## Scope

Verified the end-to-end coding-job flow (`F-084-T02` + `F-084-T03`) against an isolated neutral scratch repository and bare local remote:

1. Created a scratch git repository (`main`) with a bare local `origin` remote in a temporary directory.
2. Ran `runCodingJobInWorktree` for `repoId: "scratch"`, `jobId: "check1"`, modifying `math.ts` inside the fresh worktree (`coding/check1`) and leaving the primary checkout untouched (`primaryUntouched: true`).
3. Proposed `coding.push_pr` through `Store.runAction` (`stage: "production"`):
   - Outcome: `approval`, pattern: `orange`.
   - Before approval, `git ls-remote --heads <remote> coding/check1` returned empty (`""`).
4. Approved via `store.decide(approvalId, "approve", "owner")`:
   - `decided.decision`: `"approve"`
   - `decided.result`: `{ branch: "coding/check1", remote: "origin", prUrl: "https://example.invalid/scratch/pull/1?head=coding/check1&base=main&t=Add%20subtract%20helper" }`
   - `git ls-remote --heads <remote> coding/check1` confirmed the branch was pushed (`remoteAfter: true`).

## Validation Commands

- `node --test test/coding-job.test.ts` — `5/5` passed (`F-084-T02` + `F-084-T03`).
- End-to-end scratch-repo exercise via `runCodingJobInWorktree` + `Store.runAction('coding.push_pr')` + `Store.decide('approve')` — passed.
