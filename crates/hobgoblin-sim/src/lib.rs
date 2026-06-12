use hobgoblin_core::{Project, ProtectedInterval, Tool};
use hobgoblin_post::{AbstractMove, AbstractPath};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimulationResult {
    pub path_id: String,
    pub operation_id: String,
    pub tool_id: Option<String>,
    pub diagnostics: Vec<SimulationDiagnostic>,
    pub preview_layers: Vec<PreviewLayer>,
    pub summary: SimulationSummary,
}

impl SimulationResult {
    pub fn has_errors(&self) -> bool {
        self.diagnostics
            .iter()
            .any(|diagnostic| diagnostic.severity == SimulationSeverity::Error)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimulationDiagnostic {
    pub severity: SimulationSeverity,
    pub object_id: Option<String>,
    pub path_id: String,
    pub move_index: Option<usize>,
    pub message: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SimulationSeverity {
    Error,
    Warning,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreviewLayer {
    pub kind: PreviewLayerKind,
    pub segments: Vec<PreviewSegment>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PreviewLayerKind {
    Rapid,
    Cut,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreviewSegment {
    pub move_index: usize,
    pub s_start_mm: Option<f64>,
    pub s_end_mm: Option<f64>,
    pub r_start_mm: Option<f64>,
    pub r_end_mm: Option<f64>,
    pub x_start_mm: Option<f64>,
    pub x_end_mm: Option<f64>,
    pub y_start_mm: Option<f64>,
    pub y_end_mm: Option<f64>,
    pub z_start_mm: Option<f64>,
    pub z_end_mm: Option<f64>,
    pub a_start_deg: Option<f64>,
    pub a_end_deg: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimulationSummary {
    pub rapid_segment_count: usize,
    pub cut_segment_count: usize,
    pub min_x_mm: Option<f64>,
    pub max_x_mm: Option<f64>,
    pub min_z_mm: Option<f64>,
    pub max_z_mm: Option<f64>,
    pub max_cut_depth_mm: f64,
}

#[derive(Debug, Clone, Copy, Default)]
struct MachinePosition {
    x_mm: Option<f64>,
    y_mm: Option<f64>,
    z_mm: Option<f64>,
    a_deg: Option<f64>,
}

pub fn simulate_abstract_path(project: &Project, path: &AbstractPath) -> SimulationResult {
    simulate_abstract_path_with_tool(project, path, None)
}

pub fn simulate_abstract_path_with_tool(
    project: &Project,
    path: &AbstractPath,
    tool: Option<&Tool>,
) -> SimulationResult {
    let mut diagnostics = Vec::new();
    let mut rapid_segments = Vec::new();
    let mut cut_segments = Vec::new();
    let mut validated_rapid_segments = Vec::new();
    let mut validated_cut_segments = Vec::new();
    let stock_start_x_mm = project.project.datum.s_offset_mm;
    let stock_end_x_mm = stock_start_x_mm + project.stock.length_mm;
    let stock_radius_mm = project.stock.diameter_mm / 2.0;
    let mut position = MachinePosition::default();

    for (move_index, abstract_move) in path.moves.iter().enumerate() {
        let before = position;
        match abstract_move {
            AbstractMove::Rapid {
                x_mm,
                y_mm,
                z_mm,
                a_deg,
            } => {
                position = update_position(position, *x_mm, *y_mm, *z_mm, *a_deg);
                let segment = build_segment(move_index, before, position);
                validate_segment(
                    project,
                    path,
                    move_index,
                    &segment,
                    false,
                    stock_start_x_mm,
                    stock_end_x_mm,
                    stock_radius_mm,
                    &mut diagnostics,
                );
                validated_rapid_segments.push(segment.clone());
                if segment.has_drawable_start() {
                    rapid_segments.push(segment);
                }
            }
            AbstractMove::LinearCut {
                x_mm,
                y_mm,
                z_mm,
                a_deg,
                ..
            } => {
                position = update_position(position, *x_mm, *y_mm, *z_mm, *a_deg);
                let segment = build_segment(move_index, before, position);
                validate_segment(
                    project,
                    path,
                    move_index,
                    &segment,
                    true,
                    stock_start_x_mm,
                    stock_end_x_mm,
                    stock_radius_mm,
                    &mut diagnostics,
                );
                validated_cut_segments.push(segment.clone());
                if segment.has_drawable_start() {
                    cut_segments.push(segment);
                }
            }
            AbstractMove::Spindle { .. } => {}
        }
    }

    let summary = build_summary(
        &rapid_segments,
        &cut_segments,
        &validated_rapid_segments,
        &validated_cut_segments,
    );
    if let Some(tool) = tool {
        validate_tool_against_path(tool, path, &summary, &mut diagnostics);
    }
    SimulationResult {
        path_id: path.id.clone(),
        operation_id: path.operation_id.clone(),
        tool_id: tool.map(|tool| tool.id().to_string()),
        diagnostics,
        preview_layers: vec![
            PreviewLayer {
                kind: PreviewLayerKind::Rapid,
                segments: rapid_segments,
            },
            PreviewLayer {
                kind: PreviewLayerKind::Cut,
                segments: cut_segments,
            },
        ],
        summary,
    }
}

fn update_position(
    mut position: MachinePosition,
    x_mm: Option<f64>,
    y_mm: Option<f64>,
    z_mm: Option<f64>,
    a_deg: Option<f64>,
) -> MachinePosition {
    if x_mm.is_some() {
        position.x_mm = x_mm;
    }
    if y_mm.is_some() {
        position.y_mm = y_mm;
    }
    if z_mm.is_some() {
        position.z_mm = z_mm;
    }
    if a_deg.is_some() {
        position.a_deg = a_deg;
    }
    position
}

fn build_segment(
    move_index: usize,
    before: MachinePosition,
    after: MachinePosition,
) -> PreviewSegment {
    PreviewSegment {
        move_index,
        s_start_mm: before.x_mm,
        s_end_mm: after.x_mm,
        r_start_mm: before.z_mm,
        r_end_mm: after.z_mm,
        x_start_mm: before.x_mm,
        x_end_mm: after.x_mm,
        y_start_mm: before.y_mm,
        y_end_mm: after.y_mm,
        z_start_mm: before.z_mm,
        z_end_mm: after.z_mm,
        a_start_deg: before.a_deg,
        a_end_deg: after.a_deg,
    }
}

impl PreviewSegment {
    fn has_drawable_start(&self) -> bool {
        self.x_start_mm.is_some()
            || self.y_start_mm.is_some()
            || self.z_start_mm.is_some()
            || self.a_start_deg.is_some()
    }
}

#[allow(clippy::too_many_arguments)]
fn validate_segment(
    project: &Project,
    path: &AbstractPath,
    move_index: usize,
    segment: &PreviewSegment,
    is_cut: bool,
    stock_start_x_mm: f64,
    stock_end_x_mm: f64,
    stock_radius_mm: f64,
    diagnostics: &mut Vec<SimulationDiagnostic>,
) {
    for x_mm in [segment.s_start_mm, segment.s_end_mm].into_iter().flatten() {
        if x_mm < stock_start_x_mm || x_mm > stock_end_x_mm {
            diagnostics.push(SimulationDiagnostic {
                severity: SimulationSeverity::Error,
                object_id: Some(project.stock.id.clone()),
                path_id: path.id.clone(),
                move_index: Some(move_index),
                message: format!(
                    "move projected S {:.3} mm is outside stock bounds {:.3}..{:.3} mm",
                    x_mm, stock_start_x_mm, stock_end_x_mm
                ),
            });
        }
    }

    for r_mm in [segment.r_start_mm, segment.r_end_mm].into_iter().flatten() {
        if r_mm.abs() > stock_radius_mm {
            diagnostics.push(SimulationDiagnostic {
                severity: SimulationSeverity::Error,
                object_id: Some(project.stock.id.clone()),
                path_id: path.id.clone(),
                move_index: Some(move_index),
                message: format!(
                    "move projected R {:.3} mm is outside radial stock envelope +/-{:.3} mm",
                    r_mm, stock_radius_mm
                ),
            });
        }
    }

    if is_cut {
        for protected in &project.setup.protected_intervals {
            if segment_intersects_interval(segment, protected) {
                diagnostics.push(SimulationDiagnostic {
                    severity: SimulationSeverity::Error,
                    object_id: Some(protected.id.clone()),
                    path_id: path.id.clone(),
                    move_index: Some(move_index),
                    message: format!(
                        "cutting move intersects protected interval {:.3}..{:.3} mm",
                        protected.start_s_mm, protected.end_s_mm
                    ),
                });
            }
        }
    }
}

fn segment_intersects_interval(segment: &PreviewSegment, protected: &ProtectedInterval) -> bool {
    let mut s_values = [segment.s_start_mm, segment.s_end_mm].into_iter().flatten();
    let Some(first_s_mm) = s_values.next() else {
        return false;
    };
    let (segment_start_mm, segment_end_mm) = s_values.fold(
        (first_s_mm, first_s_mm),
        |(current_min, current_max), s_mm| (current_min.min(s_mm), current_max.max(s_mm)),
    );
    segment_start_mm < protected.end_s_mm && segment_end_mm > protected.start_s_mm
}

fn build_summary(
    rapid_segments: &[PreviewSegment],
    cut_segments: &[PreviewSegment],
    validated_rapid_segments: &[PreviewSegment],
    validated_cut_segments: &[PreviewSegment],
) -> SimulationSummary {
    let mut min_x_mm: Option<f64> = None;
    let mut max_x_mm: Option<f64> = None;
    let mut min_z_mm: Option<f64> = None;
    let mut max_z_mm: Option<f64> = None;
    let mut max_cut_depth_mm = 0.0;

    for segment in validated_rapid_segments
        .iter()
        .chain(validated_cut_segments)
    {
        for x_mm in [segment.x_start_mm, segment.x_end_mm].into_iter().flatten() {
            min_x_mm = Some(min_x_mm.map_or(x_mm, |current| current.min(x_mm)));
            max_x_mm = Some(max_x_mm.map_or(x_mm, |current| current.max(x_mm)));
        }
        for z_mm in [segment.z_start_mm, segment.z_end_mm].into_iter().flatten() {
            min_z_mm = Some(min_z_mm.map_or(z_mm, |current| current.min(z_mm)));
            max_z_mm = Some(max_z_mm.map_or(z_mm, |current| current.max(z_mm)));
        }
    }
    for segment in validated_cut_segments {
        for r_mm in [segment.r_start_mm, segment.r_end_mm].into_iter().flatten() {
            max_cut_depth_mm = f64::max(max_cut_depth_mm, (-r_mm).max(0.0));
        }
    }

    SimulationSummary {
        rapid_segment_count: rapid_segments.len(),
        cut_segment_count: cut_segments.len(),
        min_x_mm,
        max_x_mm,
        min_z_mm,
        max_z_mm,
        max_cut_depth_mm,
    }
}

fn validate_tool_against_path(
    tool: &Tool,
    path: &AbstractPath,
    summary: &SimulationSummary,
    diagnostics: &mut Vec<SimulationDiagnostic>,
) {
    let required_depth_mm = summary.max_cut_depth_mm;
    if required_depth_mm <= 0.0 {
        return;
    }

    match tool {
        Tool::VCutter(tool) => {
            if required_depth_mm > tool.flute_length_mm {
                diagnostics.push(tool_diagnostic(
                    tool.id.clone(),
                    path,
                    format!(
                        "cut depth {:.3} mm exceeds V-cutter flute length {:.3} mm",
                        required_depth_mm, tool.flute_length_mm
                    ),
                ));
            }
            let half_angle_rad = tool.included_angle_deg.to_radians() / 2.0;
            let required_cut_diameter_mm =
                tool.tip_flat_width_mm + 2.0 * required_depth_mm * half_angle_rad.tan();
            if required_cut_diameter_mm > tool.max_cut_diameter_mm {
                diagnostics.push(tool_diagnostic(
                    tool.id.clone(),
                    path,
                    format!(
                        "cut depth {:.3} mm requires {:.3} mm cut diameter, exceeding V-cutter max cut diameter {:.3} mm",
                        required_depth_mm, required_cut_diameter_mm, tool.max_cut_diameter_mm
                    ),
                ));
            }
        }
        Tool::CylindricalCutter(tool) => {
            if required_depth_mm > tool.flute_length_mm {
                diagnostics.push(tool_diagnostic(
                    tool.id.clone(),
                    path,
                    format!(
                        "cut depth {:.3} mm exceeds cylindrical cutter flute length {:.3} mm",
                        required_depth_mm, tool.flute_length_mm
                    ),
                ));
            }
            if required_depth_mm > tool.cutting_length_mm {
                diagnostics.push(tool_diagnostic(
                    tool.id.clone(),
                    path,
                    format!(
                        "cut depth {:.3} mm exceeds cylindrical cutter cutting length {:.3} mm",
                        required_depth_mm, tool.cutting_length_mm
                    ),
                ));
            }
        }
    }
}

fn tool_diagnostic(
    object_id: String,
    path: &AbstractPath,
    message: String,
) -> SimulationDiagnostic {
    SimulationDiagnostic {
        severity: SimulationSeverity::Error,
        object_id: Some(object_id),
        path_id: path.id.clone(),
        move_index: None,
        message,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use hobgoblin_core::{Tool, VCutter};
    use hobgoblin_post::{AbstractMove, AbstractPath};

    fn sample_project() -> Project {
        serde_json::from_str(include_str!(
            "../../../examples/projects/simple_spur_stack.hobgoblin.json"
        ))
        .expect("sample project parses")
    }

    #[test]
    fn reports_protected_zone_cutting_violations() {
        let project = sample_project();
        let path = AbstractPath {
            id: "path.test.protected".to_string(),
            operation_id: "op.test".to_string(),
            moves: vec![
                AbstractMove::Rapid {
                    x_mm: Some(80.0),
                    y_mm: None,
                    z_mm: Some(5.0),
                    a_deg: None,
                },
                AbstractMove::LinearCut {
                    x_mm: Some(90.0),
                    y_mm: None,
                    z_mm: Some(0.0),
                    a_deg: None,
                    feed_mm_min: 100.0,
                },
            ],
        };

        let result = simulate_abstract_path(&project, &path);

        assert!(result.has_errors());
        assert!(result.diagnostics.iter().any(|diagnostic| {
            diagnostic.object_id.as_deref() == Some("protect.tailstock")
                && diagnostic.message.contains("intersects protected interval")
        }));
        assert_eq!(result.preview_layers[1].segments.len(), 1);
    }

    #[test]
    fn reports_stock_envelope_violations() {
        let project = sample_project();
        let path = AbstractPath {
            id: "path.test.stock".to_string(),
            operation_id: "op.test".to_string(),
            moves: vec![
                AbstractMove::Rapid {
                    x_mm: Some(120.0),
                    y_mm: None,
                    z_mm: Some(0.0),
                    a_deg: None,
                },
                AbstractMove::LinearCut {
                    x_mm: Some(10.0),
                    y_mm: None,
                    z_mm: Some(-9.0),
                    a_deg: None,
                    feed_mm_min: 100.0,
                },
            ],
        };

        let result = simulate_abstract_path(&project, &path);

        assert!(result.has_errors());
        assert!(result
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.message.contains("outside stock bounds")));
        assert!(result
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.message.contains("outside radial stock envelope")));
    }

    #[test]
    fn validates_first_move_endpoint_even_when_preview_segment_is_skipped() {
        let project = sample_project();
        let path = AbstractPath {
            id: "path.test.first_move".to_string(),
            operation_id: "op.test".to_string(),
            moves: vec![AbstractMove::Rapid {
                x_mm: Some(120.0),
                y_mm: None,
                z_mm: Some(0.0),
                a_deg: None,
            }],
        };

        let result = simulate_abstract_path(&project, &path);

        assert!(result.has_errors());
        assert_eq!(result.preview_layers[0].segments.len(), 0);
        assert!(result
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.move_index == Some(0)
                && diagnostic.message.contains("outside stock bounds")));
        assert_eq!(result.summary.max_x_mm, Some(120.0));
    }

    #[test]
    fn virtual_rack_y_is_not_projected_radial_axis() {
        let project = sample_project();
        let path = AbstractPath {
            id: "path.test.virtual_y".to_string(),
            operation_id: "op.test".to_string(),
            moves: vec![
                AbstractMove::Rapid {
                    x_mm: Some(20.0),
                    y_mm: Some(100.0),
                    z_mm: Some(1.0),
                    a_deg: None,
                },
                AbstractMove::LinearCut {
                    x_mm: Some(22.0),
                    y_mm: Some(120.0),
                    z_mm: Some(-0.25),
                    a_deg: None,
                    feed_mm_min: 100.0,
                },
            ],
        };

        let result = simulate_abstract_path(&project, &path);

        assert!(!result.has_errors());
        assert_eq!(result.preview_layers[0].segments.len(), 0);
        let cut_segment = &result.preview_layers[1].segments[0];
        assert_eq!(cut_segment.s_start_mm, Some(20.0));
        assert_eq!(cut_segment.r_end_mm, Some(-0.25));
    }

    #[test]
    fn reports_incompatible_tool_geometry() {
        let project = sample_project();
        let tool = Tool::VCutter(VCutter {
            id: "tool.too_small".to_string(),
            name: "Too small V cutter".to_string(),
            included_angle_deg: 60.0,
            tip_flat_width_mm: 0.1,
            max_cut_diameter_mm: 0.5,
            flute_length_mm: 0.25,
            shank_diameter_mm: 3.175,
            stickout_mm: 12.0,
            holder_diameter_mm: 12.0,
            holder_length_mm: 20.0,
        });
        let path = AbstractPath {
            id: "path.test.tool".to_string(),
            operation_id: "op.test".to_string(),
            moves: vec![
                AbstractMove::Rapid {
                    x_mm: Some(20.0),
                    y_mm: None,
                    z_mm: Some(1.0),
                    a_deg: None,
                },
                AbstractMove::LinearCut {
                    x_mm: Some(22.0),
                    y_mm: None,
                    z_mm: Some(-0.5),
                    a_deg: None,
                    feed_mm_min: 100.0,
                },
            ],
        };

        let result = simulate_abstract_path_with_tool(&project, &path, Some(&tool));

        assert!(result.has_errors());
        assert_eq!(result.tool_id.as_deref(), Some("tool.too_small"));
        assert!(result.diagnostics.iter().any(|diagnostic| {
            diagnostic.object_id.as_deref() == Some("tool.too_small")
                && diagnostic.message.contains("flute length")
        }));
        assert!(result.diagnostics.iter().any(|diagnostic| {
            diagnostic.object_id.as_deref() == Some("tool.too_small")
                && diagnostic.message.contains("max cut diameter")
        }));
    }

    #[test]
    fn uses_v_cutter_angle_and_tip_flat_for_required_cut_diameter() {
        let project = sample_project();
        let tool = Tool::VCutter(VCutter {
            id: "tool.wide.too_small".to_string(),
            name: "Wide V cutter with insufficient diameter".to_string(),
            included_angle_deg: 120.0,
            tip_flat_width_mm: 0.4,
            max_cut_diameter_mm: 2.0,
            flute_length_mm: 10.0,
            shank_diameter_mm: 3.175,
            stickout_mm: 12.0,
            holder_diameter_mm: 12.0,
            holder_length_mm: 20.0,
        });
        let path = AbstractPath {
            id: "path.test.v_geometry".to_string(),
            operation_id: "op.test".to_string(),
            moves: vec![
                AbstractMove::Rapid {
                    x_mm: Some(20.0),
                    y_mm: None,
                    z_mm: Some(1.0),
                    a_deg: None,
                },
                AbstractMove::LinearCut {
                    x_mm: Some(22.0),
                    y_mm: None,
                    z_mm: Some(-0.5),
                    a_deg: None,
                    feed_mm_min: 100.0,
                },
            ],
        };

        let result = simulate_abstract_path_with_tool(&project, &path, Some(&tool));

        assert!(result.has_errors());
        assert!(result.diagnostics.iter().any(|diagnostic| {
            diagnostic.object_id.as_deref() == Some("tool.wide.too_small")
                && diagnostic.message.contains("max cut diameter")
        }));
    }
}
