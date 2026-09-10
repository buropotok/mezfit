# Mezfit Documentation

This directory is the canonical project knowledge base.

## Structure

- `product/` — Mezfit product requirements and UX decisions.
- `product/invariants.md` — canonical cross-cutting product invariants, including Russian-only product UI and Gym Keeper parity rules.
- `reference/gym-keeper/` — findings from analysis of Gym Keeper used as the functional/UX reference for existing fitness flows.
- `architecture/` — Mezfit domain and technical architecture.
- `architecture/decisions/` — architectural decision records (ADRs).
- `api/` — API contracts when implementation begins.

## Documentation rule

Reference evidence and Mezfit domain decisions remain distinguishable in documentation. For fitness flows that Mezfit has chosen to reproduce from Gym Keeper, `product/invariants.md` governs implementation: preserve the Gym Keeper flow/information architecture unless a Telegram platform constraint, Mezfit data-integrity invariant, or explicit product decision requires a documented deviation.
