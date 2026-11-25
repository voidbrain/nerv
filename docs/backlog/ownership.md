# Ownership

Read before work that touches another repository or a solution coordinator. Part of the [backlog rules](../BACKLOG-RULES.md).


## One repository, one backlog

Each backlog owns the work of its own repository and nothing else (single responsibility). Dependencies point one way: a repository may wait on what it uses, never on what uses it.

- **Here.** A record tracks a change made in this repository. Its next action is a step taken here, and its closure criteria are things this repository's PRs, CI, releases or human checks can show.
- **Upstream** (a library, a service, the harness template): a record may wait on a release there. It is Blocked, names that release and links the issue or PR there.
- **Downstream** (repositories that use this one): a record never waits for them to adopt a change. It closes when the change is released here; each of them records its own adoption in its own backlog.
- **Evidence from elsewhere** can verify a record: a trial in a real consumer, an upstream fix reproduced. Record it in Verification once it has happened; never leave it as a condition still waiting on that repository.
- Link another repository's record when it matters; never track its status here.

Test: if a record's next action or closure condition can only happen in another repository, it is in the wrong backlog. Move that part to the backlog it belongs to and link it.


### Ownership rejection and dependency direction

Reject an active record during review if its Issue, next action or closure criteria assign work to a different repository. Split that work into the owning repository's backlog and retain only an upstream dependency link or dated evidence here. A downstream adoption reminder is still foreign work when hidden in details, labelled a follow-up or placed after the release step. Check all three places, not only the title. This is a semantic review requirement; the layout validator does not establish ownership.

Apply single responsibility and dependency inversion to architecture and delivery: a reusable master/template/library owns generic contracts and behaviour; derived projects depend on those contracts through their own adapters or configuration. A master must not import derived-project implementation, require its private state or deployment, or make its release, acceptance or closure wait for downstream adoption. Required regression tests use repository-owned fixtures and contract tests. An already completed consumer trial may be cited as evidence; it never becomes a pending downstream release gate. Product-specific requirements stay in the product repository.


### Solution coordinators

An optional solution repository owns architecture/contracts, compatibility, coordination and end-to-end integration acceptance. It may legitimately depend on its component releases; this is composition, not a reusable master depending on derived consumers. Components retain their own implementation records and close them on their own acceptance. The coordinator's next action can be defining a contract or running integration checks, never doing a foreign repository's implementation under its own ID. Use the [solution profile](../agents/solution-profile.md) and qualified `Components` links. Generated dashboards are read-only snapshots, preserve source ownership/revisions and report missing sources as unknown; never edit copied statuses or average completion percentages. A generic harness release uses its own fixtures and never waits for a real coordinator to adopt it.
