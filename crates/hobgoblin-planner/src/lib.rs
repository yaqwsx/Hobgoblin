use hobgoblin_core::{PlanningPurpose, Project, SpurGear, StackItemKind};
use hobgoblin_gear::{
    conjugate_stock_rotation_rad, derive_spur_dimensions, plan_adaptive_rack_steps,
    AdaptiveRackSteppingConfig, AdaptiveRackSteppingError, AdaptiveRackSteppingPlan,
};
use hobgoblin_post::{AbstractMove, AbstractPath};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OperationGraph {
    pub nodes: Vec<OperationNode>,
    pub edges: Vec<OperationDependency>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OperationNode {
    pub id: String,
    pub feature_id: Option<String>,
    pub region_id: Option<String>,
    pub kind: OperationKind,
    pub stage: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OperationDependency {
    pub before: String,
    pub after: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OperationKind {
    CylindricalEnvelopeRough,
    CylindricalFinishSurface,
    GearOdSurface,
    GearRootGenerate,
    GearLeftFlankGenerate,
    GearRightFlankGenerate,
    GearSpringFinish,
    UnsupportedFeature,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpurShapingConfig {
    pub rack_steps_per_tooth: u32,
    pub adaptive_rack_stepping: Option<AdaptiveRackSteppingConfig>,
    pub depth_layers: Vec<f64>,
    pub x_lead_in_mm: f64,
    pub safe_z_mm: f64,
    pub cutting_feed_mm_min: f64,
    pub a_axis_sign: f64,
    pub rack_axis_sign: f64,
}

impl Default for SpurShapingConfig {
    fn default() -> Self {
        Self {
            rack_steps_per_tooth: 5,
            adaptive_rack_stepping: Some(AdaptiveRackSteppingConfig::default()),
            depth_layers: vec![1.0],
            x_lead_in_mm: 1.0,
            safe_z_mm: 5.0,
            cutting_feed_mm_min: 100.0,
            a_axis_sign: 1.0,
            rack_axis_sign: 1.0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpurShapingDebugStep {
    pub tooth_index: u32,
    pub rack_step_index: u32,
    pub depth_layer_index: u32,
    pub rack_displacement_mm: f64,
    pub y_mm: f64,
    pub a_deg: f64,
    pub z_mm: f64,
    pub x_start_mm: f64,
    pub x_end_mm: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpurShapingPath {
    pub path: AbstractPath,
    pub adaptive_rack_stepping: Option<AdaptiveRackSteppingPlan>,
    pub debug_steps: Vec<SpurShapingDebugStep>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SpurShapingError {
    RackStepsPerToothMustBePositive,
    RackStepCountOverflow,
    DepthLayersMustNotBeEmpty,
    DepthLayerMustBeFiniteAndPositive { index: usize },
    AdaptiveRackStepping(AdaptiveRackSteppingError),
}

impl std::fmt::Display for SpurShapingError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::RackStepsPerToothMustBePositive => {
                write!(formatter, "rack steps per tooth must be greater than zero")
            }
            Self::RackStepCountOverflow => write!(formatter, "total rack step count is too large"),
            Self::DepthLayersMustNotBeEmpty => write!(formatter, "depth layers must not be empty"),
            Self::DepthLayerMustBeFiniteAndPositive { index } => write!(
                formatter,
                "depth layer {index} must be finite and greater than zero"
            ),
            Self::AdaptiveRackStepping(error) => write!(formatter, "{error}"),
        }
    }
}

impl std::error::Error for SpurShapingError {}

impl From<AdaptiveRackSteppingError> for SpurShapingError {
    fn from(error: AdaptiveRackSteppingError) -> Self {
        Self::AdaptiveRackStepping(error)
    }
}

pub fn build_initial_operation_graph(project: &Project) -> OperationGraph {
    let mut nodes = Vec::new();
    let mut edges = Vec::new();

    for region in &project.planning_regions {
        if matches!(region.purpose, PlanningPurpose::Roughing) {
            nodes.push(OperationNode {
                id: format!("op.region.{}.rough", region.id),
                feature_id: None,
                region_id: Some(region.id.clone()),
                kind: OperationKind::CylindricalEnvelopeRough,
                stage: region.stage,
            });
        }
    }

    for item in &project.stack {
        match &item.kind {
            StackItemKind::CylindricalSection { .. } => {
                nodes.push(OperationNode {
                    id: format!("op.feature.{}.finish", item.id),
                    feature_id: Some(item.id.clone()),
                    region_id: None,
                    kind: OperationKind::CylindricalFinishSurface,
                    stage: 100,
                });
            }
            StackItemKind::SpurGear { .. } => {
                let od = format!("op.feature.{}.od", item.id);
                let root = format!("op.feature.{}.root", item.id);
                let left = format!("op.feature.{}.left_flank", item.id);
                let right = format!("op.feature.{}.right_flank", item.id);
                let spring = format!("op.feature.{}.spring", item.id);

                nodes.extend([
                    OperationNode {
                        id: od.clone(),
                        feature_id: Some(item.id.clone()),
                        region_id: None,
                        kind: OperationKind::GearOdSurface,
                        stage: 100,
                    },
                    OperationNode {
                        id: root.clone(),
                        feature_id: Some(item.id.clone()),
                        region_id: None,
                        kind: OperationKind::GearRootGenerate,
                        stage: 110,
                    },
                    OperationNode {
                        id: left.clone(),
                        feature_id: Some(item.id.clone()),
                        region_id: None,
                        kind: OperationKind::GearLeftFlankGenerate,
                        stage: 120,
                    },
                    OperationNode {
                        id: right.clone(),
                        feature_id: Some(item.id.clone()),
                        region_id: None,
                        kind: OperationKind::GearRightFlankGenerate,
                        stage: 120,
                    },
                    OperationNode {
                        id: spring.clone(),
                        feature_id: Some(item.id.clone()),
                        region_id: None,
                        kind: OperationKind::GearSpringFinish,
                        stage: 130,
                    },
                ]);

                edges.extend([
                    OperationDependency {
                        before: od.clone(),
                        after: root.clone(),
                        reason: "gear OD must be established before tooth generation".to_string(),
                    },
                    OperationDependency {
                        before: root.clone(),
                        after: left.clone(),
                        reason: "root/gap generation precedes flank finishing".to_string(),
                    },
                    OperationDependency {
                        before: root,
                        after: right.clone(),
                        reason: "root/gap generation precedes flank finishing".to_string(),
                    },
                    OperationDependency {
                        before: left,
                        after: spring.clone(),
                        reason: "left flank finishing precedes spring pass".to_string(),
                    },
                    OperationDependency {
                        before: right,
                        after: spring,
                        reason: "right flank finishing precedes spring pass".to_string(),
                    },
                ]);
            }
            _ => nodes.push(OperationNode {
                id: format!("op.feature.{}.unsupported", item.id),
                feature_id: Some(item.id.clone()),
                region_id: None,
                kind: OperationKind::UnsupportedFeature,
                stage: 100,
            }),
        }
    }

    OperationGraph { nodes, edges }
}

pub fn generate_spur_shaping_path(
    operation_id: impl Into<String>,
    feature_id: &str,
    gear: &SpurGear,
    face_start_s_mm: f64,
    face_width_mm: f64,
    config: &SpurShapingConfig,
) -> Result<SpurShapingPath, SpurShapingError> {
    validate_spur_shaping_config(config)?;

    let operation_id = operation_id.into();
    let dimensions = derive_spur_dimensions(gear);
    let adaptive_rack_stepping = config
        .adaptive_rack_stepping
        .map(|adaptive_config| plan_adaptive_rack_steps(gear, adaptive_config))
        .transpose()?;
    let fixed_total_rack_steps = if adaptive_rack_stepping.is_none() {
        Some(
            gear.tooth_count
                .checked_mul(config.rack_steps_per_tooth)
                .ok_or(SpurShapingError::RackStepCountOverflow)?,
        )
    } else {
        None
    };
    let x_start_mm = face_start_s_mm - config.x_lead_in_mm;
    let x_end_mm = face_start_s_mm + face_width_mm + config.x_lead_in_mm;
    let mut moves = Vec::new();
    let mut debug_steps = Vec::new();

    moves.push(AbstractMove::Rapid {
        x_mm: Some(x_start_mm),
        y_mm: None,
        z_mm: Some(config.safe_z_mm),
        a_deg: None,
    });

    for (depth_layer_index, depth_mm) in config.depth_layers.iter().enumerate() {
        if let Some(adaptive_plan) = &adaptive_rack_stepping {
            for adaptive_step in &adaptive_plan.steps {
                append_spur_shaping_step(
                    &mut moves,
                    &mut debug_steps,
                    gear,
                    dimensions.pitch_radius_mm,
                    config,
                    depth_layer_index as u32,
                    *depth_mm,
                    adaptive_step.tooth_index,
                    adaptive_step.rack_step_index,
                    adaptive_step.rack_displacement_mm,
                    x_start_mm,
                    x_end_mm,
                );
            }
        } else {
            let total_rack_steps = fixed_total_rack_steps.expect("fixed rack step count");
            let circular_pitch = dimensions.circular_pitch_mm;
            let rack_step_count = config.rack_steps_per_tooth;
            let rack_step_mm = circular_pitch / rack_step_count as f64;
            for global_rack_step_index in 0..=total_rack_steps {
                let (tooth_index, rack_step_index) = if global_rack_step_index == total_rack_steps {
                    (gear.tooth_count - 1, rack_step_count)
                } else {
                    (
                        global_rack_step_index / rack_step_count,
                        global_rack_step_index % rack_step_count,
                    )
                };
                let rack_displacement_mm = global_rack_step_index as f64 * rack_step_mm;
                append_spur_shaping_step(
                    &mut moves,
                    &mut debug_steps,
                    gear,
                    dimensions.pitch_radius_mm,
                    config,
                    depth_layer_index as u32,
                    *depth_mm,
                    tooth_index,
                    rack_step_index,
                    rack_displacement_mm,
                    x_start_mm,
                    x_end_mm,
                );
            }
        }
    }

    Ok(SpurShapingPath {
        path: AbstractPath {
            id: format!("path.{feature_id}.generated_shaping"),
            operation_id,
            moves,
        },
        adaptive_rack_stepping,
        debug_steps,
    })
}

#[allow(clippy::too_many_arguments)]
fn append_spur_shaping_step(
    moves: &mut Vec<AbstractMove>,
    debug_steps: &mut Vec<SpurShapingDebugStep>,
    gear: &SpurGear,
    pitch_radius_mm: f64,
    config: &SpurShapingConfig,
    depth_layer_index: u32,
    depth_mm: f64,
    tooth_index: u32,
    rack_step_index: u32,
    rack_displacement_mm: f64,
    x_start_mm: f64,
    x_end_mm: f64,
) {
    let y_mm = config.rack_axis_sign * rack_displacement_mm;
    let a_rad =
        config.a_axis_sign * conjugate_stock_rotation_rad(rack_displacement_mm, pitch_radius_mm);
    let a_deg = gear.phase_deg + a_rad.to_degrees();
    let z_mm = -depth_mm;

    moves.extend([
        AbstractMove::Rapid {
            x_mm: Some(x_start_mm),
            y_mm: Some(y_mm),
            z_mm: Some(config.safe_z_mm),
            a_deg: Some(a_deg),
        },
        AbstractMove::Rapid {
            x_mm: Some(x_start_mm),
            y_mm: Some(y_mm),
            z_mm: Some(z_mm),
            a_deg: Some(a_deg),
        },
        AbstractMove::LinearCut {
            x_mm: Some(x_end_mm),
            y_mm: Some(y_mm),
            z_mm: Some(z_mm),
            a_deg: Some(a_deg),
            feed_mm_min: config.cutting_feed_mm_min,
        },
        AbstractMove::Rapid {
            x_mm: Some(x_end_mm),
            y_mm: Some(y_mm),
            z_mm: Some(config.safe_z_mm),
            a_deg: Some(a_deg),
        },
    ]);

    debug_steps.push(SpurShapingDebugStep {
        tooth_index,
        rack_step_index,
        depth_layer_index,
        rack_displacement_mm,
        y_mm,
        a_deg,
        z_mm,
        x_start_mm,
        x_end_mm,
    });
}

fn validate_spur_shaping_config(config: &SpurShapingConfig) -> Result<(), SpurShapingError> {
    if config.adaptive_rack_stepping.is_none() && config.rack_steps_per_tooth == 0 {
        return Err(SpurShapingError::RackStepsPerToothMustBePositive);
    }
    if config.depth_layers.is_empty() {
        return Err(SpurShapingError::DepthLayersMustNotBeEmpty);
    }
    for (index, depth_mm) in config.depth_layers.iter().enumerate() {
        if !depth_mm.is_finite() || *depth_mm <= 0.0 {
            return Err(SpurShapingError::DepthLayerMustBeFiniteAndPositive { index });
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use hobgoblin_core::GearMachining;

    fn sample_gear() -> SpurGear {
        SpurGear {
            module_mm: 1.0,
            tooth_count: 4,
            pressure_angle_deg: 20.0,
            profile_shift: 0.0,
            addendum_coeff: 1.0,
            dedendum_coeff: 1.25,
            backlash_mm: 0.0,
            phase_deg: 0.0,
            machining: GearMachining::default(),
        }
    }

    #[test]
    fn generates_deterministic_spur_shaping_debug_steps() {
        let config = SpurShapingConfig {
            rack_steps_per_tooth: 2,
            adaptive_rack_stepping: None,
            depth_layers: vec![0.25, 0.5],
            x_lead_in_mm: 1.0,
            safe_z_mm: 3.0,
            cutting_feed_mm_min: 120.0,
            a_axis_sign: 1.0,
            rack_axis_sign: 1.0,
        };

        let result = generate_spur_shaping_path(
            "op.feature.test.left_flank",
            "feature.test",
            &sample_gear(),
            10.0,
            5.0,
            &config,
        )
        .expect("valid shaping config");

        assert_eq!(result.debug_steps.len(), 18);
        assert_eq!(result.path.moves.len(), 73);
        assert_eq!(result.debug_steps[0].tooth_index, 0);
        assert_eq!(result.debug_steps[0].rack_step_index, 0);
        assert_eq!(result.debug_steps[0].x_start_mm, 9.0);
        assert_eq!(result.debug_steps[0].x_end_mm, 16.0);
        assert_eq!(result.debug_steps[0].z_mm, -0.25);
        assert!(
            (result.debug_steps[1].rack_displacement_mm - std::f64::consts::PI / 2.0).abs()
                < 1.0e-9
        );
        assert!((result.debug_steps[1].a_deg - 45.0).abs() < 1.0e-9);
        assert_eq!(result.debug_steps[17].depth_layer_index, 1);
        assert!(result.debug_steps.windows(2).all(|window| {
            window[0].depth_layer_index != window[1].depth_layer_index
                || window[0].rack_displacement_mm < window[1].rack_displacement_mm
        }));
    }

    #[test]
    fn honors_axis_sign_and_phase() {
        let mut gear = sample_gear();
        gear.phase_deg = 10.0;
        let config = SpurShapingConfig {
            rack_steps_per_tooth: 1,
            adaptive_rack_stepping: None,
            depth_layers: vec![0.25],
            a_axis_sign: -1.0,
            rack_axis_sign: -1.0,
            ..SpurShapingConfig::default()
        };

        let result = generate_spur_shaping_path(
            "op.feature.test.left_flank",
            "feature.test",
            &gear,
            0.0,
            2.0,
            &config,
        )
        .expect("valid shaping config");

        assert_eq!(result.debug_steps[1].y_mm, -std::f64::consts::PI);
        assert!((result.debug_steps[1].a_deg + 80.0).abs() < 1.0e-9);
    }

    #[test]
    fn uses_adaptive_rack_stepping_when_configured() {
        let config = SpurShapingConfig {
            rack_steps_per_tooth: 0,
            depth_layers: vec![0.25],
            adaptive_rack_stepping: Some(AdaptiveRackSteppingConfig {
                tolerance_mm: 0.02,
                min_step_mm: 0.05,
                max_step_mm: 0.4,
                ..AdaptiveRackSteppingConfig::default()
            }),
            ..SpurShapingConfig::default()
        };

        let result = generate_spur_shaping_path(
            "op.feature.test.left_flank",
            "feature.test",
            &sample_gear(),
            0.0,
            2.0,
            &config,
        )
        .expect("valid adaptive shaping config");
        let plan = result
            .adaptive_rack_stepping
            .as_ref()
            .expect("adaptive stepping report");

        assert_eq!(result.debug_steps.len(), plan.generated_step_count);
        assert_eq!(result.path.moves.len(), 1 + plan.generated_step_count * 4);
        assert_eq!(result.debug_steps[0].rack_displacement_mm, 0.0);
        assert_eq!(
            result.debug_steps.last().unwrap().rack_displacement_mm,
            plan.steps.last().unwrap().rack_displacement_mm
        );
        assert!(plan.estimated_max_error_mm <= plan.tolerance_mm);
    }

    #[test]
    fn rejects_invalid_spur_shaping_config() {
        let invalid_steps = SpurShapingConfig {
            rack_steps_per_tooth: 0,
            adaptive_rack_stepping: None,
            ..SpurShapingConfig::default()
        };
        assert_eq!(
            generate_spur_shaping_path(
                "op",
                "feature.test",
                &sample_gear(),
                0.0,
                2.0,
                &invalid_steps
            )
            .unwrap_err(),
            SpurShapingError::RackStepsPerToothMustBePositive
        );

        let overflow_steps = SpurShapingConfig {
            rack_steps_per_tooth: u32::MAX,
            adaptive_rack_stepping: None,
            ..SpurShapingConfig::default()
        };
        assert_eq!(
            generate_spur_shaping_path(
                "op",
                "feature.test",
                &sample_gear(),
                0.0,
                2.0,
                &overflow_steps,
            )
            .unwrap_err(),
            SpurShapingError::RackStepCountOverflow
        );

        let invalid_depth = SpurShapingConfig {
            adaptive_rack_stepping: None,
            depth_layers: vec![0.25, -0.5],
            ..SpurShapingConfig::default()
        };
        assert_eq!(
            generate_spur_shaping_path(
                "op",
                "feature.test",
                &sample_gear(),
                0.0,
                2.0,
                &invalid_depth
            )
            .unwrap_err(),
            SpurShapingError::DepthLayerMustBeFiniteAndPositive { index: 1 }
        );
    }
}
