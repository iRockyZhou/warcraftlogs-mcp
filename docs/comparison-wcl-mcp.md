# Comparison with `wcl-mcp`

This is a dated engineering comparison, not a claim about every future version. The reference was [`vinylflamingo/wcl-mcp` at commit `6d9bf54`](https://github.com/vinylflamingo/wcl-mcp/tree/6d9bf54ec5194a016a0e2aa92e1502f3318bfb14), reviewed on 2026-09-09.

`wcl-mcp` established a useful character-first workflow and ships convenient prompt/resource examples. `warcraftlogs-mcp` implements its 13 core tool workflows while adding report-level analysis, stronger API boundaries, and three-visibility authorization.

| Area                                 | Reference `wcl-mcp`              | `warcraftlogs-mcp` 0.2.0                                                         |
| ------------------------------------ | -------------------------------- | -------------------------------------------------------------------------------- |
| Core character/report tool workflows | 13 tools                         | Covered, including compatibility aliases                                         |
| Total tools                          | 13                               | 38                                                                               |
| Public reports                       | Yes                              | Yes                                                                              |
| Direct unlisted reports              | No explicit `allowUnlisted` path | Yes, direct code/URL by default                                                  |
| Private reports                      | Client credentials only          | User OAuth and `/api/v2/user`                                                    |
| CN reports/characters                | Not in the documented region set | Native `cn.warcraftlogs.com` routing                                             |
| Active character                     | Process session                  | Validated and atomically persisted                                               |
| Character subscriptions              | No                               | Durable pull cursor with duplicate-boundary protection                           |
| Events                               | Fixed query limit                | Time window, count, page, cursor, and byte budgets                               |
| High-level evidence                  | Fight summary                    | Mythic+ summary plus best-effort player analysis context                         |
| Failure isolation                    | Tool-level errors                | Component warnings inside high-level aggregation                                 |
| API response validation              | TypeScript interfaces            | Zod runtime validation at GraphQL boundaries                                     |
| URL/network boundary                 | WCL client endpoint              | Exact global/CN host allow-list, no caller-selected endpoint, redirects disabled |
| Built-in prompts/resources           | Yes                              | No season-specific knowledge; models consume stable evidence                     |

## What “core compatibility” means

The following reference workflows are present: active character, character summary, recent reports, fight summary, damage, healing, damage taken, cross-report character deaths and casts, buff uptime, combatant info, encounter/zone rankings, and bounded fight events.

Compatibility aliases keep familiar tool names, but the project does not promise byte-for-byte argument or response compatibility. Its native tools use explicit report actor IDs and structured evidence to avoid ambiguous character matching inside combat tables.

## Product position

The durable advantage is not a larger tool count. It is the separation between stable evidence acquisition and model judgment:

- low-level tables/events remain inspectable and bounded;
- high-level tools compress routine evidence without hiding warnings;
- private authorization is opt-in and revocable;
- class/spec recommendations stay outside the connector, so they can evolve without coupling API correctness to a game patch.
