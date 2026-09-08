# Security policy

## Supported versions

Security fixes are provided for the latest released minor version.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting for this repository. Do not open a public issue containing credentials, access tokens, private report codes, or exploit details.

Include the affected version, impact, reproduction steps, and a minimal test case when possible. You should receive an acknowledgement within seven days.

## Security boundaries

- User-provided URLs are accepted only when they are credential-free HTTPS URLs on the exact hosts `www.warcraftlogs.com` or `cn.warcraftlogs.com`, using the default port and `/reports/<code>` path.
- OAuth secrets and tokens remain in process memory. The server does not write them to disk or return them in errors.
- The public API uses OAuth client credentials. This release does not request user authorization or private-report scopes.
- Event and table responses have count and byte budgets to reduce memory exhaustion and accidental context flooding.
- Standard output is reserved for MCP JSON-RPC while the stdio server is active.

Users remain responsible for protecting their environment variables, choosing which local MCP clients can launch the server, and following Warcraft Logs' API terms and rate limits.
