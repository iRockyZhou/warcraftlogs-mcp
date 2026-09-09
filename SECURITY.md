# Security policy

## Supported versions

Security fixes are provided for the latest released minor version.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting for this repository. Do not open a public issue containing credentials, access tokens, private report codes, or exploit details.

Include the affected version, impact, reproduction steps, and a minimal test case when possible. You should receive an acknowledgement within seven days.

## Security boundaries

- User-provided URLs are accepted only when they are credential-free HTTPS URLs on the exact hosts `www.warcraftlogs.com` or `cn.warcraftlogs.com`, using the default port and `/reports/<code>` path.
- Client secrets remain in process memory. User OAuth tokens may be stored locally in `auth.json`; the directory is mode `0700`, the file is mode `0600`, and writes are atomic. Tokens are never returned by tools or normalized errors.
- Public and unlisted report requests use the client GraphQL endpoint unless user access is selected. Private reports use the user GraphQL endpoint and remain subject to the approving WCL account's permissions.
- OAuth authorization uses a random state value and accepts only loopback HTTP callbacks on `127.0.0.1` or `localhost`. OAuth and GraphQL redirects are disabled.
- Unlisted report codes are share-link secrets. Do not publish them in issues, logs, or test fixtures.
- Event and table responses have count and byte budgets to reduce memory exhaustion and accidental context flooding.
- Standard output is reserved for MCP JSON-RPC while the stdio server is active.

Users remain responsible for protecting their environment variables, choosing which local MCP clients can launch the server, and following Warcraft Logs' API terms and rate limits.

The MCP host and model provider receive whatever report evidence a tool returns. See [the privacy and threat model](docs/privacy.md).
