# Hobgoblin Architecture

Hobgoblin is single-purpose CAM for cutting geared shafts on a 4-axis CNC mill. The first target machine is Makera Carvera Air with stock held on the left and optional tailstock support on the right.

## Product Boundary

- One project represents one shaft.
- The authoritative model is procedural: stack features, setup, stock, tools, materials, planning regions, and operation intent.
- Meshes are derived artifacts for preview, simulation, STL export, and later validation.
- STEP/B-rep export is a future feature. The model must preserve procedural intent so STEP can be added without reverse-engineering meshes.
- Metric units only in v0.
- Internal gears are out of scope.
- G-code export is eventually required and v0 targets Carvera Air, but the planner emits abstract paths first.
- G-code export is blocked by validation or simulation errors.

## Coordinates

Project geometry should distinguish logical coordinates from machine axes:

- `s`: shaft axis / gear face-width coordinate.
- `r`: radial coordinate.
- `t`: virtual rack displacement coordinate.
- `theta`: stock rotary angle.

For the initial Carvera setup:

- Machine `X` maps to shaft-axis cutting strokes across gear face width.
- Machine `Y` implements virtual rack displacement between shaping strokes.
- Machine `Z` controls radial/depth position.
- Machine `A` indexes stock rotation.

Spur gear shaping strokes hold `Y` and `A` constant while cutting along `X`. Helical gears later couple `A` to `X` during the stroke.

## Project Model

Project files are human-readable JSON with an explicit `schema_version`. Schema-breaking changes are allowed during early development, but migrations should be explicit once real projects exist.

Projects store:

- Stable IDs for all entities.
- Metric units.
- User-defined datum.
- Cylindrical stock.
- Single setup.
- Ordered stack items with user-entered lengths and computed absolute intervals.
- Setup-owned planning polygons.
- Tool/material/machine references and generation-time snapshots in the future.

Generated toolpaths are not stored by default. They are cache/export artifacts stamped with generator versions and project hashes.

## Stack Features

The stack is ordered by length. Absolute positions are derived from the datum and item order.

Implemented first:

- Cylindrical sections.
- External spur gears.

Prepared in schema but not generated in v0:

- Helical gears.
- Herringbone gears as composite features.
- Eccentric sections.

Transitions, reliefs, and protected regions should be explicit features or setup regions. Neighboring features do not implicitly own each other's transition geometry.

## Setup And Planning Regions

v0 uses a single setup. Stock may exceed finished shaft length. Left grip material is unavailable and not sacrificial in v0. Chuck, tailstock, and contact areas are represented as `do_not_machine` intervals or protected planning polygons.

Planning uses 2D polygons in `s/r` space. Regions are setup-owned and may overlap if ordered by stage. Axis-aligned regions should be easy to create, but the model allows arbitrary polygons.

Breakpoints are hard operation-order constraints represented as planning-region boundaries. Operations do not cross hard breakpoints.

## Gear Generation

Gear input is tooth count, module, pressure angle, and face width. Profile shift, addendum, dedendum, backlash, phase, and helix fields are stored. Derived dimensions are shown to the user.

The gear kernel has two geometry roles:

- Nominal involute/rack reference geometry for inspection and design.
- Manufactured prediction from physical cutter sweeps.

Undercut is allowed but must be reported. Root fillet is both a design intent and a cutter-derived manufactured result.

## Generated Shaping Process

The process emulates rack generation through repeated shaping passes:

1. Choose a depth layer.
2. Choose a tooth or tooth-gap group.
3. Choose an adaptive virtual rack step.
4. Position `Y` to the virtual rack displacement.
5. Index `A` to the conjugate stock rotation.
6. Position `Z` to radial/depth position.
7. Cut along `X` across the gear face.
8. Retract and return.

The relation for spur generation is:

```text
delta_theta_rad = delta_rack_displacement / pitch_radius
```

Signs are resolved by machine profile, tooth index, and active flank/contact strategy.

Adaptive rack stepping is required from day one. It is geometric only: material does not change rack step geometry. Step density is driven by target profile/swept-envelope tolerance, local curvature, root/fillet behavior, cutter tip flat/radius, and deterministic min/max bounds.

## Cutter Strategy

The target rack cutter is independent of the physical tool. The planner maps:

```text
target gear -> theoretical rack/cutter path -> physical tool strategy -> machine moves
```

Physical V cutters may have arbitrary included angle and tip flat. If an exact full-width strategy is not valid, the planner uses side-flank generation where only one active edge is intended to cut. Inactive-edge gouging or unreachable poses are errors.

The model distinguishes engagement modes:

- Full-width/gap cutting.
- Side-flank cutting.
- Root/gap generation.
- Spring finishing.

Left and right flanks use the same tool in v0 to preserve tooth symmetry.

## Operation Planning

Features define desired geometry. Setup planning regions and operation templates define machining intent. The planner builds an explicit dependency graph and then schedules operations while respecting:

- Hard region/breakpoint ordering.
- Feature dependencies.
- Tool access.
- Simulation/validation constraints.
- Tool-change minimization where it does not violate ordering.

Default order on Carvera is from tailstock side toward chuck side.

## Simulation And Validation

Simulation layers:

1. Abstract toolpath preview.
2. Collision/envelope checks.
3. Material-removal simulation.
4. Later, postprocessed G-code playback.

v0 collision scope starts with tool vs stock/current part plus machine envelope checks. Holder, fixture, and detailed machine mesh validation are later.

Warnings attach to concrete objects. Errors block planning/export; warnings can be ignored.

Every exported G-code file should include a sidecar report with project hash, machine profile, tools, operation list, simulation status, and warnings.

## Libraries

Machine, tool, and material libraries are global user configuration files in the OS default config directory. They are editable in-app and import/exportable as JSON.

Projects reference global library entities. Later, generation/export should snapshot resolved machine/tool/material definitions for reproducibility.

## Application Architecture

Recommended stack:

- Tauri desktop app.
- TypeScript UI.
- Three.js 3D preview.
- Canvas/WebGL 2D stack and planning editor.
- Rust kernel and CLI.

Rust workspace crates:

- `hobgoblin-core`: project model, setup, stack, validation, units.
- `hobgoblin-gear`: gear math and derived dimensions.
- `hobgoblin-planner`: operation graph and scheduling.
- `hobgoblin-post`: abstract paths, machine profiles, and G-code export.
- `hobgoblin-cli`: validate/plan/sim/export entry points.

The GUI is a client of the deterministic kernel. The frontend owns interactive draft state and sends serialized snapshots to the backend for validation/planning. Authoritative geometry and export data come from Rust.

