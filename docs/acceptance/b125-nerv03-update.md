# B-125: put NERV-03 on the bound-reply format

Owner steps for [B-125](../archive/backlog-2026.md#b-125). NERV-01 (`2627d483`) and NERV-02 (`1c407fb8`) already sign Kaji replies bound to the request. A base that still answers in the old format is refused by the updated bases (`reply_unbound`) and refuses theirs (`bad signature`) until it updates.

**Done 2026-11-25, about 17:30 CET:** NERV-03 (Calvary) went from `9613f0df` to `eff68a3a` by the manual path in step 1b; `nerv doctor` showed `eff68a3a` with skew false, and `nerv kaji list` on NERV-01 and NERV-03 listed all three bases enrolled. B-125 is closed. The steps stay here for the next base that comes back on an old revision.

## 1. On the base, once it is back online

First check which path applies:

```bash
nerv update --check
```

### 1a. The base has `nerv update`

`nerv update` arrived with F-117-T02 in [PR #693](https://github.com/voidbrain/nerv/pull/693) (2026-11-24). On a revision with it:

```bash
nerv update
nerv update --check
```

Expected: the first check reads "behind origin/main by N commits"; `nerv update` ends with the service started and verified; the second check reads "up to date".

### 1b. The base is older (no `update` command)

A revision before #693, such as NERV-03's `9613f0df` (#540), answers `nerv update --check` with the command list and no update. Update it by hand, from its checkout folder:

```bash
nerv service stop
mkdir -p ~/.nerv-private
cp ~/.nerv/nerv.sqlite ~/.nerv-private/nerv-before-b125.sqlite
git fetch origin
git checkout --detach origin/main
npm ci
npm run build
nerv service start
nerv doctor
```

Expected: the service stops; the copy of the database is kept outside Git (schema upgrades are one-way, so it is the way back); `nerv doctor` shows the new revision (the short SHA of `origin/main`) with skew false. From then on the base has `nerv update` (step 1a).

## 2. On NERV-01 (the owner's Mac) and on the updated base

```bash
nerv kaji list
```

Expected: every base listed as enrolled, as before. Then note the date and the base's revision in B-125.
