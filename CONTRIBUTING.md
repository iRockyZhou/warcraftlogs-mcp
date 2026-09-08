# Contributing

Thank you for helping improve `warcraftlogs-mcp`.

## Development setup

Use Node.js 24 and the package-manager version declared in `package.json`:

```bash
corepack enable
pnpm install
pnpm check
```

Never put live Warcraft Logs credentials, access tokens, private report codes, or copied combat data in tests or issues. Use the mock HTTP fixtures under `test/`.

## Pull requests

1. Keep the MCP layer focused on stable evidence retrieval and compression. Class/spec coaching belongs in optional analysis packs, not the core server.
2. Add tests for API semantics and failure behavior, not only the happy path.
3. Preserve exact source/target direction in table wrappers.
4. Keep event and response budgets bounded.
5. Add a Changeset for user-visible changes:

   ```bash
   pnpm changeset
   ```

6. Run `pnpm check` and `npm pack --dry-run` before opening a pull request.

## Commit style

Use focused commits with imperative summaries, for example:

```text
Add bounded event pagination
Fix target filtering for death tables
```

## Warcraft Logs schema changes

When changing a GraphQL query, link the relevant official schema documentation in the pull request and update both runtime schemas and mock integration tests. Do not infer stable fields from the website's private network requests alone.
