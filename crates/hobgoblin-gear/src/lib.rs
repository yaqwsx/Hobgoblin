use hobgoblin_core::SpurGear;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct SpurGearDimensions {
    pub pitch_diameter_mm: f64,
    pub pitch_radius_mm: f64,
    pub outer_diameter_mm: f64,
    pub root_diameter_mm: f64,
    pub base_diameter_mm: f64,
    pub addendum_mm: f64,
    pub dedendum_mm: f64,
    pub profile_shift_mm: f64,
    pub circular_pitch_mm: f64,
    pub tooth_thickness_at_pitch_mm: f64,
    pub whole_depth_mm: f64,
    pub working_depth_mm: f64,
    pub minimum_teeth_without_undercut: f64,
    pub minimum_profile_shift_without_undercut: f64,
}

pub fn derive_spur_dimensions(gear: &SpurGear) -> SpurGearDimensions {
    let tooth_count = gear.tooth_count as f64;
    let pitch_diameter_mm = gear.module_mm * tooth_count;
    let pitch_radius_mm = pitch_diameter_mm / 2.0;
    let pressure_angle_rad = gear.pressure_angle_deg.to_radians();
    let profile_shift_mm = gear.profile_shift * gear.module_mm;
    let addendum_mm = (gear.addendum_coeff + gear.profile_shift) * gear.module_mm;
    let dedendum_mm = (gear.dedendum_coeff - gear.profile_shift) * gear.module_mm;
    let circular_pitch_mm = std::f64::consts::PI * gear.module_mm;
    let tooth_thickness_at_pitch_mm = circular_pitch_mm / 2.0
        + 2.0 * profile_shift_mm * pressure_angle_rad.tan()
        - gear.backlash_mm;

    SpurGearDimensions {
        pitch_diameter_mm,
        pitch_radius_mm,
        outer_diameter_mm: pitch_diameter_mm + 2.0 * addendum_mm,
        root_diameter_mm: pitch_diameter_mm - 2.0 * dedendum_mm,
        base_diameter_mm: pitch_diameter_mm * pressure_angle_rad.cos(),
        addendum_mm,
        dedendum_mm,
        profile_shift_mm,
        circular_pitch_mm,
        tooth_thickness_at_pitch_mm,
        whole_depth_mm: addendum_mm + dedendum_mm,
        working_depth_mm: 2.0 * gear.addendum_coeff * gear.module_mm,
        minimum_teeth_without_undercut: minimum_teeth_without_undercut(
            gear.addendum_coeff,
            pressure_angle_rad,
        ),
        minimum_profile_shift_without_undercut: minimum_profile_shift_without_undercut(
            gear.tooth_count,
            gear.addendum_coeff,
            pressure_angle_rad,
        ),
    }
}

pub fn minimum_teeth_without_undercut(addendum_coeff: f64, pressure_angle_rad: f64) -> f64 {
    2.0 * addendum_coeff / pressure_angle_rad.sin().powi(2)
}

pub fn minimum_profile_shift_without_undercut(
    tooth_count: u32,
    addendum_coeff: f64,
    pressure_angle_rad: f64,
) -> f64 {
    addendum_coeff - tooth_count as f64 * pressure_angle_rad.sin().powi(2) / 2.0
}

pub fn has_undercut_risk(gear: &SpurGear) -> bool {
    gear.profile_shift
        < minimum_profile_shift_without_undercut(
            gear.tooth_count,
            gear.addendum_coeff,
            gear.pressure_angle_deg.to_radians(),
        )
}

