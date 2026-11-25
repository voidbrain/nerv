# B-125: put NERV-03 on the bound-reply format

Owner steps for [B-125](../BACKLOG.md#b-125). NERV-01 (`2627d483`) and NERV-02 (`1c407fb8`) already sign Kaji replies bound to the request. NERV-03 (Calvary) was offline on 2026-11-25 and still answers in the old format, so the updated bases refuse its replies (`reply_unbound`) and it refuses theirs (`bad signature`) until it updates.

## 1. On NERV-03, once it is back online

```bash
nerv update --check
nerv update
nerv update --check
```

Expected: the first check reads "behind origin/main by N commits"; `nerv update` ends with the service started and verified; the second check reads "up to date".

## 2. On NERV-01 (the owner's Mac)

```bash
nerv kaji list
```

Expected: NERV-03 listed as enrolled, as before. Then note the date and NERV-03's revision in B-125; the record closes.
