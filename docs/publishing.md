# Publishing

No workflow publishes merely because the repository exists. Complete the one-time ownership setup first.

The Release job is disabled by default. It runs only when the repository Actions variable `NPM_PUBLISH_ENABLED` is exactly `true`, preventing a new repository from attempting an unconfigured first npm publish.

## First release

1. Confirm the npm name is still available:

   ```bash
   npm view warcraftlogs-mcp
   ```

2. Run the full release checks:

   ```bash
   pnpm install --frozen-lockfile
   pnpm check
   pnpm lint:package
   npm pack --dry-run
   ```

3. Create and push the public GitHub repository:

   ```bash
   gh repo create iRockyZhou/warcraftlogs-mcp --public --source=. --remote=origin --push
   ```

4. Publish the first version interactively from a trusted machine:

   ```bash
   npm login
   npm publish --access public
   ```

## Enable npm trusted publishing

In the npm package settings, add a GitHub Actions trusted publisher with:

```text
Owner: iRockyZhou
Repository: warcraftlogs-mcp
Workflow filename: release.yml
Environment: leave blank
```

The workflow has `id-token: write`, uses a GitHub-hosted runner, and does not require a long-lived `NPM_TOKEN`. npm generates provenance automatically for a public package published from a public repository.

After the trusted publisher is configured and only when automated npm publishing is desired, create this GitHub repository Actions variable:

```text
NPM_PUBLISH_ENABLED=true
```

Leave the variable absent or set it to any other value to keep the Release job disabled.

## Later releases

Add a Changeset in each user-visible pull request:

```bash
pnpm changeset
```

After those changes reach `main`, the release workflow opens or updates a version pull request. Merging that pull request causes the same workflow to publish through npm OIDC and create GitHub release metadata.

Never add an npm automation token unless trusted publishing is unavailable and the security trade-off has been reviewed.
