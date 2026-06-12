use hobgoblin_core::SpurGear;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct SpurGearDimensions {
    pub pitch_diameter_mm: f64,
    pub pitch_radius_mm: f64,
    pub outer_diameter_mm: f64,
    pub root_diameter_mm: f64,
    pub base_diameter_mm: f64,
    pub circular_pitch_mm: f64,
    pub tooth_thickness_at_pitch_mm: f64,
    pub whole_depth_mm: f64,
    pub working_depth_mm: f64,
}

pub fn derive_spur_dimensions(gear: &SpurGear) -> SpurGearDimensions {
    let tooth_count = gear.tooth_count as f64;
    let pitch_diameter_mm = gear.module_mm * tooth_count;
    let pitch_radius_mm = pitch_diameter_mm / 2.0;
    let addendum_mm = gear.addendum_coeff * gear.module_mm;
    let dedendum_mm = gear.dedendum_coeff * gear.module_mm;
    let pressure_angle_rad = gear.pressure_angle_deg.to_radians();

    SpurGearDimensions {
        pitch_diameter_mm,
        pitch_radius_mm,
        outer_diameter_mm: pitch_diameter_mm + 2.0 * addendum_mm,
        root_diameter_mm: pitch_diameter_mm - 2.0 * dedendum_mm,
        base_diameter_mm: pitch_diameter_mm * pressure_angle_rad.cos(),
        circular_pitch_mm: std::f64::consts::PI * gear.module_mm,
        tooth_thickness_at_pitch_mm: std::f64::consts::PI * gear.module_mm / 2.0 - gear.backlash_mm,
        whole_depth_mm: addendum_mm + dedendum_mm,
        working_depth_mm: 2.0 * addendum_mm,
    }
}

pub fn conjugate_stock_rotation_rad(rack_displacement_mm: f64, pitch_radius_mm: f64) -> f64 {
    rack_displacement_mm / pitch_radius_mm
}

#[cfg(test)]
mod tests {
    use super::*;
    use hobgoblin_core::GearMachining;

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
    }
}

