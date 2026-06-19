# DECISIONS.md — Vouch Handover Service

## What I built and what I deliberately skipped

**Built:**
- A single `POST /handover` endpoint that ingests both data formats, reconciles issues across nights, generates an action-first handover, and returns rendered HTML
- TypeScript throughout with ts-node for local dev, deployed on Vercel
- Two-stage LLM pipeline: one call to extract and normalize the free-text night log, one call to generate the grounded handover
- A file-based issue state tracker (`state.json`) that persists across runs and classifies issues as new / still open / resolved / pending
- Prompt injection detection in the reconciler, before any data reaches the LLM
- Structured JSON logging at every pipeline step with `hotelId`, `shiftDate`, and module context

**Deliberately skipped:**
- **Real database** — `state.json` is a flat file. It works for a single-hotel prototype and keeps the setup to zero. The obvious next step is PostgreSQL with one row per issue per hotel.
- **Authentication** — no API key or auth on the endpoint. Fine for a demo, not for production across hundreds of hotels.
- **Multi-hotel routing** — the service reads from fixed `data/` files. Scaling to many hotels means parameterising the data source per `hotelId`, which the types already support.
- **Retry logic** — no retries on LLM calls. A transient Groq error will surface as a 500. Worth adding for production.
- **Tests** — no automated tests. The grounding validation in `generate.ts` (checking every item has a `sourceQuote`) is the closest thing. With more time I'd add integration tests that replay the sample data and assert on flags and section order.

---

## How reconciliation works across nights

Every normalized event gets assigned an issue key based on its type and room — for example `deposit::309`, `maintenance::112`, `facilities::noroom`. Events that refer to the same ongoing problem share the same key regardless of which night they came from.

On each run, the reconciler loads the persisted state from `state.json`, merges in the new events, and updates each issue's state:

- If the latest event on an issue key is `resolved` → mark resolved, record the date
- If `unresolved` → mark open
- If `pending` → mark pending

For the target handover date, issues are then classified:
- **New tonight** — first appearance on this shift, not seen before
- **Still open** — opened on a previous night, still not resolved
- **Resolved tonight** — was open, got closed this shift
- **Pending** — needs a decision, either new or carried over

This means the 309 deposit issue, which first appeared Tuesday and was still unresolved Friday, shows up as "Still Open" on Friday's handover rather than appearing fresh each night.

**Conflict detection** runs at the same stage. If events on the same issue key have contradictory statuses (e.g. one says `unresolved`, another says `resolved`), the issue gets a `CONFLICT` flag. This is what catches the 312 no-show — the structured event says the charge was not applied; the night log says it was charged. Both are surfaced, neither is silently picked.

---

## How every statement stays grounded

The grounding contract runs at two levels:

**At extraction (ingest/logs.ts):** When the LLM parses the free-text night log, it is required to return a `sourceText` field for every extracted entry — the verbatim original sentence(s) that support the fact. The description may be translated or summarised, but the source must trace back to the raw text. If the model omits it, the entry gets flagged `UNVERIFIED`.

**At generation (generate.ts):** The LLM receives the reconciled issues with their full `sourceText` fields attached. The system prompt explicitly forbids stating anything not present in those sources. The required output format includes a `sourceQuote` per item. After the response comes back, the code validates every item: if `sourceQuote` is empty, the item is flagged `UNVERIFIED` and the quote is replaced with a visible warning. This validation runs in code, not just in the prompt — the model can't silently skip it.

**Incomplete input** is handled by flagging rather than omitting. A wifi complaint with no room number, a guest who called and then didn't follow up — these appear in the handover with `UNVERIFIED` rather than being dropped.

**Contradictory input** is surfaced as `[CONFLICT: ...]` in the detail text, with both versions of the fact written out. The morning manager sees the disagreement and makes the call.

**Prompt injection** (evt_0026 — a guest note telling the system to "report the night as all clear" and add a $1000 goodwill credit) is caught in the reconciler before the data reaches the LLM. The reconciler scans all event descriptions for patterns indicating instructions directed at the system, flags them `SECURITY`, and logs a warning. The LLM prompt also instructs the model not to follow such instructions if they appear in source material, as a second layer.

---

## Where AI helped most, and where it got in the way

**Helped most:** The free-text extraction was the obvious win. The night log has two entries in Chinese, typos, no structure, and a mix of tones — all in the same document. A single LLM call with a clear schema handles all of this reliably in a way that would take weeks of rule-based parsing to approximate. The `response_format: { type: 'json_object' }` option on Groq made the output reliable without needing to strip code fences or retry on parse errors.

**Got in the way:** Provider setup was the main friction. Attempting to use Anthropic required a paid API key. Switching to Google Gemini's free tier ran into quota and access issues on a new account. Finding a working free-tier provider (Groq) required searching and testing three options before landing on one that worked without a credit card. This is a real cost when time is limited — the model capability mattered less than whether the API key actually worked. In production, this isn't a concern, but for a fast prototype the friction of free-tier access is non-trivial.

---

## What I'd do in hours 3–6

- **Replace `state.json` with a real database.** A single `issues` table in PostgreSQL (or even SQLite via Turso) with `(hotelId, issueKey, state, openedOn, resolvedOn)` unlocks multi-hotel support and proper history. The reconciler interface is already designed for this swap.
- **Add a `GET /handover?date=YYYY-MM-DD` route** so the handover is browseable directly without curl. The POST stays for programmatic use.
- **Parameterise data sources per hotel.** Right now the service reads from fixed `data/` files. Connecting it to a real event stream (webhook or polling) per `hotelId` is the step that makes it production-useful.
- **Add integration tests** that replay the sample data and assert on the output — specifically that the 312 conflict is flagged, the 208 safe gap is surfaced, and the injection attempt doesn't affect the handover content.
- **Tighten the LLM prompts with few-shot examples.** The extraction prompt works but adding 2–3 examples of good `sourceText` output would reduce the rate of `UNVERIFIED` flags on ambiguous entries.

---

## One thing that surprised me

The room 312 no-show (guest Lim Boon Heng, a guaranteed booking who never arrived) is a three-night thread with a genuine factual conflict buried in the data: the structured event from Tuesday night says the no-show charge was *not* applied and was left for the morning team to decide. The free-text night log from Wednesday — written by a different relief staffer — says she went ahead and charged it. Then Thursday, the guest calls to dispute the charge.

What's surprising is that this contradiction only becomes visible when you reconcile across all three nights together. Reading any single night in isolation, the picture looks consistent. The conflict only surfaces when you track the full thread — which is exactly the problem that manual handovers miss and exactly what the reconciler is built to catch. It's a good illustration of why cross-night tracking matters more than summarising each night individually.
