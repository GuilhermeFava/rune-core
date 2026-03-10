# First Release Plan

Target: `v0.1.0`

## Recommended path

Use npm trusted publishing with GitHub Actions.

Why:

- no long-lived npm token stored in GitHub
- better security model
- simpler operational setup once connected

## One-time setup on npm

1. Create or log into the npm account that will own `@rune-engine/rune-core`
2. If needed, create the `@rune-engine` scope or choose an available public scope
3. In npm trusted publishing settings, add the GitHub repository:
   - owner: `GuilhermeFava`
   - repo: `rune-core`
   - workflow file: `publish.yml`
   - environment: none

## Release flow

1. Ensure `main` is green
2. Tag the release:

```bash
git tag v0.1.0
git push origin v0.1.0
```

3. GitHub Actions publishes the package

## Token fallback

If trusted publishing is unavailable, fallback to a granular npm access token with publish rights and store it as `NPM_TOKEN` in GitHub Actions secrets.
