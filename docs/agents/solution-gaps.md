# Solution gaps: proposals for missing cross-repository work

Read before you act on the dashboard's "Gap review" or change how it finds gaps. Part of the [solution profile](solution-profile.md).

The gap review lists proposals, never records, numbered so the owner can answer by number ("accept 2, drop 3", B-060). Each names the repository that would own the fix. The coordinator never creates or edits a record in a component: the owner accepts a proposal, and a session of the owning repository creates the record there, under that repository's own backlog rules ([backlog rules](../BACKLOG-RULES.md), "One repository, one backlog").

| Kind | Found when | Proposal |
|---|---|---|
| Cross-repository need with no counterpart (text heuristic) | A sentence in an open record of one component names another component (its ID or repository name as written; a name of three characters or fewer only as `name` in backticks or `name:ID`) with a dependency word (needs, waits, depends, requires, blocked …), and no open record of that component names the first one back, nor does the sentence reference an item of it that exists | The other component records what is needed, or the first drops the dependency |
| Prerequisite missing or unknown | A Depends on or `repo:STEP-ID` names an item not in that backlog (closed and archived, or a wrong ID) or in a source the dashboard could not read | The item's repository corrects its prerequisites |
| Waits on work that is done | A waiting (`⏳`) item whose prerequisites are all done | Its repository records the ones in other repositories in `externalMet`, or regenerates its views when they are its own |
| Owner's turn without a page | An owner step whose Who cell links no page, or a record without steps that waits on the owner and whose action line links no page and gives no command | Its repository writes the page: the commands or text to paste and the expected result |
| No next step, no estimate | An Open or Investigate record whose steps are all done or which has no next action; an open step with no Remaining estimate | Its repository adds the step or estimate, or verifies and closes the record |
| Order item not in its backlog | The solution order names an item its repository does not have | The coordinator removes it, or the repository creates the record the owner meant |
| Behind the harness | A project's `.harness.json` version is older than the latest template release | That repository records its reconcile |

The cross-repository kind reads text and can be wrong both ways: a sentence can name a repository without needing anything from it, and a need can be written without naming it. Treat it as a prompt to check, not a finding. "No gaps found" does not prove that every need is recorded.
