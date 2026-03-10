# Rune Core

`rune-core` is the future open-source physics nucleus of Rune.

It is being prepared as a public technical layer that exposes the academically grounded parts of the platform without exposing the hosted SaaS stack.

## Why this exists

Rune has two different value layers:

- `rune-core`: transparent engineering logic, validation-minded utilities, wake and yield models based on public literature.
- Rune Platform: UX, workflows, project storage, hosted datasets, access control, premium reports, integrations, and orchestration.

This split lets Rune use open source as:

- a technical trust signal for engineers and investors
- a developer acquisition channel
- a validation surface that can be audited publicly
- a marketing wedge without giving away the full product

## Planned public scope

The initial public package is intended to include:

- wake model implementations derived from public literature
- AEP and sector aggregation utilities
- air-density and environmental correction helpers
- deterministic benchmark fixtures and validation-facing examples
- selected terrain and constraint helpers that do not depend on restricted datasets or external SaaS APIs

## Explicitly out of scope

The first public release is not intended to include:

- hosted API orchestration
- auth, billing, subscriptions, waitlist, or admin flows
- third-party tiles, geocoding, paid weather routing, or commercial provider wrappers
- project storage, SaaS UI, or report-generation workflows
- internal growth, analytics, CRM, and operational tooling

## Status

This folder is a preparation area inside the private application repository.

It is not the published package yet.

Before public release, Rune should still complete:

1. dependency and provenance scrub
2. license selection for the package itself
3. public examples and API stabilization
4. extraction from app-specific paths where needed

See [`SCOPE.md`](./SCOPE.md), [`NOTICE.md`](./NOTICE.md), and [`../../docs/open-source/launch-checklist.md`](../../docs/open-source/launch-checklist.md).
