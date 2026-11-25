# F-077-T01: turn on Dependabot alerts and CodeQL

The owner chose (a) Dependabot alerts and (b) code scanning on 2026-11-13, and declined (c) a Node 26 CI job. These are repository settings, which the agent may not change on its own, so the owner runs them. The repository is public, so both are free, and CodeQL's default setup needs no workflow file.

## macOS Terminal (logged-in `gh`)

```bash
gh api -X PUT repos/voidbrain/nerv/vulnerability-alerts -i | head -1
gh api -X PATCH repos/voidbrain/nerv/code-scanning/default-setup -f state=configured -f query_suite=default
```

Expected: `HTTP/2.0 204` from the first command; the second returns a JSON object with a `run_id`.

## Check (a few minutes later)

```bash
gh api repos/voidbrain/nerv/vulnerability-alerts -i | head -1
gh api repos/voidbrain/nerv/code-scanning/default-setup -q .state
gh api repos/voidbrain/nerv/dependabot/alerts -q length
```

Expected: `HTTP/2.0 204`, `configured`, and a number (0 or more) instead of a 403. Then tell the agent, which closes F-077-T01 and reads the first alerts.

Same in the browser: Settings → Advanced Security → Dependabot alerts → Enable; Code scanning → CodeQL analysis → Set up → Default.