pub fn conjugate_stock_rotation_rad(rack_displacement_mm: f64, pitch_radius_mm: f64) -> f64 {
    rack_displacement_mm / pitch_radius_mm
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RackSteppingQuality {
    Draft,
    Standard,
    Fine,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct AdaptiveRackSteppingConfig {
    pub quality: RackSteppingQuality,
    pub tolerance_mm: f64,
    pub min_step_mm: f64,
    pub max_step_mm: f64,
    pub root_zone_fraction: f64,
    pub root_density_multiplier: f64,
}

impl AdaptiveRackSteppingConfig {
    pub fn for_quality(quality: RackSteppingQuality) -> Self {
        match quality {
            RackSteppingQuality::Draft => Self {
                quality,
                tolerance_mm: 0.03,
                min_step_mm: 0.08,
                max_step_mm: 0.75,
                root_zone_fraction: 0.22,
                root_density_multiplier: 1.5,
            },
            RackSteppingQuality::Standard => Self {
                quality,
                tolerance_mm: 0.015,
                min_step_mm: 0.04,
                max_step_mm: 0.45,
                root_zone_fraction: 0.25,
                root_density_multiplier: 2.0,
            },
            RackSteppingQuality::Fine => Self {
                quality,
                tolerance_mm: 0.006,
                min_step_mm: 0.02,
                max_step_mm: 0.25,
                root_zone_fraction: 0.28,
                root_density_multiplier: 2.8,
            },
        }
    }
}

impl Default for AdaptiveRackSteppingConfig {
    fn default() -> Self {
        Self::for_quality(RackSteppingQuality::Standard)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AdaptiveRackSteppingWarning {
    ToleranceBelowMinimumStepCapability,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AdaptiveRackStep {
    pub index: u32,
    pub tooth_index: u32,
    pub rack_step_index: u32,
    pub rack_displacement_mm: f64,
    pub local_step_mm: f64,
    pub estimated_error_mm: f64,
    pub in_root_zone: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AdaptiveRackSteppingPlan {
    pub quality: RackSteppingQuality,
    pub circular_pitch_mm: f64,
    pub generated_step_count: usize,
    pub estimated_path_move_count_per_depth_layer: usize,
    pub estimated_max_error_mm: f64,
    pub min_step_mm: f64,
    pub max_step_mm: f64,
    pub tolerance_mm: f64,
    pub warnings: Vec<AdaptiveRackSteppingWarning>,
    pub steps: Vec<AdaptiveRackStep>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AdaptiveRackSteppingError {
    ToleranceMustBeFiniteAndPositive,
    MinStepMustBeFiniteAndPositive,
    MaxStepMustBeFiniteAndPositive,
    MaxStepMustBeAtLeastMinStep,
    RootZoneFractionMustBeFiniteAndNonNegative,
    RootDensityMultiplierMustBeFiniteAndAtLeastOne,
    ToothCountTooLarge,
    StepBoundsInfeasible,
}

impl std::fmt::Display for AdaptiveRackSteppingError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ToleranceMustBeFiniteAndPositive => {
                write!(
                    formatter,
                    "rack stepping tolerance must be finite and positive"
                )
            }
            Self::MinStepMustBeFiniteAndPositive => {
                write!(formatter, "minimum rack step must be finite and positive")
            }
            Self::MaxStepMustBeFiniteAndPositive => {
                write!(formatter, "maximum rack step must be finite and positive")
            }
            Self::MaxStepMustBeAtLeastMinStep => {
                write!(
                    formatter,
                    "maximum rack step must be at least the minimum rack step"
                )
            }
            Self::RootZoneFractionMustBeFiniteAndNonNegative => {
                write!(
                    formatter,
                    "root zone fraction must be finite and greater than or equal to zero"
                )
            }
            Self::RootDensityMultiplierMustBeFiniteAndAtLeastOne => {
                write!(
                    formatter,
                    "root density multiplier must be finite and greater than or equal to one"
                )
            }
            Self::ToothCountTooLarge => write!(formatter, "gear tooth count is too large"),
            Self::StepBoundsInfeasible => write!(
                formatter,
                "rack step bounds cannot subdivide the requested gear pitch intervals"
            ),
        }
    }
}

impl std::error::Error for AdaptiveRackSteppingError {}

pub fn plan_adaptive_rack_steps(
    gear: &SpurGear,
    config: AdaptiveRackSteppingConfig,
) -> Result<AdaptiveRackSteppingPlan, AdaptiveRackSteppingError> {
    validate_adaptive_rack_stepping_config(config)?;

    let dimensions = derive_spur_dimensions(gear);
    let circular_pitch_mm = dimensions.circular_pitch_mm;
    let whole_depth_factor = (dimensions.whole_depth_mm / gear.module_mm).max(1.0);
    let pressure_angle_rad = gear.pressure_angle_deg.to_radians();
    let pressure_factor = 1.0 / pressure_angle_rad.cos().max(0.25);
    let base_radius_mm = (dimensions.base_diameter_mm / 2.0).max(gear.module_mm);
    let root_radius_mm = (dimensions.root_diameter_mm / 2.0).max(gear.module_mm * 0.25);
    let mut warnings = Vec::new();

    let root_zone_fraction = config.root_zone_fraction.clamp(0.0, 0.49);
    let root_density_multiplier = config.root_density_multiplier.max(1.0);
    let mut root_zone_width_mm = circular_pitch_mm * root_zone_fraction;
    if circular_pitch_mm < config.min_step_mm {
        return Err(AdaptiveRackSteppingError::StepBoundsInfeasible);
    }
    if root_zone_width_mm > 0.0 {
        root_zone_width_mm = root_zone_width_mm.max(config.min_step_mm);
    }
    root_zone_width_mm = root_zone_width_mm.min(circular_pitch_mm * 0.49);

    let mut steps = Vec::new();
    steps.push(AdaptiveRackStep {
        index: 0,
        tooth_index: 0,
        rack_step_index: 0,
        rack_displacement_mm: 0.0,
        local_step_mm: 0.0,
        estimated_error_mm: 0.0,
        in_root_zone: true,
    });

    let mut index = 1_u32;
    for tooth_index in 0..gear.tooth_count {
        let tooth_start_mm = tooth_index as f64 * circular_pitch_mm;
        let intervals = adaptive_tooth_intervals(circular_pitch_mm, root_zone_width_mm);
        let mut rack_step_index = 1_u32;

        for interval in intervals {
            let interval_length_mm = interval.end_mm - interval.start_mm;
            if interval_length_mm <= f64::EPSILON {
                continue;
            }
            let local_midpoint_mm = (interval.start_mm + interval.end_mm) / 2.0;
            let context = local_profile_error_context(
                local_midpoint_mm,
                circular_pitch_mm,
                root_zone_width_mm,
                root_radius_mm,
                base_radius_mm,
            );
            let mut target_step_mm = (8.0 * config.tolerance_mm * context.effective_radius_mm
                / (whole_depth_factor * pressure_factor * context.error_multiplier))
                .sqrt();
            if interval.in_root_zone {
                target_step_mm /= root_density_multiplier;
            }
            target_step_mm = target_step_mm.min(config.max_step_mm);
            if target_step_mm < config.min_step_mm {
                push_unique_warning(
                    &mut warnings,
                    AdaptiveRackSteppingWarning::ToleranceBelowMinimumStepCapability,
                );
                target_step_mm = config.min_step_mm;
            }
            let segment_count = choose_bounded_segment_count(
                interval_length_mm,
                target_step_mm,
                config.min_step_mm,
                config.max_step_mm,
            )?;
            let local_step_mm = interval_length_mm / segment_count as f64;
            let estimated_error_mm = estimate_rack_step_error_mm(
                local_step_mm,
                context.effective_radius_mm,
                whole_depth_factor,
                pressure_angle_rad,
                context.error_multiplier,
            );

            for segment_index in 1..=segment_count {
                let local_position_mm = interval.start_mm + local_step_mm * segment_index as f64;
                let rack_displacement_mm = (tooth_start_mm + local_position_mm)
                    .min(circular_pitch_mm * gear.tooth_count as f64);
                steps.push(AdaptiveRackStep {
                    index,
                    tooth_index,
                    rack_step_index,
                    rack_displacement_mm,
                    local_step_mm,
                    estimated_error_mm,
                    in_root_zone: interval.in_root_zone,
                });
                index = index
                    .checked_add(1)
                    .ok_or(AdaptiveRackSteppingError::ToothCountTooLarge)?;
                rack_step_index = rack_step_index
                    .checked_add(1)
                    .ok_or(AdaptiveRackSteppingError::ToothCountTooLarge)?;
            }
        }
    }

    let estimated_max_error_mm = steps
        .iter()
        .map(|step| step.estimated_error_mm)
        .fold(0.0, f64::max);
    let generated_step_count = steps.len();

    Ok(AdaptiveRackSteppingPlan {
        quality: config.quality,
        circular_pitch_mm,
        generated_step_count,
        estimated_path_move_count_per_depth_layer: generated_step_count * 4,
        estimated_max_error_mm,
        min_step_mm: steps
            .iter()
            .skip(1)
            .map(|step| step.local_step_mm)
            .fold(f64::INFINITY, f64::min),
        max_step_mm: steps
            .iter()
            .map(|step| step.local_step_mm)
            .fold(0.0, f64::max),
        tolerance_mm: config.tolerance_mm,
        warnings,
        steps,
    })
}

#[derive(Debug, Clone, Copy)]
struct LocalProfileErrorContext {
    effective_radius_mm: f64,
    error_multiplier: f64,
}

fn local_profile_error_context(
    local_pitch_position_mm: f64,
    circular_pitch_mm: f64,
    root_zone_width_mm: f64,
    root_radius_mm: f64,
    base_radius_mm: f64,
) -> LocalProfileErrorContext {
    if root_zone_width_mm <= f64::EPSILON {
        return LocalProfileErrorContext {
            effective_radius_mm: base_radius_mm,
            error_multiplier: 1.0,
        };
    }

    let distance_to_boundary_mm =
        local_pitch_position_mm.min(circular_pitch_mm - local_pitch_position_mm);
    let root_fraction = (1.0 - distance_to_boundary_mm / root_zone_width_mm).clamp(0.0, 1.0);
    let smooth_root_fraction = root_fraction * root_fraction * (3.0 - 2.0 * root_fraction);
    LocalProfileErrorContext {
        effective_radius_mm: base_radius_mm
            - (base_radius_mm - root_radius_mm) * smooth_root_fraction,
        error_multiplier: 1.0 + 0.35 * smooth_root_fraction,
    }
}

fn push_unique_warning(
    warnings: &mut Vec<AdaptiveRackSteppingWarning>,
    warning: AdaptiveRackSteppingWarning,
) {
    if !warnings.contains(&warning) {
        warnings.push(warning);
    }
}

#[derive(Debug, Clone, Copy)]
struct AdaptiveRackInterval {
    start_mm: f64,
    end_mm: f64,
    in_root_zone: bool,
}

fn adaptive_tooth_intervals(
    circular_pitch_mm: f64,
    root_zone_width_mm: f64,
) -> Vec<AdaptiveRackInterval> {
    if root_zone_width_mm <= f64::EPSILON {
        return vec![AdaptiveRackInterval {
            start_mm: 0.0,
            end_mm: circular_pitch_mm,
            in_root_zone: false,
        }];
    }

    if circular_pitch_mm >= 2.0 * root_zone_width_mm {
        let middle_start_mm = root_zone_width_mm;
        let middle_end_mm = circular_pitch_mm - root_zone_width_mm;
        let mut intervals = vec![AdaptiveRackInterval {
            start_mm: 0.0,
            end_mm: middle_start_mm,
            in_root_zone: true,
        }];
        if middle_end_mm > middle_start_mm {
            intervals.push(AdaptiveRackInterval {
                start_mm: middle_start_mm,
                end_mm: middle_end_mm,
                in_root_zone: false,
            });
        }
        intervals.push(AdaptiveRackInterval {
            start_mm: middle_end_mm,
            end_mm: circular_pitch_mm,
            in_root_zone: true,
        });
        intervals
    } else {
        vec![AdaptiveRackInterval {
            start_mm: 0.0,
            end_mm: circular_pitch_mm,
            in_root_zone: true,
        }]
    }
}

fn choose_bounded_segment_count(
    interval_length_mm: f64,
    target_step_mm: f64,
    min_step_mm: f64,
    max_step_mm: f64,
) -> Result<u32, AdaptiveRackSteppingError> {
    let min_segments = (interval_length_mm / max_step_mm).ceil().max(1.0) as u32;
    let max_segments = (interval_length_mm / min_step_mm).floor() as u32;
    if min_segments > max_segments {
        return Err(AdaptiveRackSteppingError::StepBoundsInfeasible);
    }

    let desired_segments = (interval_length_mm / target_step_mm).ceil().max(1.0) as u32;
    Ok(desired_segments.clamp(min_segments, max_segments))
}

fn validate_adaptive_rack_stepping_config(
    config: AdaptiveRackSteppingConfig,
) -> Result<(), AdaptiveRackSteppingError> {
    if !config.tolerance_mm.is_finite() || config.tolerance_mm <= 0.0 {
        return Err(AdaptiveRackSteppingError::ToleranceMustBeFiniteAndPositive);
    }
    if !config.min_step_mm.is_finite() || config.min_step_mm <= 0.0 {
        return Err(AdaptiveRackSteppingError::MinStepMustBeFiniteAndPositive);
    }
    if !config.max_step_mm.is_finite() || config.max_step_mm <= 0.0 {
        return Err(AdaptiveRackSteppingError::MaxStepMustBeFiniteAndPositive);
    }
    if config.max_step_mm < config.min_step_mm {
        return Err(AdaptiveRackSteppingError::MaxStepMustBeAtLeastMinStep);
    }
    if !config.root_zone_fraction.is_finite() || config.root_zone_fraction < 0.0 {
        return Err(AdaptiveRackSteppingError::RootZoneFractionMustBeFiniteAndNonNegative);
    }
    if !config.root_density_multiplier.is_finite() || config.root_density_multiplier < 1.0 {
        return Err(AdaptiveRackSteppingError::RootDensityMultiplierMustBeFiniteAndAtLeastOne);
    }

    Ok(())
}

fn estimate_rack_step_error_mm(
    step_mm: f64,
    effective_radius_mm: f64,
    whole_depth_factor: f64,
    pressure_angle_rad: f64,
    local_error_multiplier: f64,
) -> f64 {
    let pressure_factor = 1.0 / pressure_angle_rad.cos().max(0.25);
    step_mm.powi(2) / (8.0 * effective_radius_mm)
        * whole_depth_factor
        * pressure_factor
        * local_error_multiplier
}

#[cfg(test)]
mod tests {
    use super::*;
    use hobgoblin_core::GearMachining;

    fn assert_close(actual: f64, expected: f64) {
        assert!(
            (actual - expected).abs() < 1.0e-9,
            "expected {expected}, got {actual}"
        );
    }

    #[test]
    fn derives_standard_spur_dimensions() {
        let gear = SpurGear {
            module_mm: 2.0,
            tooth_count: 20,
            pressure_angle_deg: 20.0,
            profile_shift: 0.0,
            addendum_coeff: 1.0,
            dedendum_coeff: 1.25,
            backlash_mm: 0.0,
            phase_deg: 0.0,
            machining: GearMachining::default(),
        };

        let dimensions = derive_spur_dimensions(&gear);
        assert_eq!(dimensions.pitch_diameter_mm, 40.0);
        assert_eq!(dimensions.outer_diameter_mm, 44.0);
        assert_eq!(dimensions.root_diameter_mm, 35.0);
        assert_close(dimensions.addendum_mm, 2.0);
        assert_close(dimensions.dedendum_mm, 2.5);
        assert_close(dimensions.whole_depth_mm, 4.5);
        assert_close(dimensions.working_depth_mm, 4.0);
        assert_close(dimensions.tooth_thickness_at_pitch_mm, std::f64::consts::PI);
        assert!(!has_undercut_risk(&gear));
    }

    #[test]
    fn derives_shifted_spur_dimensions() {
        let gear = SpurGear {
            module_mm: 1.0,
            tooth_count: 16,
            pressure_angle_deg: 20.0,
            profile_shift: 0.5,
            addendum_coeff: 1.0,
            dedendum_coeff: 1.25,
            backlash_mm: 0.05,
            phase_deg: 0.0,
            machining: GearMachining::default(),
        };

        let dimensions = derive_spur_dimensions(&gear);

        assert_close(dimensions.pitch_diameter_mm, 16.0);
        assert_close(dimensions.outer_diameter_mm, 19.0);
        assert_close(dimensions.root_diameter_mm, 14.5);
        assert_close(dimensions.addendum_mm, 1.5);
        assert_close(dimensions.dedendum_mm, 0.75);
        assert_close(dimensions.profile_shift_mm, 0.5);
        assert_close(dimensions.whole_depth_mm, 2.25);
        assert_close(dimensions.working_depth_mm, 2.0);
        assert_close(
            dimensions.tooth_thickness_at_pitch_mm,
            std::f64::consts::PI / 2.0 + 2.0 * 0.5 * 20.0_f64.to_radians().tan() - 0.05,
        );
        assert!(!has_undercut_risk(&gear));
    }

    #[test]
    fn reports_undercut_risk_for_low_tooth_unshifted_gears() {
        let gear = SpurGear {
            module_mm: 1.0,
            tooth_count: 12,
            pressure_angle_deg: 20.0,
            profile_shift: 0.0,
            addendum_coeff: 1.0,
            dedendum_coeff: 1.25,
            backlash_mm: 0.0,
            phase_deg: 0.0,
            machining: GearMachining::default(),
        };

        let dimensions = derive_spur_dimensions(&gear);

        assert!(dimensions.minimum_teeth_without_undercut > 17.0);
        assert!(dimensions.minimum_profile_shift_without_undercut > 0.0);
        assert!(has_undercut_risk(&gear));
    }

    #[test]
    fn plans_deterministic_adaptive_rack_steps_for_standard_gear() {
        let gear = SpurGear {
            module_mm: 1.0,
            tooth_count: 12,
            pressure_angle_deg: 20.0,
            profile_shift: 0.0,
            addendum_coeff: 1.0,
            dedendum_coeff: 1.25,
            backlash_mm: 0.0,
            phase_deg: 0.0,
            machining: GearMachining::default(),
        };
        let config = AdaptiveRackSteppingConfig {
            max_step_mm: 0.6,
            ..AdaptiveRackSteppingConfig::for_quality(RackSteppingQuality::Standard)
        };

        let first = plan_adaptive_rack_steps(&gear, config).expect("valid stepping config");
        let second = plan_adaptive_rack_steps(&gear, config).expect("valid stepping config");

        assert_eq!(first, second);
        assert_eq!(first.quality, RackSteppingQuality::Standard);
        assert_eq!(first.generated_step_count, first.steps.len());
        assert_eq!(first.steps[0].rack_displacement_mm, 0.0);
        assert_close(
            first.steps.last().unwrap().rack_displacement_mm,
            first.circular_pitch_mm * gear.tooth_count as f64,
        );
        assert!(first
            .steps
            .windows(2)
            .all(|window| window[0].rack_displacement_mm < window[1].rack_displacement_mm));
        assert!(first.estimated_max_error_mm <= first.tolerance_mm);
        assert!(first.steps.iter().skip(1).all(|step| {
            step.local_step_mm >= config.min_step_mm && step.local_step_mm <= config.max_step_mm
        }));
        assert_eq!(first.generated_step_count, 133);
        assert_close(first.min_step_mm, std::f64::consts::PI / 16.0);
        assert_close(first.max_step_mm, std::f64::consts::PI / 6.0);
        assert_close(
            first.steps[1].rack_displacement_mm,
            std::f64::consts::PI / 16.0,
        );
        assert_close(
            first.steps[2].rack_displacement_mm,
            std::f64::consts::PI / 8.0,
        );
        assert!(first.steps[1].in_root_zone);
    }

    #[test]
    fn adaptive_rack_steps_warn_when_tolerance_is_impractical() {
        let gear = SpurGear {
            module_mm: 1.0,
            tooth_count: 20,
            pressure_angle_deg: 20.0,
            profile_shift: 0.0,
            addendum_coeff: 1.0,
            dedendum_coeff: 1.25,
            backlash_mm: 0.0,
            phase_deg: 0.0,
            machining: GearMachining::default(),
        };
        let config = AdaptiveRackSteppingConfig {
            tolerance_mm: 0.000001,
            min_step_mm: 0.2,
            max_step_mm: 0.5,
            ..AdaptiveRackSteppingConfig::for_quality(RackSteppingQuality::Fine)
        };

        let plan = plan_adaptive_rack_steps(&gear, config).expect("valid stepping config");

        assert!(plan
            .warnings
            .contains(&AdaptiveRackSteppingWarning::ToleranceBelowMinimumStepCapability));
        assert!(plan.estimated_max_error_mm > plan.tolerance_mm);
        assert!(plan
            .steps
            .iter()
            .skip(1)
            .all(|step| step.local_step_mm >= 0.2 && step.local_step_mm <= 0.5));
    }

    #[test]
    fn adaptive_rack_steps_reject_invalid_bounds() {
        let gear = SpurGear {
            module_mm: 1.0,
            tooth_count: 20,
            pressure_angle_deg: 20.0,
            profile_shift: 0.0,
            addendum_coeff: 1.0,
            dedendum_coeff: 1.25,
            backlash_mm: 0.0,
            phase_deg: 0.0,
            machining: GearMachining::default(),
        };

        assert_eq!(
            plan_adaptive_rack_steps(
                &gear,
                AdaptiveRackSteppingConfig {
                    tolerance_mm: 0.0,
                    ..AdaptiveRackSteppingConfig::default()
                }
            )
            .unwrap_err(),
            AdaptiveRackSteppingError::ToleranceMustBeFiniteAndPositive
        );
        assert_eq!(
            plan_adaptive_rack_steps(
                &gear,
                AdaptiveRackSteppingConfig {
                    min_step_mm: f64::NAN,
                    ..AdaptiveRackSteppingConfig::default()
                }
            )
            .unwrap_err(),
            AdaptiveRackSteppingError::MinStepMustBeFiniteAndPositive
        );
        assert_eq!(
            plan_adaptive_rack_steps(
                &gear,
                AdaptiveRackSteppingConfig {
                    min_step_mm: 0.5,
                    max_step_mm: 0.2,
                    ..AdaptiveRackSteppingConfig::default()
                }
            )
            .unwrap_err(),
            AdaptiveRackSteppingError::MaxStepMustBeAtLeastMinStep
        );
        assert_eq!(
            plan_adaptive_rack_steps(
                &gear,
                AdaptiveRackSteppingConfig {
                    root_zone_fraction: f64::NAN,
                    ..AdaptiveRackSteppingConfig::default()
                }
            )
            .unwrap_err(),
            AdaptiveRackSteppingError::RootZoneFractionMustBeFiniteAndNonNegative
        );
        assert_eq!(
            plan_adaptive_rack_steps(
                &gear,
                AdaptiveRackSteppingConfig {
                    root_density_multiplier: 0.5,
                    ..AdaptiveRackSteppingConfig::default()
                }
            )
            .unwrap_err(),
            AdaptiveRackSteppingError::RootDensityMultiplierMustBeFiniteAndAtLeastOne
        );
        assert_eq!(
            plan_adaptive_rack_steps(
                &gear,
                AdaptiveRackSteppingConfig {
                    root_zone_fraction: 0.49,
                    min_step_mm: 0.1,
                    max_step_mm: 0.5,
                    ..AdaptiveRackSteppingConfig::default()
                }
            )
            .unwrap_err(),
            AdaptiveRackSteppingError::StepBoundsInfeasible
        );
    }
}
