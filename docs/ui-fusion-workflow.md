# Fusion-Inspired Hobgoblin UI Target

This note defines the issue #12 UI direction for Hobgoblin. The target is a Fusion-inspired CAD/CAM workflow without copying Fusion 360 branding, visual identity, icon artwork, naming, or layout details. Hobgoblin should feel like a focused shaft-CAM tool: structured command areas, persistent model navigation, a proportional editing viewport, contextual forms, and visible validation state.

## First Screen

The first screen is the shaft stack editor, not a landing page or JSON editor. A new or loaded project should immediately show:

- A top command area with grouped commands for project actions, stack features, planning regions, validation, preview, and export.
- A left feature browser showing the ordered shaft stack, setup, stock, protected regions, tools/material choices when available, and validation markers attached to objects.
- A central schematic viewport showing the shaft along the `s` axis with proportional lengths and radial extents. Cylinders, gears, stock overhang, protected intervals, planning polygons, and selected handles should be visible in context.
- A right contextual inspector that edits the selected object with typed forms and derived read-only values, such as gear pitch/root/outside diameters.
- A bottom diagnostics/status area for validation errors, warnings, planning state, export readiness, active selection, units, and background task progress.

## Workflow Target

Adding and editing a shaft stack should be a direct visual workflow:

1. Start with stock and datum visible in the viewport.
2. Add cylinders, spur gears, relief/protected intervals, and later feature types from icon-led command tools in the top area.
3. Select features either from the browser or the viewport.
4. Edit selected feature dimensions in the inspector while the central schematic updates proportionally.
5. Show validation diagnostics in place and in the diagnostics area, with clicks navigating to the related feature or region.
6. Keep raw project JSON available only as a secondary developer/debug view, not as the primary editing surface.

Commands should use recognizable icons plus concise labels where space permits. Icon-only controls need tooltips. Forms should use structured controls: numeric inputs for dimensions, selects for library references and modes, toggles for binary options, and clear disabled/read-only states for derived values.

## Layout Roles

- Top command area: owns creation, validation, planning, preview, import/export, undo/redo, and mode switching. It should be dense and command-oriented rather than a marketing header.
- Left feature browser: owns hierarchy, order, selection, object visibility, object diagnostics, and later operation graph navigation.
- Central viewport: owns spatial understanding. It must preserve proportional shaft lengths and radii enough for stack editing, even before full simulation exists.
- Contextual inspector: owns object-specific editing. It should never require users to know JSON field names for normal work.
- Diagnostics/status: owns validation, planner/export readiness, blocking errors, warnings, and progress.

## Non-Goals

- Do not clone Fusion 360 branding, product names, colors, icons, command labels, or exact layout.
- Do not implement 3D simulation, material removal, or machine playback as part of issue #12.
- Do not make raw JSON the primary UI for creating or editing shafts.
- Do not expand issue #12 into frontend implementation; this file is the deliverable.

## Follow-Up Issue Boundaries

Use this note as product direction for the UI implementation issues #13-#18. In particular:

- #13 should establish the shell and first-screen layout around these persistent regions.
- #14 should make the proportional shaft schematic viewport the central editing surface.
- #15 should make inspector forms the primary editing path for selected objects.
- #16 should provide icon-led command tools for adding stack components and actions.
- #17 should make the feature browser and selection model align with the ordered stack workflow.
- #18 should cover regression tests and visual smoke coverage for the CAD workflow.

If the exact issue split changes, preserve the intent: each implementation issue should own one UI surface or workflow slice and should not reintroduce JSON-first editing.

## Verification Guidance

Implementation agents should verify changes against this note by checking that:

- A user can add or edit a basic shaft stack from the first screen without opening raw JSON.
- The top command area, left feature browser, central proportional schematic, right inspector, and diagnostics/status area are all present and have clear responsibilities.
- Selecting an object from the viewport and from the browser leads to the same inspector state.
- Validation messages are visible outside raw logs and can be associated with project objects.
- The UI remains Hobgoblin-specific and does not copy Fusion 360 trademarks, icons, color system, or exact command layout.
