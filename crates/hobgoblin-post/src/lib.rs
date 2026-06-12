use hobgoblin_core::{MachineProfile, PostprocessorDialect};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AbstractPath {
    pub id: String,
    pub operation_id: String,
    pub moves: Vec<AbstractMove>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AbstractMove {
    Rapid {
        x_mm: Option<f64>,
        y_mm: Option<f64>,
        z_mm: Option<f64>,
        a_deg: Option<f64>,
    },
    LinearCut {
        x_mm: Option<f64>,
        y_mm: Option<f64>,
        z_mm: Option<f64>,
        a_deg: Option<f64>,
        feed_mm_min: f64,
    },
    Spindle {
        rpm: u32,
        clockwise: bool,
    },
}

#[derive(Debug, Clone)]
pub struct PostprocessRequest<'a> {
    pub machine_profile: &'a MachineProfile,
    pub path: &'a AbstractPath,
    pub program_name: &'a str,
    pub tool_id: Option<&'a str>,
    pub safe_z_mm: f64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GCodeProgram {
    lines: Vec<String>,
}

impl GCodeProgram {
    pub fn lines(&self) -> &[String] {
        &self.lines
    }

    pub fn into_lines(self) -> Vec<String> {
        self.lines
    }

    pub fn to_text(&self) -> String {
        let mut text = self.lines.join("\n");
        text.push('\n');
        text
    }
}

#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum PostprocessError {
    #[error("unsupported postprocessor dialect for machine profile '{machine_profile_id}'")]
    UnsupportedDialect { machine_profile_id: String },
    #[error("machine profile '{machine_profile_id}' uses unsupported {role} axis '{axis}'")]
    UnsupportedAxis {
        machine_profile_id: String,
        role: &'static str,
        axis: String,
    },
    #[error("{field} must be finite")]
    NonFiniteValue { field: &'static str },
    #[error("{field} must be positive")]
    NonPositiveValue { field: &'static str },
    #[error("rotary sign must be exactly -1 or 1, got {value}")]
    InvalidRotarySign { value: f64 },
    #[error("spindle RPM {rpm} exceeds machine limit {max_rpm}")]
    SpindleRpmExceedsLimit { rpm: u32, max_rpm: u32 },
}

pub fn postprocess_path(
    request: &PostprocessRequest<'_>,
) -> Result<GCodeProgram, PostprocessError> {
    match request.machine_profile.postprocessor {
        PostprocessorDialect::CarveraAir => postprocess_carvera_air_path(request),
    }
}

pub fn postprocess_carvera_air_path(
    request: &PostprocessRequest<'_>,
) -> Result<GCodeProgram, PostprocessError> {
    validate_machine_mapping(request.machine_profile)?;
    ensure_finite("safe Z", request.safe_z_mm)?;

    let mut lines = vec![
        "%".to_string(),
        format_comment("Hobgoblin", request.program_name),
        format_comment("Machine", &request.machine_profile.id),
        format_comment("Path", &request.path.id),
        format_comment("Operation", &request.path.operation_id),
    ];
    if let Some(tool_id) = request.tool_id {
        lines.push(format_comment("Tool", tool_id));
    }
    lines.extend([
        "G21".to_string(),
        "G90".to_string(),
        "G94".to_string(),
        "G17".to_string(),
        "G54".to_string(),
    ]);
    lines.push(format_motion(
        "G0",
        request.machine_profile,
        MotionWords {
            x_mm: None,
            y_mm: None,
            z_mm: Some(request.safe_z_mm),
            a_deg: None,
            feed_mm_min: None,
        },
    )?);

    for abstract_move in &request.path.moves {
        match abstract_move {
            AbstractMove::Rapid {
                x_mm,
                y_mm,
                z_mm,
                a_deg,
            } => lines.push(format_motion(
                "G0",
                request.machine_profile,
                MotionWords {
                    x_mm: *x_mm,
                    y_mm: *y_mm,
                    z_mm: *z_mm,
                    a_deg: *a_deg,
                    feed_mm_min: None,
                },
            )?),
            AbstractMove::LinearCut {
                x_mm,
                y_mm,
                z_mm,
                a_deg,
                feed_mm_min,
            } => {
                ensure_positive("feed", *feed_mm_min)?;
                lines.push(format_motion(
                    "G1",
                    request.machine_profile,
                    MotionWords {
                        x_mm: *x_mm,
                        y_mm: *y_mm,
                        z_mm: *z_mm,
                        a_deg: *a_deg,
                        feed_mm_min: Some(*feed_mm_min),
                    },
                )?);
            }
            AbstractMove::Spindle { rpm, clockwise } => {
                if *rpm > request.machine_profile.limits.max_spindle_rpm {
                    return Err(PostprocessError::SpindleRpmExceedsLimit {
                        rpm: *rpm,
                        max_rpm: request.machine_profile.limits.max_spindle_rpm,
                    });
                }
                let direction = if *clockwise { "M3" } else { "M4" };
                lines.push(format!("{direction} S{rpm}"));
            }
        }
    }

    lines.push(format_motion(
        "G0",
        request.machine_profile,
        MotionWords {
            x_mm: None,
            y_mm: None,
            z_mm: Some(request.safe_z_mm),
            a_deg: None,
            feed_mm_min: None,
        },
    )?);
    lines.push("M5".to_string());
    lines.push("M30".to_string());
    lines.push("%".to_string());

    Ok(GCodeProgram { lines })
}

#[derive(Debug, Clone, Copy)]
struct MotionWords {
    x_mm: Option<f64>,
    y_mm: Option<f64>,
    z_mm: Option<f64>,
    a_deg: Option<f64>,
    feed_mm_min: Option<f64>,
}

fn format_motion(
    code: &str,
    machine_profile: &MachineProfile,
    words: MotionWords,
) -> Result<String, PostprocessError> {
    let mut parts = vec![code.to_string()];
    push_axis_word(
        &mut parts,
        machine_profile,
        "shaft",
        &machine_profile.axis_mapping.shaft_axis,
        words.x_mm,
        1.0,
    )?;
    push_axis_word(
        &mut parts,
        machine_profile,
        "virtual rack",
        &machine_profile.axis_mapping.virtual_rack_axis,
        words.y_mm,
        1.0,
    )?;
    push_axis_word(
        &mut parts,
        machine_profile,
        "radial",
        &machine_profile.axis_mapping.radial_axis,
        words.z_mm,
        1.0,
    )?;
    push_axis_word(
        &mut parts,
        machine_profile,
        "rotary",
        &machine_profile.axis_mapping.rotary_axis,
        words.a_deg,
        machine_profile.axis_mapping.rotary_sign,
    )?;
    if let Some(feed_mm_min) = words.feed_mm_min {
        ensure_positive("feed", feed_mm_min)?;
        parts.push(format!("F{}", format_number(feed_mm_min)));
    }
    Ok(parts.join(" "))
}

fn push_axis_word(
    parts: &mut Vec<String>,
    machine_profile: &MachineProfile,
    role: &'static str,
    axis: &str,
    value: Option<f64>,
    sign: f64,
) -> Result<(), PostprocessError> {
    let Some(value) = value else {
        return Ok(());
    };
    ensure_finite(role, value)?;
    ensure_finite("axis sign", sign)?;
    let axis = normalized_axis(axis).ok_or_else(|| PostprocessError::UnsupportedAxis {
        machine_profile_id: machine_profile.id.clone(),
        role,
        axis: axis.to_string(),
    })?;
    parts.push(format!("{axis}{}", format_number(value * sign)));
    Ok(())
}

fn validate_machine_mapping(machine_profile: &MachineProfile) -> Result<(), PostprocessError> {
    for (role, axis) in [
        ("shaft", &machine_profile.axis_mapping.shaft_axis),
        (
            "virtual rack",
            &machine_profile.axis_mapping.virtual_rack_axis,
        ),
        ("radial", &machine_profile.axis_mapping.radial_axis),
        ("rotary", &machine_profile.axis_mapping.rotary_axis),
    ] {
        if normalized_axis(axis).is_none() {
            return Err(PostprocessError::UnsupportedAxis {
                machine_profile_id: machine_profile.id.clone(),
                role,
                axis: axis.clone(),
            });
        }
    }
    validate_rotary_sign(machine_profile.axis_mapping.rotary_sign)?;
    Ok(())
}

fn normalized_axis(axis: &str) -> Option<&'static str> {
    match axis {
        "X" | "x" => Some("X"),
        "Y" | "y" => Some("Y"),
        "Z" | "z" => Some("Z"),
        "A" | "a" => Some("A"),
        _ => None,
    }
}

fn ensure_finite(field: &'static str, value: f64) -> Result<(), PostprocessError> {
    if value.is_finite() {
        Ok(())
    } else {
        Err(PostprocessError::NonFiniteValue { field })
    }
}

fn ensure_positive(field: &'static str, value: f64) -> Result<(), PostprocessError> {
    ensure_finite(field, value)?;
    if value > 0.0 {
        Ok(())
    } else {
        Err(PostprocessError::NonPositiveValue { field })
    }
}

fn validate_rotary_sign(value: f64) -> Result<(), PostprocessError> {
    ensure_finite("rotary sign", value)?;
    if value == -1.0 || value == 1.0 {
        Ok(())
    } else {
        Err(PostprocessError::InvalidRotarySign { value })
    }
}

fn format_comment(label: &str, value: &str) -> String {
    format!("({label}: {})", sanitize_comment_text(value))
}

fn sanitize_comment_text(value: &str) -> String {
    value
        .chars()
        .map(|character| match character {
            '(' | ')' | '\r' | '\n' => ' ',
            _ => character,
        })
        .collect::<String>()
}

fn format_number(value: f64) -> String {
    let normalized = if value == 0.0 { 0.0 } else { value };
    format!("{normalized:.3}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use hobgoblin_core::{AxisMapping, MachineLimits, MachineProfile, PostprocessorDialect};

    fn carvera_profile(rotary_sign: f64) -> MachineProfile {
        MachineProfile {
            id: "machine.carvera_air.test".to_string(),
            name: "Carvera Air test".to_string(),
            axis_mapping: AxisMapping {
                shaft_axis: "X".to_string(),
                virtual_rack_axis: "Y".to_string(),
                radial_axis: "Z".to_string(),
                rotary_axis: "A".to_string(),
                rotary_sign,
            },
            limits: MachineLimits {
                max_stock_diameter_mm: 92.0,
                max_stock_length_mm: 200.0,
                travel_x_mm: 300.0,
                travel_y_mm: 200.0,
                travel_z_mm: 130.0,
                max_spindle_rpm: 13_000,
            },
            postprocessor: PostprocessorDialect::CarveraAir,
        }
    }

    #[test]
    fn emits_carvera_startup_motion_spindle_and_shutdown() {
        let machine_profile = carvera_profile(1.0);
        let path = AbstractPath {
            id: "path.test".to_string(),
            operation_id: "op.test".to_string(),
            moves: vec![
                AbstractMove::Spindle {
                    rpm: 12_000,
                    clockwise: true,
                },
                AbstractMove::Rapid {
                    x_mm: Some(1.0),
                    y_mm: Some(2.0),
                    z_mm: Some(5.0),
                    a_deg: Some(10.0),
                },
                AbstractMove::LinearCut {
                    x_mm: Some(3.0),
                    y_mm: None,
                    z_mm: Some(-0.5),
                    a_deg: Some(12.5),
                    feed_mm_min: 80.0,
                },
            ],
        };

        let program = postprocess_path(&PostprocessRequest {
            machine_profile: &machine_profile,
            path: &path,
            program_name: "sample",
            tool_id: Some("tool.v"),
            safe_z_mm: 6.0,
        })
        .expect("valid postprocess request");

        assert_eq!(
            program.lines(),
            &[
                "%",
                "(Hobgoblin: sample)",
                "(Machine: machine.carvera_air.test)",
                "(Path: path.test)",
                "(Operation: op.test)",
                "(Tool: tool.v)",
                "G21",
                "G90",
                "G94",
                "G17",
                "G54",
                "G0 Z6.000",
                "M3 S12000",
                "G0 X1.000 Y2.000 Z5.000 A10.000",
                "G1 X3.000 Z-0.500 A12.500 F80.000",
                "G0 Z6.000",
                "M5",
                "M30",
                "%",
            ]
        );
    }

    #[test]
    fn applies_rotary_sign_at_postprocess_time() {
        let machine_profile = carvera_profile(-1.0);
        let path = AbstractPath {
            id: "path.test".to_string(),
            operation_id: "op.test".to_string(),
            moves: vec![AbstractMove::Rapid {
                x_mm: None,
                y_mm: None,
                z_mm: None,
                a_deg: Some(15.0),
            }],
        };

        let program = postprocess_path(&PostprocessRequest {
            machine_profile: &machine_profile,
            path: &path,
            program_name: "sign",
            tool_id: None,
            safe_z_mm: 5.0,
        })
        .expect("valid postprocess request");

        assert!(program.lines().iter().any(|line| line == "G0 A-15.000"));
    }

    #[test]
    fn rejects_spindle_speed_above_machine_limit() {
        let machine_profile = carvera_profile(1.0);
        let path = AbstractPath {
            id: "path.test".to_string(),
            operation_id: "op.test".to_string(),
            moves: vec![AbstractMove::Spindle {
                rpm: 20_000,
                clockwise: true,
            }],
        };

        let error = postprocess_path(&PostprocessRequest {
            machine_profile: &machine_profile,
            path: &path,
            program_name: "rpm",
            tool_id: None,
            safe_z_mm: 5.0,
        })
        .expect_err("rpm should exceed limit");

        assert!(matches!(
            error,
            PostprocessError::SpindleRpmExceedsLimit {
                rpm: 20_000,
                max_rpm: 13_000
            }
        ));
    }

    #[test]
    fn retracts_to_mapped_safe_axis_before_stopping_spindle() {
        let mut machine_profile = carvera_profile(1.0);
        machine_profile.axis_mapping.radial_axis = "Y".to_string();
        machine_profile.axis_mapping.virtual_rack_axis = "Z".to_string();
        let path = AbstractPath {
            id: "path.test".to_string(),
            operation_id: "op.test".to_string(),
            moves: vec![AbstractMove::LinearCut {
                x_mm: Some(1.0),
                y_mm: None,
                z_mm: Some(-1.0),
                a_deg: None,
                feed_mm_min: 80.0,
            }],
        };

        let program = postprocess_path(&PostprocessRequest {
            machine_profile: &machine_profile,
            path: &path,
            program_name: "mapped",
            tool_id: None,
            safe_z_mm: 7.0,
        })
        .expect("valid postprocess request");

        let lines = program.lines();
        let m5_index = lines.iter().position(|line| line == "M5").expect("M5");
        assert_eq!(lines[m5_index - 1], "G0 Y7.000");
    }

    #[test]
    fn sanitizes_parenthesized_comments() {
        let machine_profile = carvera_profile(1.0);
        let path = AbstractPath {
            id: "path)bad\nG0 X0".to_string(),
            operation_id: "op(test".to_string(),
            moves: Vec::new(),
        };

        let program = postprocess_path(&PostprocessRequest {
            machine_profile: &machine_profile,
            path: &path,
            program_name: "name)\nM30",
            tool_id: Some("tool)bad"),
            safe_z_mm: 5.0,
        })
        .expect("valid postprocess request");

        for line in program.lines().iter().filter(|line| line.starts_with('(')) {
            assert!(!line[..line.len() - 1].contains(')'));
            assert!(!line.contains('\n'));
            assert!(!line.contains('\r'));
        }
    }

    #[test]
    fn rejects_non_positive_feed_and_invalid_rotary_sign() {
        let machine_profile = carvera_profile(1.0);
        let path = AbstractPath {
            id: "path.test".to_string(),
            operation_id: "op.test".to_string(),
            moves: vec![AbstractMove::LinearCut {
                x_mm: Some(1.0),
                y_mm: None,
                z_mm: None,
                a_deg: None,
                feed_mm_min: 0.0,
            }],
        };

        let feed_error = postprocess_path(&PostprocessRequest {
            machine_profile: &machine_profile,
            path: &path,
            program_name: "feed",
            tool_id: None,
            safe_z_mm: 5.0,
        })
        .expect_err("feed should be rejected");
        assert!(matches!(
            feed_error,
            PostprocessError::NonPositiveValue { field: "feed" }
        ));

        let machine_profile = carvera_profile(2.0);
        let sign_error = postprocess_path(&PostprocessRequest {
            machine_profile: &machine_profile,
            path: &AbstractPath {
                id: "path.test".to_string(),
                operation_id: "op.test".to_string(),
                moves: Vec::new(),
            },
            program_name: "sign",
            tool_id: None,
            safe_z_mm: 5.0,
        })
        .expect_err("rotary sign should be rejected");
        assert!(matches!(
            sign_error,
            PostprocessError::InvalidRotarySign { value: 2.0 }
        ));
    }
}
