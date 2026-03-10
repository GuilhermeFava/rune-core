# Rune Core Scope

This document defines the candidate source surface for the future public `rune-core` package.

## Candidate modules

These files are the strongest candidates because they implement physics or deterministic engineering logic with limited product coupling:

- [`frontend/lib/physics/aep.ts`](../../frontend/lib/physics/aep.ts)
- [`frontend/lib/physics/environment.ts`](../../frontend/lib/physics/environment.ts)
- [`frontend/lib/physics/wake_models.ts`](../../frontend/lib/physics/wake_models.ts)
- [`frontend/lib/physics/terrain.ts`](../../frontend/lib/physics/terrain.ts)
- [`frontend/lib/physics/noiseConstraint.ts`](../../frontend/lib/physics/noiseConstraint.ts)
- [`frontend/lib/physics/solar.ts`](../../frontend/lib/physics/solar.ts)

## Maybe later

These areas may become public after additional cleanup, naming normalization, and dependency review:

- [`frontend/lib/physics/layout.ts`](../../frontend/lib/physics/layout.ts)
- [`frontend/lib/physics/micrositing.ts`](../../frontend/lib/physics/micrositing.ts)
- [`frontend/lib/physics/optimization.ts`](../../frontend/lib/physics/optimization.ts)
- [`frontend/lib/physics/optimizationPipeline.ts`](../../frontend/lib/physics/optimizationPipeline.ts)
- [`engine/aero/energy_simulation.py`](../../engine/aero/energy_simulation.py)

## Keep closed

These areas should stay out of the first public package:

- [`api.py`](../../api.py)
- [`frontend/services`](../../frontend/services)
- [`frontend/components`](../../frontend/components)
- [`frontend/pages`](../../frontend/pages)
- [`engine/aether/meteo_service.py`](../../engine/aether/meteo_service.py)
- [`engine/aether/era5_cds_client.py`](../../engine/aether/era5_cds_client.py)
- [`THIRD_PARTY_SERVICES.md`](../../THIRD_PARTY_SERVICES.md) integrations that require operational keys, paid tiers, or usage terms

## Release heuristic

A module is eligible for `rune-core` only if all of the following are true:

- it is primarily literature-derived or self-authored engineering logic
- it can run without SaaS secrets
- it does not require proprietary datasets bundled in the package
- it does not expose commercial provider terms risk
- it has deterministic tests or validation examples
