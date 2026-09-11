# warcraftlogs-mcp

An open-source Model Context Protocol server that gives AI clients reliable, bounded, and analysis-friendly access to [Warcraft Logs](https://www.warcraftlogs.com/) reports.

> **Community project:** `warcraftlogs-mcp` is not affiliated with, endorsed by, or maintained by Warcraft Logs, Archon, Blizzard Entertainment, or the Model Context Protocol project.

The server retrieves evidence from the official Warcraft Logs GraphQL API v2. It deliberately does not hard-code class or specialization advice: the MCP layer handles authentication, filtering, normalization, pagination, and context budgets; the consuming model decides what the combat evidence means.

## Highlights

- Public and unlisted reports through client credentials, plus private reports through opt-in user OAuth.
- In-memory client-token caching with concurrent request deduplication and securely persisted user tokens.
- Automatic one-time token refresh after a 401.
- Structured 403, 404, GraphQL, timeout, network, and server errors.
- `Retry-After` aware 429 handling: short waits retry once; long waits fail quickly.
- Exact host allow-list for `www.warcraftlogs.com` and `cn.warcraftlogs.com`; no arbitrary fetch URL or SSRF surface.
- Correct player filter direction for the built-in table tools.
- Bounded event pagination with time-window, event-count, page-count, and byte limits.
- Compact Mythic+ and player-analysis tools with best-effort evidence collection.
- Character discovery, persistent active-character defaults, rankings, and pull-based report subscriptions.
- Coverage of the core `wcl-mcp` workflows, with compatibility aliases backed by the same safety budgets.
- Strict TypeScript, runtime response validation, Vitest integration tests, ESLint, Prettier, and a publish-ready npm package.

See the [dated comparison with `wcl-mcp`](docs/comparison-wcl-mcp.md) for the compatibility scope and trade-offs.

## Requirements

- Node.js 20 or newer. Node.js 24 is used in CI and recommended for development.
- A Warcraft Logs API client ID and secret. Create an API client from the [Warcraft Logs client management page](https://www.warcraftlogs.com/api/clients/).

Register `http://127.0.0.1:8765/callback` as an OAuth redirect URI if you want private-report access. Client credentials remain sufficient for public and directly linked unlisted reports.

For CN players, WCL currently cannot link a China Battle.net account. A practical cross-region setup is to link a supported Battle.net region (for example Taiwan) to the same WCL account, create a **V2** API client, and then run `auth login cn`. The resulting client credentials and CN user authorization have been verified against `cn.warcraftlogs.com`; a legacy V1 client key is not a substitute for the V2 client secret.

## Install and run

Once published to npm:

```bash
npx -y warcraftlogs-mcp@latest
```

From a local checkout:

```bash
pnpm install
pnpm build
WCL_CLIENT_ID=... WCL_CLIENT_SECRET=... node dist/cli.mjs
```

The default command starts stdio transport. Standard output is reserved for MCP JSON-RPC; operational messages go to standard error.

Example MCP client configuration:

```json
{
  "mcpServers": {
    "warcraftlogs": {
      "command": "npx",
      "args": ["-y", "warcraftlogs-mcp@latest"],
      "env": {
        "WCL_CLIENT_ID": "your_client_id",
        "WCL_CLIENT_SECRET": "your_client_secret"
      }
    }
  }
}
```

Do not commit credentials to a repository or place them in prompts.

## Report visibility and authorization

All three Warcraft Logs visibility modes are supported:

| Visibility | How this server accesses it                       | Important boundary                                                                                                 |
| ---------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Public     | Client credentials or user OAuth                  | Discoverable through normal WCL surfaces.                                                                          |
| Unlisted   | Direct report URL/code with `allowUnlisted: true` | The report code acts like a share-link secret; character subscriptions do not discover it through public listings. |
| Private    | User OAuth and `/api/v2/user`                     | Only reports visible to the account that approved access can be read.                                              |

Authorize the global or CN site separately:

```bash
warcraftlogs-mcp auth login global
warcraftlogs-mcp auth login cn
warcraftlogs-mcp auth status
warcraftlogs-mcp auth logout global
```

`auth login` prints the official WCL authorization URL and waits up to 15 minutes on a loopback-only callback. Keep that command running until the browser returns to `127.0.0.1`; if the command has stopped, the old callback page will show `ERR_CONNECTION_REFUSED` and you must start a fresh login. The completion page removes the one-time authorization code from the visible URL and disables caching/referrers. The token is written atomically under `~/.config/warcraftlogs-mcp/auth.json` with mode `0600`; its directory is forced to `0700`. The token is never returned by an MCP tool. WCL does not document refresh tokens for this flow, so repeat `auth login` after expiry.

Report tools expose `accessMode`:

- `auto` (default): use user authorization when a valid token is configured, otherwise use the public endpoint.
- `public`: never send a user token.
- `user`: require a valid user token and return `USER_AUTH_REQUIRED` if it is missing or rejected.

## Doctor command

Check Node, client credentials, the public GraphQL endpoint, every configured user token, and optionally a report:

```bash
warcraftlogs-mcp doctor
warcraftlogs-mcp doctor 'https://cn.warcraftlogs.com/reports/gDBTZr6pz1AvnxbW?fight=1'
```

Other CLI commands:

```bash
warcraftlogs-mcp --help
warcraftlogs-mcp --version
warcraftlogs-mcp serve
```

## Recommended AI workflow

For a normal report review:

```text
parse_wcl_url
  -> list_fights
  -> list_players
  -> get_mythic_plus_summary or get_player_analysis_context
  -> get_events only for a narrow follow-up question
```

Avoid starting with all combat events. Tables and high-level tools are much smaller and usually contain enough evidence to decide which event window is worth inspecting.

For character-first use:

```text
set_active_character
  -> get_character_summary or get_recent_reports
  -> get_fight_summary / get_player_analysis_context
```

For subscriptions:

```text
subscribe_character
  -> check_character_subscriptions periodically
  -> analyze only reports returned as new
```

Subscriptions are durable pull cursors stored locally. A stdio MCP process cannot wake a closed AI client, so this server does not claim background push delivery. Your MCP client or scheduler must call `check_character_subscriptions`; repeated checks do not return the same report again.

## Tools

| Tool                            | Purpose                                                               |
| ------------------------------- | --------------------------------------------------------------------- |
| `parse_wcl_url`                 | Parse and validate a supported report URL and fight selector.         |
| `get_report`                    | Report metadata, visibility, zone, timestamps, and archive status.    |
| `list_fights`                   | Fights plus raid/Mythic+ metadata.                                    |
| `list_players`                  | Player actor IDs, fight participation, specs, and item levels.        |
| `list_dungeon_pulls`            | Mythic+ pull time windows, locations, maps, and enemy IDs.            |
| `get_talent_import_code`        | Retail talent import code for a player/fight.                         |
| `get_damage_done`               | Damage table; `playerID` maps to `sourceID`.                          |
| `get_damage_taken`              | Damage-taken table; `playerID` maps to `targetID`.                    |
| `get_casts`                     | Cast table; `playerID` maps to `sourceID`.                            |
| `get_interrupts`                | Interrupt table; `playerID` maps to `sourceID`.                       |
| `get_deaths`                    | Death table; `playerID` maps to `targetID`.                           |
| `get_buffs`                     | Buff uptime on the player; `playerID` maps to `targetID`.             |
| `get_debuffs`                   | Debuffs on the player; `playerID` maps to `targetID`.                 |
| `get_dispels`                   | Dispels performed; `playerID` maps to `sourceID`.                     |
| `get_healing`                   | Healing performed; `playerID` maps to `sourceID`.                     |
| `get_resources`                 | Resource evidence; `playerID` maps to `sourceID`.                     |
| `get_combatant_info`            | Bounded CombatantInfo events for a player source.                     |
| `get_events`                    | Advanced bounded event retrieval with pagination and byte protection. |
| `get_mythic_plus_summary`       | Key, duration, enemy forces, DPS/HPS, deaths, and interrupts.         |
| `get_player_analysis_context`   | Best-effort bundle of evidence for one player.                        |
| `set_active_character`          | Validate and persist character defaults.                              |
| `get_active_character`          | Read the active character without a network call.                     |
| `clear_active_character`        | Remove the active-character default.                                  |
| `get_character_summary`         | Character profile and recent WCL presence.                            |
| `get_recent_reports`            | Paginated recent reports with raid/Mythic+ filtering.                 |
| `get_encounter_rankings`        | Encounter or zone rankings; optionally includes private logs.         |
| `subscribe_character`           | Create a persistent report-discovery cursor.                          |
| `list_character_subscriptions`  | List local subscriptions and cursors.                                 |
| `check_character_subscriptions` | Poll for new reports and atomically advance cursors.                  |
| `unsubscribe_character`         | Remove a local subscription.                                          |
| `get_fight_summary`             | Generic raid/Mythic+ summary with explicit content type and location. |

Core `wcl-mcp` compatibility names are also registered: `get_fight_damage`, `get_fight_healing`, `get_fight_damage_taken`, `get_character_deaths`, `get_character_casts`, `get_buff_uptime`, and `get_fight_events`. The character death/cast tools discover and scan up to ten recent reports with partial-failure warnings and an aggregate byte budget; the other compatibility tools use the same validated, bounded implementation as the native tools.

Every data tool accepts either a report code or a full supported report URL. A full URL preserves its global/CN origin and can supply `?fight=1`, `#fight=1`, or `fight=last`. For a bare report code, `region` defaults to `global` and can be set to `cn`.

### Source and target semantics

The friendly `playerID` argument removes a common WCL integration mistake:

- WCL player/source perspective: Damage Done, Damage Taken, Casts, Interrupts, Deaths, Dispels, Healing, Resources, and CombatantInfo.
- Target: Buffs and Debuffs.

This is deliberately data-type-aware. For current WCL table/event APIs, `sourceID` selects the player whose Damage Taken or Deaths view is requested, even though the returned raw combat event identifies that player as `targetID`. Buff and debuff questions still use `targetID` to mean the affected player. The low-level `get_events` tool exposes both filters for advanced investigations, but callers should interpret them in the context of `dataType` rather than assuming raw event-field direction.

### Event pagination and budgets

`get_events` defaults to 300 events and has hard limits for events, WCL pages, and serialized bytes. `get_player_analysis_context` also has a 600 KB aggregate default and omits later components with warnings before crossing that budget. Continue an event response with:

```text
cursor = pagination.nextPageTimestamp
```

If a byte limit stops part-way through a WCL page, `cursorMayRepeat` is true. The cursor is inclusive so the next call does not silently lose same-timestamp events; callers should deduplicate repeated boundary events.

## Configuration

| Variable                     |                          Default | Meaning                                   |
| ---------------------------- | -------------------------------: | ----------------------------------------- |
| `WCL_CLIENT_ID`              |           required for API calls | OAuth client ID.                          |
| `WCL_CLIENT_SECRET`          |           required for API calls | OAuth client secret.                      |
| `WCL_USER_ACCESS_TOKEN`      |               stored login token | Optional global-site user token override. |
| `WCL_CN_USER_ACCESS_TOKEN`   |               stored login token | Optional CN-site user token override.     |
| `WCL_OAUTH_REDIRECT_URI`     | `http://127.0.0.1:8765/callback` | Registered loopback callback.             |
| `WCL_OAUTH_LOGIN_TIMEOUT_MS` |                         `900000` | Maximum interactive login wait.           |
| `WCL_STATE_DIR`              |     `~/.config/warcraftlogs-mcp` | Private auth and subscription state.      |
| `WCL_REQUEST_TIMEOUT_MS`     |                          `15000` | Per-request timeout.                      |
| `WCL_MAX_RETRIES`            |                              `2` | Retries for network/timeout/5xx failures. |
| `WCL_MAX_RETRY_AFTER_MS`     |                           `2000` | Longest 429 delay the process will wait.  |

`parse_wcl_url` and tool discovery still work without credentials. API calls return a structured `CONFIG_ERROR` until both credentials are configured.

## Privacy and information flow

The MCP sends only requested WCL evidence to the connected MCP client. It has no telemetry, analytics, remote database, or arbitrary URL fetcher. It does not make battle logs private: an unlisted report code is a bearer-style share secret, and private report contents become visible to the connected AI client after user authorization. Protect report codes and configure the AI host according to your acceptable retention and training policy.

See [Privacy and threat model](docs/privacy.md) for the complete data flow, stored fields, trust boundaries, and hardening guidance.

## Development

```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
npm pack --dry-run
```

See [CONTRIBUTING.md](CONTRIBUTING.md), [the architecture](docs/architecture.md), and [the publishing guide](docs/publishing.md).

## Current limitations

- User OAuth tokens are not refreshable because WCL does not document refresh tokens for this flow; re-run `auth login` after expiry.
- Character subscriptions are pull-based and discover only reports returned by WCL's `recentReports`; they cannot discover an unlisted report that WCL omits from listings.
- A single subscription check fetches the latest 100 reports. If more than 100 new reports appear between checks, older reports can be missed; poll at a sensible interval.
- Warcraft Logs table and event payloads are semi-structured JSON and can change. Stable outer fields are runtime-validated; table/event evidence is preserved and bounded rather than over-modeled.
- Enemy forces are present only when WCL exposes `countReached` and `countRequired` for the selected fight.
- The server provides evidence, not a simulator, ranking percentile engine, or specialization-specific rotation evaluator.
- HTTP hosting and background push notifications are not included; the supported transport is local stdio.

## License

[MIT](LICENSE)
