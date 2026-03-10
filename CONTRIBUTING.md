# Contributing to rune-core

Thanks for contributing.

## Scope

`rune-core` accepts changes that improve the open engineering layer:

- physics implementations
- deterministic utilities
- tests and benchmark fixtures
- API clarity
- documentation and examples

Changes that depend on hosted providers, private datasets, auth, billing, or SaaS workflows do not belong here.

## Local setup

```bash
npm install
npm run typecheck
npm test
npm run build
```

## Contribution rules

1. Keep the package independent from the Rune SaaS shell.
2. Prefer deterministic tests over snapshot-heavy tests.
3. Add references when implementing literature-derived formulas.
4. Avoid introducing runtime dependencies unless they materially improve the package.
5. Keep public exports intentional. Do not leak internal helpers by default.

## Pull requests

Good pull requests should include:

- a short problem statement
- the reasoning behind the change
- test evidence
- references when changing physics assumptions

## Stability

The package is still in `alpha`. API cleanup is expected while the public surface settles.
