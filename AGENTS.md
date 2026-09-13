# Machina — agent context

Machina is a **cross-merchant Product Intelligence Gateway**: an AI shopping agent calls
Machina's MCP server with a natural-language request, and Machina ranks real, competing
merchants' offers for it — deterministically, with a grounded natural-language reason per
result — while enforcing a merchant-controlled disclosure policy on every fact it uses.

Read `skill/SKILL.md` for how to *use* Machina as a calling agent (when to call it, how to
present results, what never to do — it never needs to change when the internals do).

**The single most important thing to understand before touching anything:** the dashboard
and the MCP tools deliberately show two different views of the same data — the dashboard is
the merchant's full-truth view, the MCP tools are the buyer-agent's disclosed-only view. If
you're debugging "why doesn't the agent see X" and X checks out fine in the database, check
its `visibility` tier before assuming a bug — see CONTROL below.

## Repo layout

```
machina/
├── apps/dashboard/     Next.js merchant UI — merchant switcher, demand, gaps, approval
│                        (incl. visibility-tier picker), Validation Lab report.
├── packages/
│   ├── schemas/        Zod schemas: per-vertical ontology loader, status enums, MCP tool
│   │                    I/O, findRepoRoot()
│   ├── database/        SQLite (better-sqlite3) connection + models over the schema in
│   │                    data/schema.sql (merchants → canonical_products → products →
│   │                    variants → offers, product_facts/fact_evidence/fact_decisions,
│   │                    reviews/review_aspects, media_assets, search_requests/results,
│   │                    ranking_impressions/ranking_actions — see The dataset, below)
│   ├── core/            LLM normalization/extraction/classification, deterministic
│   │                    matching/ranking, CONTROL disclosure, offers
│   └── retrieval/       embeddings-based Validation Lab benchmark + report builder
├── mcp/server/          MCP server (stdio, @modelcontextprotocol/sdk) — 4 tools
├── skill/SKILL.md        agent-facing instructions (symlinked into .claude/skills/machina/)
├── data/                 the synthetic 9-merchant dataset (see below)
├── scripts/              one-off migration scripts (ontology generation, dataset reshape)
└── tests/                Vitest (unit, mocked LLM) + tests/mcp-smoke.ts (manual, live)
```

One shared SQLite file at repo root (`machina.db`), used by both `apps/dashboard` and
`mcp/server`. Path resolution for both `machina.db` and `data/` is bundler-proof:
`packages/schemas/src/repoRoot.ts` prefers `MACHINA_REPO_ROOT` (set in
`apps/dashboard/next.config.js` and at the top of `mcp/server/src/index.ts`) and falls back
to walking up from `__dirname` for plain `tsx` execution. The repo-root marker is
`.mcp.json`, deliberately not anything under `data/`.

## Tenancy model — three optional, strictly-nested connection scopes

Resolved once at server startup in `mcp/server/src/index.ts`:

