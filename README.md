# rune-core

`rune-core` is the open-source engineering nucleus extracted from Rune.

It packages the transparent part of the stack: deterministic wind-layout logic, wake models, AEP utilities, terrain-aware helpers, and environmental corrections grounded in public methodology.

The hosted Rune platform remains separate. Auth, billing, workflows, provider routing, project storage, and premium reports are not part of this repository.

## Hosted beta

The hosted Rune beta is live at [runerenewables.com](https://runerenewables.com).

Use the platform when you want the full workflow shell: project setup, climate workflows, collaboration, and the broader product experience around the open engineering core.

## Why this exists

Renewable engineering software should be easier to inspect.

`rune-core` exists to give engineers and technical teams a clean layer they can:

- read and audit
- test independently
- benchmark against their own references
- use as an entry point into the full Rune platform

## Current preview surface

The current public surface includes:

- layout generation helpers
- wake models (`jensen`, `bastankhah`, `gch`)
- AEP and wind-sector aggregation utilities
- density and environmental correction helpers
- terrain speed-up helpers

## What is explicitly out of scope

This repository does not include:

- hosted API orchestration
- auth, billing, subscriptions, waitlist, or admin flows
- project storage or SaaS UI
- commercial provider wrappers
- report-generation workflows
- product analytics and growth tooling

## Install

Install the public beta directly from npm:

```bash
npm install @runerenewables/rune-core@beta
```

Or pin the exact beta:

```bash
npm install @runerenewables/rune-core@0.1.0-beta.2
```

If you are consuming the repository directly from source:

```bash
npm install
npm run build
```

## Quick example

```ts
import {
  calculateAirDensity,
  calculateAnnualAEP,
  generateLayout,
  generatePowerCurve
} from '@runerenewables/rune-core';

const airDensity = calculateAirDensity(15, 120);
const powerCurve = generatePowerCurve(6000, 170, 3, 25, airDensity, 9.5, 2.1, 0.92);
const layout = generateLayout(6, 170, 6, 4, 'GRID', 15);
```

A more complete example lives in [`examples/basic-aep.ts`](./examples/basic-aep.ts).

## Local development

```bash
npm install
npm run typecheck
npm test
npm run build
```

## CI and release

The repository ships with:

- CI on push and pull request
- a publish workflow triggered by tags like `v0.1.0`
- trusted publishing support for GitHub Actions

## Status

This is the first public `beta` cut of `rune-core`. The package is now available on npm as `@runerenewables/rune-core`, and the code surface is source-isolated and CI-backed, but the API may still tighten as more examples and validations are added.

## License

`rune-core` is released under the MIT license. See [`LICENSE`](./LICENSE).

## Further reading

- [`SCOPE.md`](./SCOPE.md)
- [`NOTICE.md`](./NOTICE.md)
- [`RELEASE.md`](./RELEASE.md)
