# M2 - Gear math and generated shaping kernel

## Issue: Add deterministic adaptive rack stepping

### Context

Adaptive rack stepping is required from day one. It is geometric only; material recipes do not change step geometry.

### Scope

- Add quality presets and numeric tolerance fields.
- Implement deterministic adaptive stepping based on local profile/swept-envelope error.
- Increase density near root/fillet regions.
- Enforce min/max step bounds.
- Report generated step count and estimated path size.

### Out Of Scope

- Cutting-load estimation.
- Material-dependent step changes.
- Full 3D material removal.

### Deliverables

- Adaptive stepping API.
- Tests for determinism and bound handling.
- Warnings/errors when requested tolerance is impractical.

### Verification

- `cargo test -p hobgoblin-gear`
- Golden output tests for representative gears.

### Dependencies

- M2 generated shaping path.

