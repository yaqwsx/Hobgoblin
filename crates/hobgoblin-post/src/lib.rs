use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MachineProfile {
    pub id: String,
    pub name: String,
    pub axis_mapping: AxisMapping,
    pub limits: MachineLimits,
    pub postprocessor: PostprocessorDialect,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AxisMapping {
    pub shaft_axis: String,
    pub virtual_rack_axis: String,
    pub radial_axis: String,
    pub rotary_axis: String,
    pub rotary_sign: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MachineLimits {
    pub max_stock_diameter_mm: f64,
    pub max_stock_length_mm: f64,
    pub travel_x_mm: f64,
    pub travel_y_mm: f64,
    pub travel_z_mm: f64,
    pub max_spindle_rpm: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PostprocessorDialect {
    CarveraAir,
}

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

