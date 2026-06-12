# M1 - Core project model and validation

## Issue: Harden JSON project model and validation diagnostics

### Context

The GUI, planner, and CLI depend on a stable procedural model. v0 project files are JSON, metric-only, and versioned.

### Scope

- Refine `hobgoblin-core` serde structs.
- Add validation for derived shaft feature spans, protected intervals, planning polygons, and unsupported feature warnings.
- Add stable diagnostic object references.
- Add tests for valid and invalid sample projects.

### Out Of Scope

- Toolpath generation.
- Full JSON Schema export.
- UI editing.

### Deliverables

- Deterministic project validation API.
- Unit tests and sample invalid fixtures.
- CLI output that is useful for agents and users.

### Verification

- `cargo test -p hobgoblin-core`
- `cargo run -p hobgoblin-cli -- validate examples/projects/simple_spur_stack.hobgoblin.json`

### Dependencies

- M0 scaffold.
