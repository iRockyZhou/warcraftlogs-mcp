# Architecture

`warcraftlogs-mcp` separates transport, API reliability, evidence normalization, and product tools so each layer can be tested without live credentials.

```text
MCP client
  -> SDK v2 tool schemas and stdio transport
  -> WclService orchestration and fight/player resolution
  -> local active-character/subscription state
  -> bounded table/event normalization
  -> WclClient retry and error policy
  -> client-token cache or user OAuth token
  -> allow-listed Warcraft Logs API v2 origin
```

## URL and endpoint boundary

`parseWclUrl` uses the platform URL parser and then validates protocol, credentials, port, exact hostname, path shape, report code, and fight selector. The caller never supplies an API or OAuth endpoint. A validated region selects one of two constants:

```text
https://www.warcraftlogs.com
https://cn.warcraftlogs.com
```

This design rejects suffix/prefix look-alike hosts, user-info tricks, alternate ports, and arbitrary caller-selected endpoints before any network call. Fetch redirect following is disabled for both OAuth and GraphQL requests.

## Authentication and requests

`WclAuth` caches client-credentials tokens separately per origin. A promise map deduplicates simultaneous token misses. Tokens expire slightly early to avoid racing the server's expiry boundary.

The access selector has three modes. `public` always uses `/api/v2/client`; `user` requires a valid user token and uses `/api/v2/user`; `auto` uses valid user authorization when present and otherwise uses the public endpoint. A rejected user token in `auto` mode falls back to public data once, while explicit `user` mode returns `USER_AUTH_REQUIRED`.

Authorization-code login binds an HTTP callback only on a loopback hostname, validates a random state value, exchanges the code directly with WCL, and persists the resulting user token with restrictive filesystem permissions. WCL does not document refresh tokens, so an expired user grant requires login again.

OAuth and GraphQL requests share the same bounded network policy: short `Retry-After` handling, exponential retry for transient failures, timeouts, and structured terminal errors.

`WclClient` owns request reliability:

- one forced token refresh after a 401;
- one short `Retry-After` retry after a 429;
- configurable exponential backoff for network, timeout, and 5xx failures;
- immediate structured failures for long rate-limit delays, 403, 404, invalid JSON, and GraphQL errors;
- no request variables, bearer tokens, or client secrets in returned errors.

## Runtime type boundary

GraphQL HTTP envelopes are treated as `unknown`. Structured report, fight, actor, pull, talent, table, and event envelopes are parsed with Zod before they enter the service layer. WCL's `JSON` scalar remains deliberately semi-structured: normalizing every possible combat field would create a brittle false contract.

## Tables and filter semantics

Friendly table tools accept a single `playerID` and map it to the WCL argument that answers the product question:

| Data                                                        | Player filter |
| ----------------------------------------------------------- | ------------- |
| Damage Done, Casts, Interrupts, Dispels, Healing, Resources | `sourceID`    |
| Damage Taken, Deaths, Buffs, Debuffs                        | `targetID`    |

Table JSON is preserved, but nested arrays are capped and the result must fit a serialized byte budget. The response reports original/returned entry counts and truncation state.

## Event pagination

Events are always constrained to one selected fight and a valid relative time window. Each request also has:

- a hard maximum event count;
- WCL page size and maximum page count;
- a final serialized byte budget;
- a continuation cursor.

When a byte budget cuts a page, the timestamp of the first unreturned event becomes an inclusive cursor and `cursorMayRepeat` is set. Inclusive continuation can repeat events at the timestamp boundary, but avoids silent loss; consumers can deduplicate boundary events.

## High-level evidence

`get_mythic_plus_summary` joins fight metadata, master actors, and four small tables. Non-essential tables use `Promise.allSettled`; missing damage/healing/death/interrupt evidence appears as a warning instead of erasing the whole summary.

`get_player_analysis_context` follows the same best-effort pattern for damage, casts, damage taken, interrupts, deaths, buffs, resources, CombatantInfo, and the talent import code. Per-component entry/byte limits feed an aggregate byte budget; later components are omitted with warnings before the result can cross that budget.

Tool results carry the complete evidence once in MCP `structuredContent`; the text block is intentionally a short compatibility notice. This avoids doubling large tables and event windows on the wire.

The core does not encode Retribution Paladin or other specialization heuristics. Future analysis packs should consume this stable evidence contract and remain optional.

## Character discovery and subscriptions

Character names, realm names, and regions are normalized into a stable identity. `set_active_character` validates that identity against WCL before atomically persisting it. Character discovery exposes recent reports and encounter or zone rankings without mixing these queries into report-analysis code.

`get_character_deaths` and `get_character_casts` are bounded compound queries: they discover at most ten recent reports, resolve the character's report actor ID independently in each report, apply target semantics for deaths and source semantics for casts, and collect per-report tables with partial-failure warnings. Per-table limits feed a final aggregate byte budget.

A subscription is a local pull cursor containing the latest report start time plus every report code at that timestamp. This boundary set prevents duplicates without dropping two reports that share a start time. `auto` is resolved to `public` or `user` when the subscription is created, so an expired private grant cannot silently advance the cursor using public-only results. Checks are serialized in process and state files are replaced atomically. Individual subscription failures are returned alongside successful checks instead of aborting the batch.

The stdio server does not run a background notifier. A live MCP client or external scheduler must invoke `check_character_subscriptions` periodically.

## Testing strategy

- Unit tests cover URL security, both OAuth flows, secure state persistence, character normalization, token caching, retry/error policy, fight selection, and table normalization.
- Mock integration tests exercise HTTP -> GraphQL envelope -> service aggregation and pagination.
- An MCP in-memory transport test lists all tools and invokes native and compatibility wrappers to verify source/target variables on real tool calls.
- A live smoke test is optional because it requires user-owned credentials: `pnpm smoke -- '<report-url>'`.
