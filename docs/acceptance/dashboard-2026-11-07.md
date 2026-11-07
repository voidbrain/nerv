# Dashboard acceptance — 7 November 2026

Scope: F-019 on the shipped `/dashboard/`, served from `web/public/dashboard/`. `dashboard1.html` is historical prototype evidence, not the implementation target.

Automated checks use invented local fixtures. The accounting regression crosses the real provider accounting API and browser page contract; the stream integration crosses the coordinator, scheduler SQLite connection, an external SQLite writer and authenticated HTTP. No real provider charge or phone delivery is inferred.

Battery shows five recorded calls per page with requested/returned model, provider token/cache counts, elapsed time/outcome, unavailable values and estimated cost with currency, price date/source. Priced subtotals apply only to that page. Unknown calls are counted separately; no daily total, limit, forecast or invoice claim appears. Failed Older/Newer requests retain their prior page/cursor history; keyboard paging keeps focus. Loaded memory/Comms search highlights matches; calendar reminder labels use years/months/days.

Chrome acceptance in `test/angular.browser.mjs` exercises the built dashboard under the real service CSP, desktop 1440 px and mobile 390 px layouts, scoped Battery axe checks, paging, search and change-driven refresh with browser polling intervals disabled. Screenshots were captured locally and visually inspected. Existing bilingual Angular/axe acceptance remains part of the same run. A navigation-away/Back check verifies the restored page can resume authenticated refresh; lifecycle tests explicitly cover persisted pageshow/pagehide.

`test/dashboard-accounting.test.ts` verifies page-scoped currency accounting, escaped model/provenance text, unknown values, stream reconnect/initial refresh, session expiry, global stream capacity, external writes, transient pager recovery and calendar month ends. The stream carries only coalesced invalidations, not durable event replay or private payloads. One bounded revision query runs per 500 ms while any client is connected; polling remains the recovery path.

Independent fresh-context review identified cursor-state mutation on failed paging and lost authentication on BFCache restoration. Both were fixed, covered by regressions and re-reviewed without further actionable findings. The old source assertion requiring disconnected accounting was updated because F-019 deliberately connects real accounting; the unavailable-value safeguard remains tested.
