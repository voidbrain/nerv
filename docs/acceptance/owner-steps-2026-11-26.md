# Owner steps triage, 26 November 2026

Dated triage of the 33 open owner (🧑) steps at main `5c306f5a`. Records stay the status source; this page is evidence of the triage, not current status. Commands run in a Terminal on the owner's Mac (NERV-01) unless the row says otherwise. "Ready" is now when every prerequisite is verified or closed; otherwise it names what the step waits on. Full steps are on the linked page where one exists.

Totals: 1 closed, 4 converted to agent (1 whole step, 3 split off), 6 quick, 5 phone session, 15 Mac or device sessions, 5 decisions. New owner steps added by this change: nerv:F-133-T04 and nerv:B-149-T03 (phone session, waiting).

## Close

| Step | Est. | Evidence |
|---|---|---|
| nerv:F-004-T06 | 0 | Duplicate, merged into nerv:F-004-T10. Install and a received push: [B-134](https://github.com/voidbrain/nerv/blob/backlog-views/docs/BACKLOG.md#b-134) Issue, 2026-11-25, the owner's iPhone showed the notification once Apple returned 201. Its last check (mark the tapped reminder done in the app) moved into F-004-T10's acceptance and [page](f004-t06-phone-push-procedure.md#push-first-telegram-as-fallback-f-004-t10), step 1. |

## Converted to agent

Read-only on NERV-01: nothing writes to `~/.nerv`, `~/.nerv-app` or the live service. Not done in this change.

| Step | Est. | Ready | What the agent runs | Expected |
|---|---|---|---|---|
| nerv:B-122-T03 (from B-122-T02) | 0.25 h agent | now | `git -C ~/.nerv-app rev-parse --short HEAD; launchctl print gui/$(id -u)/io.nerv.agent \| grep -E '^\s*state ='; tail -n 50 ~/.nerv/updater.log \| grep '"outcome"'` | a revision at or after #719, `state = running`, a `completed` outcome for it (candidate: the 2026-11-25 23:49Z "Update 67550c4 applied") |
| nerv:B-123-T03 (from B-123-T02) | 0.25 h agent | now | `grep -E '"(state\|revision)"' ~/.nerv/updater-status.json; nerv inbox \| head -n 10` | the last run's state and revision, equal to `~/.nerv-app` HEAD when completed; the inbox lists that outcome once |
| nerv:F-129-T03 | 0.25 h agent | waits F-129-T02 | read the newest sortie with a `misato.consult` round through the data the sortie view renders (no chat sent) | consultant and Misato rows with model and seconds, summing to about the sortie's duration |
| nerv:F-120-T04 (from F-120-T03) | 0.5 h agent | waits F-120-T03 (approval) | in the development checkout: the Gauntlet campaign for the cases `node tools/gauntlet.mjs pending` lists | run recorded; `pending` lists none of the domain-pack, multi-step-agent or nerv-system-flows cases |

## Quick (Mac Terminal, a few minutes each)

One "update sitting" covers the first three: B-122-T02, then B-123-T02 on the same Update now, then F-098-T04 on the updated base.

| Step | Est. | Ready | Copy-paste | Expected |
|---|---|---|---|---|
| nerv:B-122-T02 | 0.25 h | now | `nerv service stop; nerv launch` (leave it running), press **Update now** in the dashboard; then Ctrl-C, `nerv service start` ([page](b122-update-from-foreground-2026-11-24.md#after-the-b-122-fix-is-installed)) | the refusal names the foreground `nerv launch` and its pid, not "ownership is unknown"; after the service starts, steps 3–4 of the page end `Outcome: completed` |
| nerv:B-123-T02 | 0.25 h | now | `nerv open`, Health → Update availability → **Update now**, reload, **Dismiss**, reload ([page](b123-update-status.md)) | "Update in progress · <step>", then "Update completed · now on <revision>" kept after a reload; gone after Dismiss and a reload |
| nerv:F-098-T04 | 0.25 h | now (after the update) | `nerv chat "ho crashato Smoke, motore sinistro inferiore rotto"` then `nerv chat "quanti motori di scorta mi restano?"` ([page](f098-t04-fleet-crash-live.md)) | the crash on Smoke's rear-left motor, and the spare motors left (one fewer) |
| nerv:B-099-T03 | 0.25 h | waits B-099-T02 (implemented, agent closes) | the commands of the [job user guide](../guides/eva-job-user.md), then `sudo -n -u _nervjob /usr/bin/true; sudo -n -u _nervjob /bin/kill -0 -1` | the first is refused, the second allowed |
| nerv:F-083-T09 | 0.25 h | waits F-083-T07 (implemented, agent closes) | `nerv chat "dimmi gli ingredienti per gli special brownie"`, then `nerv chat "vai col primo step"`, `nerv chat "imposta un timer di 10 minuti"`, `nerv chat "avanti"` | the ingredients, the steps in order, the timer announced |
| nerv:F-117-T05 | 0.25 h | waits F-117-T03 | `nerv update --check; nerv update; nerv update --check` | "behind by N commits", then `Outcome: completed …`, then "up to date" |

## Phone session (iPhone with the installed app, plus the Mac)

Do the ready rows in one sitting (about 45 minutes, most of it the 12-minute waits, which overlap); add the waiting rows to a later sitting as they become ready.

| Step | Est. | Ready | Copy-paste | Expected |
|---|---|---|---|---|
| nerv:F-004-T10 | 0.75 h | now | steps 1–4 of the [push-first page](f004-t06-phone-push-procedure.md#push-first-telegram-as-fallback-f-004-t10), starting `nerv remind "Push first A" "$(date -v+1M +%Y-%m-%dT%H:%M:00%z \| sed -E 's/([0-9]{2})([0-9]{2})$/\1:\2/')"` | A: push, tapped and marked done, never on Telegram; B: untapped, Telegram once at about 10 minutes; C (push off): Telegram at once |
| nerv:B-128-T02 | 0.25 h | now | `nerv open dashboard` → Settings → Pair a device; scan the QR with the iPhone camera ([page](b128-pairing-qr-tailnet.md)) | the note reads "The QR opens NAME.TAILNET.ts.net, this Mac's address for the phone."; Safari opens that address with the pairing code |
| nerv:F-082-T04 | 0.25 h | waits F-082-T02 (implemented, agent closes) | in Telegram: `aggiungi alla lista spesa latte, uova, pane`; on the dashboard chat: `mostra la lista spesa`, tick "latte"; in Telegram: `mostra la lista spesa` | three items added; "latte" shown ticked in Telegram |
| nerv:F-130-T14 | 1.25 h | waits F-130-T13 | `nerv open dashboard` on the Mac; open the installed app on the phone | every full-dashboard section live, no reload on an idle poll, theme switch changes both layouts; the simple view shows chat, approvals, health, push on/off and the link only |
| nerv:B-147-T03 | 0.25 h | waits B-147-T02 | in the iPhone app chat: `remind me to drink water in 2 minutes` | the flow lights the EVA cage, then the arrow back to Misato, before the reply |

## Mac and device sessions

The four companion rows are one sitting (about 1.25 h): rebuild the companion once ([part D, step 0](companion-live-checks.md#part-d--changed-certificate-and-stopped-profile-recovery-b-057-t02-f-081-t01)), then F-011-T02 part 1 (its steps 3–4 are B-068-T02), part B and part D.

| Step | Est. | Ready | Copy-paste | Expected |
|---|---|---|---|---|
| nerv:F-011-T02 | 0.5 h | now | [part 1](f011-companion-acceptance-procedure.md#part-1--companion-ui-notifications-and-service-controls-neo-tokyo-3-terminal--ui): open `~/Applications/NERV.app`, enable notifications, **Quit companion**, then `npm start -- service status` | service still running after Quit; notification banners once; Launch at login and Stop/Start work |
| nerv:B-068-T02 | 0.25 h | now | same sitting, part 1 steps 3–4: **Stop NERV**, then **Start NERV**, then `npm start -- service status` | Start becomes enabled after Stop; the status reports the service running and answering |
| nerv:B-057-T02 | 0.25 h | now | [part D](companion-live-checks.md#part-d--changed-certificate-and-stopped-profile-recovery-b-057-t02-f-081-t01) step 1 | after the certificate rotation the status line says "NERV's TLS certificate changed…", in English and Italian |
| nerv:B-056-T02 | 0.25 h | now | [part B](companion-live-checks.md#part-b): type `not-an-invitation` in **Renew pairing**; then `npm start -- pair`, wait two minutes, paste it | "not valid … pairing unchanged", then "expired … pairing unchanged", in both languages; the field is empty on reopening |
| nerv:F-062-T07 | 0.25 h | now (external disk) | `nerv backup keygen --out /Volumes/YOUR-DISK/nerv-backup-key.pem`, then steps 2–5 of the [restore drill](f062-t07-restore-drill.md) | a copy on the disk, `Restored and verified in <n>ms`, equal counts on every table |
| nerv:F-123-T02 | 0.5 h | now (Pi hub running) | `nerv tools add grover https://<pi>.<tailnet>.ts.net/mcp; nerv tools` ([page](f123-t02-grover-tools.md)) | `grover.<tool>` rows listed; a granted read tool answers `nerv chat "ci sono allarmi Grover?"` with no card |
| nerv:F-087-T04 | 0.5 h | now (printer on) | `nerv chat "stampa i piedini di Smoke"`, then `nerv approvals` and `nerv approve <ID>` ([decision](../decisions/bambu-print-handoff.md)) | a Blue card; on approval Bambu Connect opens with the sliced file; start it there and the checklist matched |
| nerv:F-007-T05 | 0.5 h | now (quiet room, microphone) | `cd ~/Projects/NERV/NERV && node --use-system-ca src/cli.ts voice eval evals/voice-corpus-v1.json`, then the twelve spoken rows of the [page](f007-t05-voice-corpus-procedure.md) | `12 0` typed; each spoken row shows its intent; rows 11–12 keep Confirm disabled |
| nerv:F-016-T09 | 1 h | now (NERV-01 and NERV-02) | `nerv kaji list; nerv kaji standby`, then the [relocation page](f016-t09-two-device-relocation.md) | NERV-02 becomes main and back; one reminder arrives once through the new main |
| nerv:F-012-T05 | 0.5 h | now (a real provider limit) | the five steps of the [real resume page](f012-real-resume.md), starting with `nerv resume-intent list` | one resume per reset, refusals on a closed tab or changed target, never a duplicate |
| nerv:F-060-T01 | 2 h over days | now (P3) | `curl -fsSL https://releases.herdr.dev/core/install.sh -o ~/hc-install.sh && less ~/hc-install.sh`, then the [trial page](f060-t01-herdr-trial.md); or reply `F-060: close without the trial` | five short answers after a few working days; or F-060 closed |
| nerv:F-088-T04 | 0.5 h | waits F-088-T03 (implemented, agent closes) | `printf '[{"label":"TEST","destinationDir":"%s/nerv-card-test","approved":true}]' "$HOME" > ~/card-rules.json; nerv card-copy /Volumes/<CARD> TEST ~/card-rules.json` twice | the second report's `summary` copies 0 files |
| nerv:F-089-T03 | 0.25 h | waits F-089-T04 (implemented, agent closes; its page comes then) | with the allowed tab open: `nerv chat "clicca <nome del pulsante> nella scheda aperta"`, then `nerv approve <ID>` | a card naming the control, tab and origin; one click on that tab only |
| nerv:F-090-T03 | 0.25 h | waits F-090-T04 (implemented, agent closes; its page comes then) | when a Claude Code session stops at its limit: `nerv session-limit record <SESSION> <REPO> <BRANCH> "<reset ISO time+zone>" --prompt "continua"; nerv session-limit list` | after the reset, `nerv inbox \| head -n 3` shows the resumed output once |
| nerv:F-094-T04 | 0.25 h | waits F-094-T03 (page comes then) | `nerv app-workflow ~/plan.json`, then `nerv app-workflow ~/plan.json --approve=<HASH>` | the plan and its hash; the app opens the file and saves it under the new name, never over an existing file |

## Decisions

| Step | Est. | Ready | Reply (copy-paste) | Options and source |
|---|---|---|---|---|
| nerv:F-120-T03 | 0.25 h | now | `F-120-T03 approved: run the pending Gauntlet cases overnight` (or `declined`) | 54 cases pending at main `5c306f5a`; the run is nerv:F-120-T04 (agent, Docker and arduino-cli on the Mac, shares Ollama with the service) |
| nerv:F-116-T02 | 0.25 h | now | `F-116: go` or `F-116: close` | [model splitting note](../design/model-splitting.md), section 6 |
| nerv:F-086-T04 | 0.5 h | blocked | `F-086: approve a live-binding agent step` or `F-086: no` | the service never constructs a `GmailClient` (no credential flow in `src/config.ts`), so the check would end "not available"; same pattern as F-082-T05 and F-090-T04 |
| nerv:F-092-T04 | 0.25 h | blocked | `F-092: approve a live-binding agent step` or `F-092: no` | `desktopReplayDriver` is never supplied (`src/executors.ts` throws "Desktop replay driver is not available."); same pattern |
| nerv:F-126-T03 | 0.25 h | waits F-126-T02 | `F-126: switch to gemma4:26b` or `F-126: keep gemma4:12b`, with a reason | F-126-T02's comparison; [speed benchmark](../evaluations/2026-11-25-f126-t01-speed-benchmark.md) |

Not closed for lack of evidence: B-122-T02 and B-123-T02 (the 2026-11-25 update shows an update completes, not the foreground refusal or the Health row), F-117-T05 (no `nerv update` run on a behind base recorded), F-098-T04 (the B-137 and B-138 fixes are merged but not yet run on NERV-01).
