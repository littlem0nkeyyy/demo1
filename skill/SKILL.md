---
name: machina
description: Use when a user wants product discovery from a Machina-connected merchant — searching a verified catalogue, checking whether a specific product suits a requirement, or creating a draft offer. Also use for vague, gift, or occasion-based shopping requests ("something nice for my mom") — Machina can classify the right category itself or ask what's actually available. Teaches how to call the Machina MCP tools correctly; does not itself search anything.
---

# Machina skill

Machina is a merchant-side MCP product discovery and catalogue intelligence layer. This
skill does not search products — it teaches you (the calling agent) when to call Machina,
which tool to call, what to send, how to handle each result status, and how to present
evidence honestly. The Machina MCP server is the only source of truth for product
discovery; you never search, rank, or invent product facts yourself.

## When to call Machina

Call Machina whenever there's a reasonable chance the request could be satisfied by a real
merchant's catalogue — including vague, occasion-based, or gift-style requests ("something
nice for my mom", "a birthday present for my daughter"). **Do not pre-filter based on
whether the user named a specific product or category** — Machina's own connection now
spans every category it carries and will classify which one a request is about, or return
`CLARIFICATION_REQUIRED` naming its real categories if it can't. That grounded answer (a
real list of what this merchant network actually sells) is more useful than a generic
gift-idea list assembled from general knowledge, which may suggest things no connected
merchant carries at all.

Only skip Machina for requests clearly unrelated to shopping (general knowledge questions,
non-product requests, etc.). When genuinely unsure, call it — the worst case is a
`CLARIFICATION_REQUIRED` you relay to the user, not a wrong answer.

## What to send

Send only the shopping requirement needed for the tool call — never the user's full
conversation history, your own hidden reasoning, or unrelated personal data. Machina
performs its own canonical intent normalization from `request_text`; anything you infer
client-side is a hint at best, never authoritative.

```json
{
  "request_text": "I need a roomy shoe for long road runs under 4 million VND because my feet roll inward.",
  "filters": { "price_max": 4000000, "currency": "VND", "availability": "in_stock", "delivery_days_max": 5 },
  "max_results": 5,
  "client": { "name": "<your agent name>" }
}
```

## The four tools

- **search_products** — natural-language request → ranked candidate products with
  per-requirement match detail.
- **get_product_details** — one product → its approved structured attributes plus
  provenance (evidence text and source).
- **check_suitability** — one product + one requirement → `SUITABLE` / `NOT_SUITABLE` /
  `INSUFFICIENT_DATA`.
- **create_offer** — create a non-binding, structured draft offer. No real payment occurs;
  do not describe it to the user as a completed purchase.

## Handling result statuses — do this exactly

**Request-level status** (`search_products`):

| Status | What it means | What you do |
|---|---|---|
| `VERIFIED` | At least one returned product has every requested requirement confirmed by approved evidence | Present it as verified, citing which requirements were confirmed |
| `PARTIAL` | Some requirements matched, some are unknown | Explain the verified and unknown requirements **separately** — never merge them into one confident claim |
| `INSUFFICIENT_DATA` | Machina cannot responsibly determine suitability for anything found | Do not recommend as confirmed suitable; say what's missing |
| `NO_MATCH` | No product satisfies the hard filters/requirements | Say so plainly; suggest relaxing a filter if appropriate |
| `CLARIFICATION_REQUIRED` | The request is too ambiguous to search safely | Ask the user the `clarification_question` Machina supplied — do not guess and search anyway |

**Per-requirement status** (inside every product result):

| Status | Meaning |
|---|---|
| `VERIFIED_MATCH` | Approved evidence confirms this requirement |
| `VERIFIED_NON_MATCH` | Approved evidence confirms the product does **not** meet this requirement |
| `UNKNOWN` | No approved evidence either way — **this is not the same as a non-match** |

**Never upgrade `PARTIAL` to `VERIFIED`, and never treat `UNKNOWN` as either a match or a
non-match.** If a product is `PARTIAL`, say plainly which requirements are confirmed and
which are unknown, e.g.:

> "I found a partial match under your budget. The product has verified evidence for wide
> fit and road use, but Machina does not currently have approved evidence confirming
> overpronation support."

## Ranking

Machina's MCP server owns ranking — deterministic given the same inputs (hard filters +
verified attribute matching + a multi-objective utility blending price/delivery/trust/
similarity, plus a merchant-diversity step). Never re-rank, re-order, or second-guess the
order Machina returns; present results in the order given.

Search results can now include products from **different merchants** within the same
vertical — always say which merchant/store a product is from when presenting options, don't
assume they're all the same seller.

## Using `reason` and `decision_factors`

Each product result may include a `badge` (`best_overall` / `lowest_price` /
`fastest_delivery` / `null`), a `decision_factors` array, and a `reason` string. `reason` is
Machina's own grounded explanation, generated only from `decision_factors` — **use it
verbatim or lightly paraphrased**. Do not construct your own separate justification from
attributes or values that aren't present in `decision_factors` or the disclosed
`requirements` — Machina may know more about a product than it discloses (see the tri-state
section above), and inventing a reason risks stating something Machina deliberately didn't
confirm to you.

## Proceeding to an offer

If the user wants to proceed with a specific product, call `create_offer` with that
product's `product_id`. Make clear to the user that this creates a draft, non-binding offer
only — no payment or checkout has occurred in this MVP.

## Evidence and honesty

- Use only the evidence Machina supplies. Never invent, assume, or fill in a missing
  product fact yourself.
- When citing evidence, quote what `get_product_details` or `search_products` actually
  returned — don't paraphrase into a stronger claim than the evidence supports.
