# 2D Schematic Preview

The M6 viewport is a proportional schematic editor for one shaft project. It preserves metric `s` lengths and radial extents for stock, stack features, protected intervals, and planning regions so users can judge the ordered shaft stack without reading JSON.

## Exact In This View

- Stock length and diameter are drawn from project dimensions.
- Stack items are laid out in declared order along the `s` axis.
- Cylindrical and eccentric sections use their stored radius.
- Spur-like gears use module, tooth count, and addendum coefficient to derive the outside radius.
- Protected intervals and planning polygons use their project coordinates, including off-stock intervals such as chuck grip.
- Measurement readouts report metric `s`, `r`, and direct distance between selected anchors.

## Schematic In This View

- Gear teeth are not rendered as involute tooth geometry.
- Helical and herringbone features are shown by their effective outside radius, not by helix surface geometry.
- Eccentricity is represented by editable parameters and nominal radius, not by a rotated radial envelope.
- Planning-region polygons describe operation intent; they are not material-removal simulation.

The 3D material-removal simulation remains a separate workflow. The 2D viewport is the primary drafting and planning surface for the gear stack.
