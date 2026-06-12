# M0 - Architecture and scaffold

## Issue: Commit initial Rust workspace and architecture document

### Context

The repository needs a committed baseline for the procedural project model, validation CLI, sample project, and architecture decisions.

### Scope

- Review [docs/architecture.md](../architecture.md) for consistency with the current scaffold.
- Ensure the Rust workspace layout is present.
- Ensure example library/project JSON files exist.
- Add or adjust README instructions for validating a sample project.

### Out Of Scope

- Tauri UI.
- Real gear toolpath generation.
- Carvera G-code export.

### Deliverables

- Architecture document.
- Rust workspace with core crates.
- Sample JSON project and library files.
- README with bootstrap/validation instructions.

### Verification

- `cargo test --workspace`
- `cargo run -p hobgoblin-cli -- validate examples/projects/simple_spur_stack.hobgoblin.json`

### Dependencies

- None.

