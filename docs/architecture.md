# Architecture

`warcraftlogs-mcp` separates transport, API reliability, evidence normalization, and product tools so each layer can be tested without live credentials.

```text
MCP client
  -> SDK v2 tool schemas and stdio transport
  -> WclService orchestration and fight/player resolution
  -> bounded table/event normalization
  -> WclClient retry and error policy
  -> WclAuth in-memory token cache
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

`WclAuth` caches tokens separately per origin. A promise map deduplicates simultaneous token misses. Tokens expire slightly early to avoid racing the server's expiry boundary.

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

`get_player_analysis_context` follows the same best-effort pattern for damage, casts, damage taken, interrupts, deaths, buffs, resources, CombatantInfo, and the talent import code. Per-component entry and byte budgets keep the aggregate context bounded.

Tool results carry the complete evidence once in MCP `structuredContent`; the text block is intentionally a short compatibility notice. This avoids doubling large tables and event windows on the wire.

The core does not encode Retribution Paladin or other specialization heuristics. Future analysis packs should consume this stable evidence contract and remain optional.

## Testing strategy

- Unit tests cover URL security, token caching, retry/error policy, fight selection, and table normalization.
- Mock integration tests exercise HTTP -> GraphQL envelope -> service aggregation and pagination.
- An MCP in-memory transport test lists tools and invokes wrappers to verify source/target variables on real tool calls.
- A live smoke test is optional because it requires user-owned credentials: `pnpm smoke -- '<report-url>'`.
