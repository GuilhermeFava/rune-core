# Changelog

## 0.1.0-beta.4 - Hub-height Weibull scaling

This beta syncs the public AEP surface with the current Rune wind engine so hub-height studies can respect explicit reference-height and roughness assumptions.

### Added

- exposed reference-height and roughness-aware Weibull scaling through `calculateAnnualAEP`
- added package regression coverage for hub-height AEP sensitivity

### Changed

- AEP sector aggregation now scales Weibull `A` to the requested hub height before wake and terrain adjustments are applied
- local terrain and CFD speedup corrections now compound on the hub-height-adjusted wind resource instead of the raw reference-height value

## 0.1.0-beta.3 - Release runner refresh

This beta follows the `0.1.0-beta.2` cut and refreshes the release runner to match the current GitHub Actions and npm publishing path.

### Changed

- updated GitHub Actions workflows to the current `actions/checkout` and `actions/setup-node` majors
- upgraded the publish job to install the latest npm CLI before `npm publish`
- kept the beta release path on the `@runerenewables/rune-core` scope

## 0.1.0-beta.2 - Scoped package and automated beta publish

This beta follows the first public cut and aligns the package with the public `runerenewables` organization scope.

### Changed

- renamed the npm package from `@rune-engine/rune-core` to `@runerenewables/rune-core`
- documented the public npm install path and hosted beta entry point
- aligned release docs with the organization-backed npm publishing flow

### Infrastructure

- release automation now publishes prerelease tags with the npm `beta` dist-tag
- repository metadata, README, and GitHub release flow now point consistently to `runerenewables.com`

## 0.1.0-beta.1 - First public beta

This is the first public beta release of `rune-core`, extracted from the Rune platform beta.

### Added

- source-isolated package modules for `layout`, `terrain`, `wake_models`, `aep`, and `environment`
- package-level tests, TypeScript build configuration, and GitHub Actions CI
- release and publish automation for the public repository
- minimal example flow in `examples/basic-aep.ts`
- contribution, scope, notice, and release-path documentation

### Changed

- package metadata is now prepared for public beta versioning
- README now links directly to the hosted Rune beta at `runerenewables.com`
- release flow is aligned with beta tags and trusted publishing preparation

### Context

`rune-core` is the open engineering layer of the Rune beta. The hosted workflow shell, project orchestration, and broader product experience remain available through [runerenewables.com](https://runerenewables.com).
