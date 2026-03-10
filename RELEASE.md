# Rune Core Release Path

`rune-core` is now source-isolated inside the private monorepo.

The recommended publication path is a separate public repository, not opening the full Rune application repository.

## Why a separate repository

- keeps SaaS code, product workflows, auth, billing, and provider integrations private
- gives `rune-core` a clean technical identity for engineers and GitHub discovery
- makes licensing, issues, examples, and package publishing easier to manage

## Current readiness

The package now has:

- isolated source files under `src/`
- its own `package.json`
- package-level typecheck/build config
- package-level tests

## Recommended split flow

From the private monorepo root:

```bash
git subtree split --prefix=packages/rune-core -b codex/rune-core-public
```

Then create a new public repository and push:

```bash
git remote add rune-core-public git@github.com:GuilhermeFava/rune-core.git
git push rune-core-public codex/rune-core-public:main
```

## Before switching the public GitHub icon

Verify:

1. README is public-facing and accurate
2. license and NOTICE are final
3. examples are runnable
4. no app-internal or provider-dependent code remains in `src/`
5. package metadata is ready for public consumption

## After split

- point the marketing GitHub CTA to the public `rune-core` repository
- keep `/open-core` as the narrative page that explains the open-core model
- continue developing from the monorepo and resync with `git subtree split` when needed