- **Whole database (default — neither env var set)**: `search_products` classifies which
  vertical a given `request_text` is about, per call, via
  `packages/core/src/llm/classifyVertical.ts` (structured-output LLM call, enum-constrained
  to `listVerticals()`'s real, live result — never hardcoded). An ambiguous request gets a
  deterministic `CLARIFICATION_REQUIRED` naming the real categories.
- **Vertical-scoped (`MACHINA_VERTICAL=<vertical>`)**: candidates are every active merchant
  in that vertical; classification is skipped.
- **Merchant-scoped (`MACHINA_MERCHANT_ID=<id>`)**: the narrowest tier — one merchant only.

`.mcp.json`'s default `env` is `{}` (whole database). Ownership/scope checks on any tool
receiving a caller-supplied `product_id` (`get_product_details`, `check_suitability`,
`create_offer`) go through one shared function, `belongsToScope()` in
`packages/core/src/productDetails.ts` — a product outside the connection's current scope is
treated exactly like an unknown id. `packages/schemas`' `loadOntology(vertical)` is
file-based and cached per vertical; which file loads is decided per search call, not once at
startup.

## Running things

```bash
npm install
npm run db:init                    # create/refresh the SQLite schema from data/schema.sql
npm run db:seed                    # bulk-load the 9-merchant dataset (generic JSONL loader,
                                    # packages/database/src/seed.ts) — idempotent
node scripts/migrate-v5-dataset.js # one-off: generates data/ontologies/*.json + reshapes
                                    # running_shoes into 3 competing merchants (M01/M10/M11).
                                    # Already applied to the committed data/ — re-run only if
                                    # you reset data/jsonl/ from the original dataset export.
npm run dev:dashboard               # Next.js dashboard at localhost:3000
npm run mcp:server                  # MCP server over stdio (whole-database by default; set
                                    # MACHINA_VERTICAL or MACHINA_MERCHANT_ID to narrow)
npm run typecheck                   # tsc -b across all packages + mcp/server
npm test                            # vitest — all LLM calls mocked, no API key needed

npx tsx tests/mcp-smoke.ts          # manual: drives the real MCP server over stdio, live API
                                    # calls — needs OPENAI_API_KEY
```

`.mcp.json` at repo root registers the server for any MCP-capable agent (Claude Code, Codex,
etc.) via `npx tsx mcp/server/src/index.ts`. A changed `.mcp.json` or `SKILL.md` is only
picked up by a **fresh** agent session — restart rather than expecting a running session to
hot-load it. The skill is discovered at `.claude/skills/machina/SKILL.md`, a symlink to the
canonical `skill/SKILL.md`.

## Environment

One `.env` at repo root (gitignored, never commit it): `OPENAI_API_KEY=sk-...` — see
`.env.example`. The dashboard, the MCP server, and any new standalone script all self-load it
directly:
```ts
import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '<relative-path-to-repo-root>/.env') });
```

macOS-only build note: `better-sqlite3`'s native module may fail to compile unless `SDKROOT`
is exported explicitly:
```bash
export SDKROOT=$(xcrun --show-sdk-path) && npm rebuild better-sqlite3
```

## The 4 MCP tools (`packages/schemas/src/mcpTools.ts` has the exact Zod shapes)

- **search_products** — `request_text` (+ optional `filters.price_max/currency/availability/delivery_days_max`,
  `merchant_id` to narrow within a vertical-scoped connection, `max_results`, `client.name`)
  → `{ status, clarification_question?, products[] }`. Each product carries `merchant_id`/
  `merchant_name` (results can come from different merchants), `decision_factors` (structured,
  disclosure-filtered reasons), `badge` (`best_overall`/`lowest_price`/`fastest_delivery`/
  `null`), and `reason` (an LLM verbalization of `decision_factors` only — it never decides
  ranking and never states anything not already in `decision_factors`).
- **get_product_details** — `product_id` → title, price, currency, merchant identity,
  approved AGENT_VISIBLE attributes with evidence provenance, `images[]`, and published
  `review_highlights[]`. Also returns the primary product image as a real embedded MCP image
  content block (base64), not just a file-path string, so a calling agent can render it
  inline.
- **check_suitability** — `product_id` + `attribute` + `requested_value` →
  `SUITABLE / NOT_SUITABLE / INSUFFICIENT_DATA`.
- **create_offer** — `product_id` (+ `quantity`) → a mock, non-binding draft offer. **No real
  payment or external call ever happens here.**

Request-level status: `VERIFIED / PARTIAL / INSUFFICIENT_DATA / NO_MATCH /
CLARIFICATION_REQUIRED`. Per-requirement status: `VERIFIED_MATCH / VERIFIED_NON_MATCH /
UNKNOWN`. Evidence tri-state for catalogue attributes: `DIRECT / AMBIGUOUS / NONE`.

## Ranking pipeline (`packages/core/src/matching.ts` + `matchingCore.ts`)

```
classify vertical (only if connection is unscoped)
  -> normalize buyer language -> hard filters -> hybrid candidate retrieval
  -> Stage A: bucket by TRUE verified-requirement-match count (primary key, always)
  -> Stage B: within a bucket, deterministic multi-objective utility
     (price + delivery + trust + semantic similarity, weights in matchingCore.ts)
  -> merchant diversity (cap 2 per merchant by default)
  -> decision_factors + badge (deterministic, disclosure-filtered)
  -> LLM verbalization only (generateReason.ts) — never ranks, never adds a claim
     absent from decision_factors (containment-checked; falls back to a deterministic
     template if it ever fails that check or the API is unavailable)
```

No LLM ever decides result order. Every candidate that survives hard filters — returned or
not — is logged to `ranking_impressions` with its full feature vector (price, delivery,
trust, similarity, utility score, final rank, whether it was returned, whether the diversity
cap excluded it). Nothing trains on this yet; it exists so a future learning-to-rank pass has
real (features, outcome) data. `ranking_actions` links a later `get_product_details`/
`check_suitability`/`create_offer` call back to the impression it followed.

## CONTROL — the disclosure-policy layer (`packages/core/src/disclosurePolicy.ts`)

Every approved fact carries a `visibility` tier, chosen by the merchant at approval time on
the dashboard's Approval page (defaults to `AGENT_VISIBLE`):

- **AGENT_VISIBLE** — raw value, evidence, and true requirement status all flow through, and
  the fact can appear in `decision_factors`.
- **MATCHING_ONLY** — the real value still participates in ranking (it can move a product's
  bucket or its utility inputs), but every agent-facing surface reports it as `UNKNOWN`, and
  it is **omitted entirely** from `decision_factors` — not redacted, absent, so the reasoning
  LLM has no way to reference it even obliquely.
- **INTERNAL_ONLY** — excluded from matching entirely (treated as unavailable even
  internally) and never surfaced agent-facing at all.

`match_status` and the top-level request status are derived from the *disclosed*
requirements, never the true ones. **Live-verified example, still in the database**:
`M01-P0001` is the disclosure-policy fixture: it has `intended_use=daily-trainer`
(MATCHING_ONLY) and `water_resistance=water-resistant` (INTERNAL_ONLY).
`get_product_details` omits both attributes entirely. Its current primary offer is not
eligible for search (`out_of_stock`, zero stock, shipping unavailable), so it is removed by
hard candidate filtering before ranking; use the disclosure-policy unit tests rather than a
live search to verify these tiers while that offer state remains unchanged.

## Invariants — don't casually change these

- **`product_facts` is updated in place; `fact_decisions` is the append-only audit log** of
  every approve/reject transition (an intentional v5 change from the old pure-append-only
  `attribute_log` pattern — this is the schema's own native design, adopted rather than
  fought). Never `UPDATE`/`DELETE` `fact_decisions`. Same append-only rule for
  `experiment_runs`, `search_results`, `ranking_impressions`, `ranking_actions`.
- **Ranking is deterministic**: `matchingCore.ts` holds every comparison/utility/diversity
  function as a pure function (no I/O), unit-testable without an API key. No LLM ever decides
  result order.
- **Evidence extraction never fabricates**: `NONE` status forces `value = null` in code
  (`extractEvidence.ts`), not just in the prompt.
- **Disclosure is enforced in exactly one place**: `disclosurePolicy.ts`, called at the
  response boundary in `matching.ts` — never scattered ad hoc checks elsewhere.
- **Scope ownership is checked in exactly the three tools that take a caller-supplied
  `product_id`**, via the one shared `belongsToScope()` — don't add a new product-id-taking
  tool without the same check.
- **Held-out query set freeze is per merchant**: once locked, cannot be re-seeded or edited.
  (Note: the current 9-merchant dataset ships with no held-out fixtures at all yet — see
  Known limitations, below.)
- **Product display titles**: this dataset's `products.title` already includes the brand
  (e.g. `"Velora Ridge Crest 13"`) — never prepend brand again.

## The dataset

`data/` holds a synthetic 9-merchant, 9-vertical dataset (`data/SOURCE_README.md` has the
full provenance note — entirely synthetic, never present it as real commercial data):
running_shoes, travel_backpacks, wireless_headphones, coffee_makers, facial_skincare,
desk_lamps, water_bottles, yoga_mats, wristwatches — one merchant each, **except
running_shoes**, which was reshaped (`scripts/migrate-v5-dataset.js`) into 3 competing
merchants (M01 Velora Runworks, M10 Ridgemark Trailhead, M11 Solace Track Supply) sharing
canonical products at different prices/delivery/stock, so cross-merchant ranking has
something real to demonstrate. `data/assets/products/<id>/*.webp` holds real product images
(~71MB) referenced by `media_assets` and embedded live by `get_product_details`.

## Known limitations (honest, not hidden)

- **The Validation Lab / Report page has no held-out query fixtures for this dataset.**
  Freezing/benchmarking will report "need both a baseline and an enriched run" until someone
  authors held-out queries + ground truth for these merchants — this is a data-authoring gap,
  not a code bug. The Report page itself renders correctly and degrades gracefully.
- **Live demand aggregation** (the Dashboard's "what agents are asking for" panel) is derived
  from `search_requests`/`ranking_impressions`, scoped to one vertical's merchants — it only
  reflects live MCP traffic, not the old dataset's pre-seeded historical request log (which
  no longer exists in this schema).
- Only `running_shoes` currently has real multi-merchant competition; the other 8 verticals
  are reachable (whole-database scope resolves them fine) but single-merchant, so ranking
  diversity/badges won't visibly differ there.
