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
}
