# warcraftlogs-mcp

An open-source Model Context Protocol server that gives AI clients reliable, bounded, and analysis-friendly access to [Warcraft Logs](https://www.warcraftlogs.com/) reports.

> **Community project:** `warcraftlogs-mcp` is not affiliated with, endorsed by, or maintained by Warcraft Logs, Archon, Blizzard Entertainment, or the Model Context Protocol project.

The server retrieves evidence from the official Warcraft Logs GraphQL API v2. It deliberately does not hard-code class or specialization advice: the MCP layer handles authentication, filtering, normalization, pagination, and context budgets; the consuming model decides what the combat evidence means.

## Highlights

- Warcraft Logs OAuth client-credentials flow with an in-memory token cache and concurrent request deduplication.
- Automatic one-time token refresh after a 401.
- Structured 403, 404, GraphQL, timeout, network, and server errors.
- `Retry-After` aware 429 handling: short waits retry once; long waits fail quickly.
- Exact host allow-list for `www.warcraftlogs.com` and `cn.warcraftlogs.com`; no arbitrary fetch URL or SSRF surface.
- Correct player filter direction for the built-in table tools.
- Bounded event pagination with time-window, event-count, page-count, and byte limits.
- Compact Mythic+ and player-analysis tools with best-effort evidence collection.
- Strict TypeScript, runtime response validation, Vitest integration tests, ESLint, Prettier, and a publish-ready npm package.

## Requirements

- Node.js 20 or newer. Node.js 24 is used in CI and recommended for development.
- A Warcraft Logs API client ID and secret. Create an API client from the [Warcraft Logs client management page](https://www.warcraftlogs.com/api/clients/).

The client-credentials flow can read public reports. Private reports require a user authorization flow and are intentionally outside v0.1.0.

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

## Doctor command

Check Node, credentials, OAuth, the GraphQL endpoint, and optionally a report:

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

## Tools

| Tool                          | Purpose                                                               |
| ----------------------------- | --------------------------------------------------------------------- |
| `parse_wcl_url`               | Parse and validate a supported report URL and fight selector.         |
| `get_report`                  | Report metadata, visibility, zone, timestamps, and archive status.    |
| `list_fights`                 | Fights plus raid/Mythic+ metadata.                                    |
| `list_players`                | Player actor IDs, fight participation, specs, and item levels.        |
| `list_dungeon_pulls`          | Mythic+ pull time windows, locations, maps, and enemy IDs.            |
| `get_talent_import_code`      | Retail talent import code for a player/fight.                         |
| `get_damage_done`             | Damage table; `playerID` maps to `sourceID`.                          |
| `get_damage_taken`            | Damage-taken table; `playerID` maps to `targetID`.                    |
| `get_casts`                   | Cast table; `playerID` maps to `sourceID`.                            |
| `get_interrupts`              | Interrupt table; `playerID` maps to `sourceID`.                       |
| `get_deaths`                  | Death table; `playerID` maps to `targetID`.                           |
| `get_buffs`                   | Buff uptime on the player; `playerID` maps to `targetID`.             |
| `get_debuffs`                 | Debuffs on the player; `playerID` maps to `targetID`.                 |
| `get_dispels`                 | Dispels performed; `playerID` maps to `sourceID`.                     |
| `get_healing`                 | Healing performed; `playerID` maps to `sourceID`.                     |
| `get_resources`               | Resource evidence; `playerID` maps to `sourceID`.                     |
| `get_combatant_info`          | Bounded CombatantInfo events for a player source.                     |
| `get_events`                  | Advanced bounded event retrieval with pagination and byte protection. |
| `get_mythic_plus_summary`     | Key, duration, enemy forces, DPS/HPS, deaths, and interrupts.         |
| `get_player_analysis_context` | Best-effort bundle of evidence for one player.                        |

Every data tool accepts either a report code or a full supported report URL. A full URL preserves its global/CN origin and can supply `?fight=1`, `#fight=1`, or `fight=last`. For a bare report code, `region` defaults to `global` and can be set to `cn`.

### Source and target semantics

The friendly `playerID` argument removes a common WCL integration mistake:

- Source: Damage Done, Casts, Interrupts, Dispels, Healing, Resources, and CombatantInfo.
- Target: Damage Taken, Deaths, Buffs, and Debuffs.

The low-level `get_events` tool exposes explicit `sourceID` and `targetID` because event investigations sometimes need either direction.

### Event pagination and budgets

`get_events` defaults to 300 events and has hard limits for events, WCL pages, and serialized bytes. Continue a response with:

```text
cursor = pagination.nextPageTimestamp
```

If a byte limit stops part-way through a WCL page, `cursorMayRepeat` is true. The cursor is inclusive so the next call does not silently lose same-timestamp events; callers should deduplicate repeated boundary events.

## Configuration

| Variable                 |                Default | Meaning                                   |
| ------------------------ | ---------------------: | ----------------------------------------- |
| `WCL_CLIENT_ID`          | required for API calls | OAuth client ID.                          |
| `WCL_CLIENT_SECRET`      | required for API calls | OAuth client secret.                      |
| `WCL_REQUEST_TIMEOUT_MS` |                `15000` | Per-request timeout.                      |
| `WCL_MAX_RETRIES`        |                    `2` | Retries for network/timeout/5xx failures. |
| `WCL_MAX_RETRY_AFTER_MS` |                 `2000` | Longest 429 delay the process will wait.  |

`parse_wcl_url` and tool discovery still work without credentials. API calls return a structured `CONFIG_ERROR` until both credentials are configured.

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

- v0.1.0 supports public reports through OAuth client credentials; private-report user authorization is not implemented.
- Warcraft Logs table and event payloads are semi-structured JSON and can change. Stable outer fields are runtime-validated; table/event evidence is preserved and bounded rather than over-modeled.
- Enemy forces are present only when WCL exposes `countReached` and `countRequired` for the selected fight.
- The server provides evidence, not a simulator, ranking percentile engine, or specialization-specific rotation evaluator.
- HTTP hosting is not included in v0.1.0; the supported transport is local stdio.

## License

[MIT](LICENSE)
