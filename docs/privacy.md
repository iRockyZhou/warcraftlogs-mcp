# Privacy and threat model

`warcraftlogs-mcp` is a local data connector, not a privacy boundary between Warcraft Logs and the AI client that invokes it. Once a tool returns report evidence, that evidence is available to the MCP host and to any model or service the host sends it to.

## Data flow

```text
WCL credentials or user approval
  -> local warcraftlogs-mcp process
  -> allow-listed Warcraft Logs OAuth and GraphQL endpoints
  -> bounded, normalized tool result
  -> configured MCP client and its model provider
```

The server itself has no analytics, telemetry, hosted database, or outbound destination other than the fixed WCL global/CN origins. HTTP redirects are disabled. User-supplied report URLs are parsed locally and must match the exact supported hosts.

## Data stored locally

The state directory contains:

- `auth.json`: user OAuth access tokens and their expiry timestamps;
- `state.json`: the active character, subscription identities, and report discovery cursors.

Writes are atomic. The state directory is mode `0700`, and files are mode `0600`. Client credentials are never copied into these files; by default they remain in environment variables. User tokens can also be supplied only through environment variables, which override stored tokens.

Neither OAuth tokens nor client secrets are included in MCP results, logs, or normalized errors. `auth status` reports only whether tokens exist and their expiry timestamps.

## Visibility-specific risks

- Public reports are already discoverable on WCL, but player names, guild names, timestamps, performance, talents, and gear can still be personal data in context.
- Unlisted reports are accessible to anyone who has the report code. Treat the code like an unguessable share link. Avoid putting it in public issues, logs, prompts, or caches you do not control.
- Private reports require the approving user's WCL token. The server can read only what that WCL account is permitted to read, but returned evidence is no longer private from the connected MCP client or model provider.

## Local attack surface

Any local process that can read the state directory, inspect the MCP process environment, or control the configured MCP client may be able to access credentials or request report data. Use a trusted MCP host, keep the machine account protected, and do not share the state directory.

For the smallest disclosure surface:

1. Use `accessMode: public` unless private access is needed.
2. Request high-level summaries before events.
3. Use narrow event time windows and actor filters.
4. Remove user authorization with `warcraftlogs-mcp auth logout` when no longer needed.
5. Review the MCP host's retention, training, sharing, and diagnostic-log settings.

## Non-goals

This project does not conceal access from Warcraft Logs, bypass report permissions, encrypt report evidence after it reaches the MCP host, or control how a third-party model provider stores prompts and tool results.
