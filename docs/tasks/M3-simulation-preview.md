# M3 - Planning and simulation

## Issue: Implement first abstract path preview and tool-vs-stock checks

### Context

Simulation blocks export on errors. v0 starts with abstract path preview and tool-vs-stock/current-part checks.

### Scope

- Add simulation result model.
- Validate abstract paths against stock envelope and protected regions.
- Report object-attached errors and warnings.
- Provide debug data for 2D preview layers.

### Out Of Scope

- Holder/machine mesh collision.
- Full Manifold boolean validation.
- G-code playback.

### Deliverables

- `hobgoblin-sim` crate or equivalent module.
- Simulation diagnostics integrated with CLI.
- Tests for protected-zone violations.

### Verification

- `cargo test --workspace`

### Dependencies

- M2 generated shaping path.
- M3 operation graph.

