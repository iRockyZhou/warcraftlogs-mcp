# Publishing

Publishing uses Changesets v3 and npm Trusted Publishing. The GitHub Actions workflow receives a short-lived OIDC credential for each release; the repository stores no long-lived npm token.

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

4. Publish the first version interactively from a trusted machine. npm needs an existing package before its Trusted Publisher can be configured:

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
Environment: npm
Allowed action: npm publish
```

Create a GitHub environment named `npm`. The release job is bound to that environment, so npm's trust policy only accepts the intended workflow and environment. Optional GitHub environment protection rules can require a reviewer before production publishing.

The workflow has `id-token: write`, uses a GitHub-hosted runner, runs the complete project check before release, and does not require a long-lived `NPM_TOKEN`. npm generates provenance automatically for a public package published from a public repository.

## Later releases

Add a Changeset in each user-visible pull request:

```bash
pnpm changeset
```

After those changes reach `main`, the release workflow opens or updates a version pull request. Merging that pull request causes the same workflow to publish through npm OIDC, push the version tag, and create GitHub release metadata.

The repository must allow GitHub Actions to create pull requests under **Settings → Actions → General → Workflow permissions**.

Never add an npm automation token unless trusted publishing is unavailable and the security trade-off has been reviewed.
