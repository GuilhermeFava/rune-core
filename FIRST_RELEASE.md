# First Release Plan

Target: `v0.1.0-beta.1`

## Recommended path

Use npm trusted publishing with GitHub Actions.

Why:

- no long-lived npm token stored in GitHub
- better security model
- simpler operational setup once connected

## One-time setup on npm

1. Create or log into the npm account that will own `@runerenewables/rune-core`
2. If needed, create the `@runerenewables` organization scope or choose an available public scope
3. Publish the first beta manually once so the package page exists on npm:

```bash
cd /Users/guilhermefavaretto/Rune-engine/packages/rune-core
npm publish --access public --tag beta
```

4. On npmjs.com, open the package page for `@runerenewables/rune-core`
5. Open `Settings` -> `Trusted Publisher`
6. Add the GitHub repository:
   - owner: `GuilhermeFava`
   - repo: `rune-core`
   - workflow file: `publish.yml`
   - environment: none
7. In the same package settings, review `Publishing access` and restrict token-based publish if you want trusted publishing to be the primary path

## Release flow

1. Ensure `main` is green
2. Bump `package.json` and `CHANGELOG.md`
3. Tag the release:

```bash
git tag v0.1.0-beta.1
git push origin v0.1.0-beta.1
```

4. GitHub Actions publishes the package

## Token fallback

If trusted publishing is unavailable, fallback to a granular npm access token with publish rights and store it as `NPM_TOKEN` in GitHub Actions secrets.
