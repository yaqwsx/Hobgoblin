# M3 - Planning and simulation

## Issue: Build dependency-based operation graph from stack and planning regions

### Context

Planning regions are setup-owned 2D `s/r` polygons. Breakpoints and region stages are hard ordering constraints.

### Scope

- Generate operations for cylindrical roughing/finishing and gear OD/root/flank/spring phases.
- Create dependency edges for feature order, region stage, and gear operation order.
- Preserve tool-change minimization as a later scheduling concern.

### Out Of Scope

- Optimized scheduling.
- Collision simulation.
- G-code output.

### Deliverables

- Operation graph API.
- CLI `plan` output suitable for debugging.
- Tests for graph structure from the sample project.

### Verification

- `cargo test -p hobgoblin-planner`
- `cargo run -p hobgoblin-cli -- plan examples/projects/simple_spur_stack.hobgoblin.json`

### Dependencies

- M1 core validation.

