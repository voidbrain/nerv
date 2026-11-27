# F-160: the work graph on the Work across projects card

Owner steps for [F-160](https://github.com/voidbrain/nerv/blob/backlog-views/docs/BACKLOG.md#f-160) (step F-160-T05). Run on the owner's Mac (NERV-01) after the update that carries F-160-T01 to T04, with the coordinator's live index running (coordinator:F-024-T07). Steps 1 to 4 are planned: the commands and screens are final once T02 to T04 land, and those steps correct this page where they differ.

## 1. The installed service has the graph

```bash
nerv update
curl -sS http://127.0.0.1:7380/mcp -o /dev/null -w '%{http_code}\n'
```

Expected: the update finishes; the second line is an HTTP status (any: the index answered).

## 2. The plain graph

Open the full dashboard, the "Work across projects" card, then the Graph view.

Expected: lanes by who acts; one chain of steps marked "critical" with its hours; the other steps showing their slack in hours; each step linked to its file. The lane switch regroups by repository.

## 3. The Eva skill tree

Set Theme to Eva, then back to Simple.

Expected: in Eva the same graph reads as a skill tree, locked, available and done steps told apart by shape and word, not by colour alone; in Simple the plain look returns.

## 4. One drag, one refusal

Drag a step past an independent step in its lane and approve the card.

Expected: a PR link in voidbrain/coordinator that changes only `docs/solution-order.md`. Do not merge it unless you want the new order.

Then drag a step past one it depends on.

Expected: the step snaps back and the card says which step depends on which.

## 5. Phone width

Make the window phone-narrow, or open the card on the phone.

Expected: the text list replaces the drawing.

Record the result in F-160 Verification.
