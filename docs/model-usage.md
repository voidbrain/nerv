# Model usage and cost

F-063 records accounting for direct asks, Misato planning turns, Casper reviews, consultant/pilot advice and Instrumentality digests. The coordinator persists an unknown record in the scheduler's SQLite database before dispatch to the brain. A reply completes it with provider accounting. A timeout, killed brain or interrupted coordinator leaves it unknown, including after restart; unknown tokens and spend are never zero. A completed request that made no provider call (for example, a disabled consultant) is `not-called`.

`GET /api/model-usage?limit=20&before=SEQUENCE` returns newest-first pages (`items`, `next`). Use `next` as the next page's `before`; null ends the history. It requires the admin token or a dashboard session; read-only native clients and the socket cannot access it. F-019 owns dashboard presentation, which still says accounting is unavailable until connected.

Each record contains its operation, stable ID and start time, plus an observation when available: route, requested model, returned model, input/output token counts, cache-read/cache-write tokens, elapsed milliseconds and success/refused/error outcome. Numeric token counts are **measured**, reported by the provider; null means **unavailable**. Duration measures the adapter's elapsed time, including the response, rather than model compute time. The returned model is unavailable when the endpoint omits it; the configured model is never substituted into that field. The existing public ask reply retains its configured-model fallback for compatibility.

Local OpenAI-compatible input counts include cached input; pricing subtracts that cache bucket before applying ordinary input rates. Anthropic input, cache-read and cache-creation buckets are separate. Missing cloud cache counts prevent a cost estimate. Automatic SDK retries are disabled so an API attempt cannot hide additional charged requests behind one observation. Same-provider server-side fallback stays enabled; only the provider's returned accounting is observable. Failed requests may have been billed even when the provider supplies no usage. A refusal with reported usage retains that usage. No prompts, completions, endpoint URLs, raw provider errors or credentials are stored for accounting.

## Price snapshots

Optionally create `model-prices.json` in NERV_HOME, an array of explicit price snapshots. Each snapshot uses an exact route and **returned** model; there are no family guesses or built-in rates. It records ISO currency, source URL and price date. Rates are per million tokens. This neutral example is illustrative, not a provider quote:

```json
[
  {
    "route": "cloud",
    "model": "example-model",
    "currency": "USD",
    "source": "https://provider.example/pricing",
    "asOf": "2026-11-07",
    "input": 2,
    "output": 10,
    "cacheRead": 1,
    "cacheWrite": 3
  }
]
```

All four rates are required, finite and nonnegative. Sources must be HTTPS URLs without credentials, query parameters or fragments. Duplicate route/model snapshots invalidate the file. Missing or invalid snapshots leave cost unavailable without preventing the model reply. The matching snapshot is stored with the call so later edits do not rewrite historical estimates. A reported zero token count can produce zero estimated cost; a missing count cannot. Local compute has no assumed zero price.

Cost status is **estimated**, calculated from measured tokens and the explicit snapshot, never an invoice total. Discounts, taxes, batch or special-context pricing require a suitable snapshot; no currency conversion or aggregated mixed-currency total is inferred. Pricing configuration is read at completion. Accounting does not enforce a pre-call budget, change the action gate, reconcile the declared action cost or guarantee provider billing completeness.

`test/model-usage.test.ts` checks provider usage, unknown values, fallback attribution, cache pricing, refusals, no hidden retries, restart persistence, access boundaries and a known synthetic call through the real brain/coordinator/scheduler/HTTP join. It does not spend money on a live provider.
