# M2 - Gear math and generated shaping kernel

## Issue: Generate abstract rack-shaping passes for a spur gear

### Context

Hobgoblin emulates rack generation by repeated shaping passes. For spur gears, each pass cuts along machine `X` across face width with fixed `Y` and `A`.

### Scope

- Add an abstract operation for generated shaping.
- Compute virtual rack displacement steps.
- Compute conjugate stock rotation `theta = rack_displacement / pitch_radius`.
- Emit abstract moves for one spur gear using depth layers and tooth iteration.
- Keep signs/machine-axis mapping configurable.

### Out Of Scope

- Adaptive step refinement beyond a first deterministic implementation.
- Physical cutter gouge validation.
- G-code export.

### Deliverables

- Abstract path data for spur generated shaping.
- Debug output that exposes tooth, step, `Y`, `A`, `Z`, and `X` stroke information.
- Tests for deterministic output.

### Verification

- `cargo test --workspace`
- CLI command or test fixture that prints generated abstract path summary.

### Dependencies

- M2 derived dimensions.
- M3 operation graph skeleton.

