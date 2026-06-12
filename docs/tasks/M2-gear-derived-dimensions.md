# M2 - Gear math and generated shaping kernel

## Issue: Implement derived spur gear dimensions and undercut reporting

### Context

Gear input is tooth count, module, pressure angle, and face width. Derived values must be shown to users and used by planning.

### Scope

- Compute pitch, outer, root, and base diameters.
- Compute circular pitch, tooth thickness, whole depth, and working depth.
- Add profile shift awareness where applicable.
- Add undercut warning logic with tests.

### Out Of Scope

- Involute mesh generation.
- Toolpath generation.
- Cutter feasibility.

### Deliverables

- `hobgoblin-gear` derived dimension API.
- Tests for standard and shifted gears.
- Diagnostics integrated into project validation.

### Verification

- `cargo test -p hobgoblin-gear`

### Dependencies

- M1 project model.

