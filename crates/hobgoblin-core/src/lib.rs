use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

pub const CURRENT_SCHEMA_VERSION: u32 = 0;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub schema_version: u32,
    pub unit_system: UnitSystem,
    pub project: ProjectMetadata,
    pub setup: Setup,
    pub stock: Stock,
    pub stack: Vec<StackItem>,
    #[serde(default)]
    pub planning_regions: Vec<PlanningRegion>,
    #[serde(default)]
    pub library_refs: LibraryRefs,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum UnitSystem {
    Metric,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectMetadata {
    pub id: String,
    pub name: String,
    pub datum: Datum,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DatumKind {
    UserDefined,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Datum {
    pub kind: DatumKind,
    pub s_offset_mm: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Setup {
    pub id: String,
    pub name: String,
    pub machine_profile_id: String,
    pub workholding: Workholding,
    #[serde(default)]
    pub protected_intervals: Vec<ProtectedInterval>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Workholding {
    pub held_side: HeldSide,
    pub tailstock: Tailstock,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HeldSide {
    Left,
    Right,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tailstock {
    pub enabled: bool,
    pub protected_start_s_mm: Option<f64>,
    pub protected_end_s_mm: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProtectedInterval {
    pub id: String,
    pub purpose: ProtectedPurpose,
    pub start_s_mm: f64,
    pub end_s_mm: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProtectedPurpose {
    ChuckGrip,
    Tailstock,
    DoNotMachine,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Stock {
    pub id: String,
    pub diameter_mm: f64,
    pub length_mm: f64,
    pub material_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StackItem {
    pub id: String,
    pub name: String,
    pub length_mm: f64,
    #[serde(flatten)]
    pub kind: StackItemKind,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum StackItemKind {
    CylindricalSection {
        radius_mm: f64,
        #[serde(default)]
        machining: FeatureMachining,
    },
    SpurGear {
        module_mm: f64,
        tooth_count: u32,
        pressure_angle_deg: f64,
        #[serde(default)]
        profile_shift: f64,
        #[serde(default = "default_addendum_coeff")]
        addendum_coeff: f64,
        #[serde(default = "default_dedendum_coeff")]
        dedendum_coeff: f64,
        #[serde(default)]
        backlash_mm: f64,
        #[serde(default)]
        phase_deg: f64,
        #[serde(default)]
        machining: GearMachining,
    },
    HelicalGear {
        spur: SpurGear,
        helix_angle_deg: f64,
        hand: HelixHand,
    },
    HerringboneGear {
        left: HelicalGear,
        right: HelicalGear,
        center_relief_width_mm: f64,
    },
    EccentricSection {
        radius_mm: f64,
        offset_y_mm: f64,
        offset_z_mm: f64,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpurGear {
    pub module_mm: f64,
    pub tooth_count: u32,
    pub pressure_angle_deg: f64,
    #[serde(default)]
    pub profile_shift: f64,
    #[serde(default = "default_addendum_coeff")]
    pub addendum_coeff: f64,
    #[serde(default = "default_dedendum_coeff")]
    pub dedendum_coeff: f64,
    #[serde(default)]
    pub backlash_mm: f64,
    #[serde(default)]
    pub phase_deg: f64,
    #[serde(default)]
    pub machining: GearMachining,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HelicalGear {
    pub spur: SpurGear,
    pub helix_angle_deg: f64,
    pub hand: HelixHand,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HelixHand {
    Left,
    Right,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct FeatureMachining {
    pub roughing_tool_id: Option<String>,
    pub finishing_tool_id: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct GearMachining {
    pub od_tool_id: Option<String>,
    pub v_tool_id: Option<String>,
    pub root_tool_id: Option<String>,
}

fn default_addendum_coeff() -> f64 {
    1.0
}

fn default_dedendum_coeff() -> f64 {
    1.25
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanningRegion {
    pub id: String,
    pub name: String,
    pub stage: u32,
    pub purpose: PlanningPurpose,
    pub polygon: Vec<PointSr>,
    #[serde(default)]
    pub allowed_feature_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlanningPurpose {
    Roughing,
    Finishing,
    Protection,
    Support,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PointSr {
    pub s_mm: f64,
    pub r_mm: f64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct LibraryRefs {
    pub machine_profile_id: Option<String>,
    #[serde(default)]
    pub tool_ids: Vec<String>,
    pub material_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct StackInterval {
    pub item_id: String,
    pub start_s_mm: f64,
    pub end_s_mm: f64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Severity {
    Error,
    Warning,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Diagnostic {
    pub severity: Severity,
    pub object_id: Option<String>,
    pub message: String,
}

impl Diagnostic {
    pub fn error(object_id: Option<String>, message: impl Into<String>) -> Self {
        Self {
            severity: Severity::Error,
            object_id,
            message: message.into(),
        }
    }

    pub fn warning(object_id: Option<String>, message: impl Into<String>) -> Self {
        Self {
            severity: Severity::Warning,
            object_id,
            message: message.into(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct ValidationReport {
    pub diagnostics: Vec<Diagnostic>,
    pub intervals: Vec<StackInterval>,
}

impl ValidationReport {
    pub fn has_errors(&self) -> bool {
        self.diagnostics
            .iter()
            .any(|diagnostic| diagnostic.severity == Severity::Error)
    }
}

pub fn compute_stack_intervals(stack: &[StackItem], datum_s_offset_mm: f64) -> Vec<StackInterval> {
    let mut cursor = datum_s_offset_mm;
    stack
        .iter()
        .map(|item| {
            let start = cursor;
            cursor += item.length_mm;
            StackInterval {
                item_id: item.id.clone(),
                start_s_mm: start,
                end_s_mm: cursor,
            }
        })
        .collect()
}

pub fn validate_project(project: &Project) -> ValidationReport {
    let mut diagnostics = Vec::new();

    if project.schema_version != CURRENT_SCHEMA_VERSION {
        diagnostics.push(Diagnostic::error(
            None,
            format!(
                "unsupported schema version {}; expected {}",
                project.schema_version, CURRENT_SCHEMA_VERSION
            ),
        ));
    }

    if project.unit_system != UnitSystem::Metric {
        diagnostics.push(Diagnostic::error(
            None,
            "only metric projects are supported",
        ));
    }

    validate_positive(
        &mut diagnostics,
        Some(project.stock.id.clone()),
        project.stock.diameter_mm,
        "stock diameter must be positive",
    );
    validate_positive(
        &mut diagnostics,
        Some(project.stock.id.clone()),
        project.stock.length_mm,
        "stock length must be positive",
    );

    let mut ids = HashSet::new();
    collect_unique_id(&mut diagnostics, &mut ids, &project.project.id);
    collect_unique_id(&mut diagnostics, &mut ids, &project.setup.id);
    collect_unique_id(&mut diagnostics, &mut ids, &project.stock.id);

    let intervals = compute_stack_intervals(&project.stack, project.project.datum.s_offset_mm);
    let interval_by_item: HashMap<_, _> = intervals
        .iter()
        .map(|interval| (interval.item_id.as_str(), interval))
        .collect();

    for item in &project.stack {
        collect_unique_id(&mut diagnostics, &mut ids, &item.id);
        validate_positive(
            &mut diagnostics,
            Some(item.id.clone()),
            item.length_mm,
            "stack item length must be positive",
        );
        validate_stack_item(&mut diagnostics, item, project.stock.diameter_mm);
    }

    if let Some(last) = intervals.last() {
        let stack_length = last.end_s_mm - project.project.datum.s_offset_mm;
        if stack_length > project.stock.length_mm {
            diagnostics.push(Diagnostic::error(
                Some(project.stock.id.clone()),
                format!(
                    "stack length {:.3} mm exceeds stock length {:.3} mm",
                    stack_length, project.stock.length_mm
                ),
            ));
        }
    }

    for protected in &project.setup.protected_intervals {
        collect_unique_id(&mut diagnostics, &mut ids, &protected.id);
        validate_interval(
            &mut diagnostics,
            Some(protected.id.clone()),
            protected.start_s_mm,
            protected.end_s_mm,
            "protected interval",
        );
    }

    for region in &project.planning_regions {
        collect_unique_id(&mut diagnostics, &mut ids, &region.id);
        if region.polygon.len() < 3 {
            diagnostics.push(Diagnostic::error(
                Some(region.id.clone()),
                "planning region polygon must contain at least three points",
            ));
        }
        for feature_id in &region.allowed_feature_ids {
            if !interval_by_item.contains_key(feature_id.as_str()) {
                diagnostics.push(Diagnostic::error(
                    Some(region.id.clone()),
                    format!("planning region references unknown feature '{feature_id}'"),
                ));
            }
        }
    }

    ValidationReport {
        diagnostics,
        intervals,
    }
}

fn validate_stack_item(
    diagnostics: &mut Vec<Diagnostic>,
    item: &StackItem,
    stock_diameter_mm: f64,
) {
    match &item.kind {
        StackItemKind::CylindricalSection { radius_mm, .. } => {
            validate_positive(
                diagnostics,
                Some(item.id.clone()),
                *radius_mm,
                "cylindrical section radius must be positive",
            );
            validate_fits_stock(diagnostics, &item.id, *radius_mm, stock_diameter_mm);
        }
        StackItemKind::SpurGear {
            module_mm,
            tooth_count,
            pressure_angle_deg,
            profile_shift,
            addendum_coeff,
            dedendum_coeff,
            backlash_mm,
            phase_deg,
            machining,
        } => {
            let gear = SpurGear {
                module_mm: *module_mm,
                tooth_count: *tooth_count,
                pressure_angle_deg: *pressure_angle_deg,
                profile_shift: *profile_shift,
                addendum_coeff: *addendum_coeff,
                dedendum_coeff: *dedendum_coeff,
                backlash_mm: *backlash_mm,
                phase_deg: *phase_deg,
                machining: machining.clone(),
            };
            validate_spur_gear(diagnostics, &item.id, &gear, stock_diameter_mm)
        }
        StackItemKind::HelicalGear { spur, .. } => {
            validate_spur_gear(diagnostics, &item.id, spur, stock_diameter_mm);
            diagnostics.push(Diagnostic::warning(
                Some(item.id.clone()),
                "helical gear schema is present but toolpath generation is not implemented",
            ));
        }
        StackItemKind::HerringboneGear { .. } => diagnostics.push(Diagnostic::warning(
            Some(item.id.clone()),
            "herringbone gear schema is present but toolpath generation is not implemented",
        )),
        StackItemKind::EccentricSection { radius_mm, .. } => {
            validate_positive(
                diagnostics,
                Some(item.id.clone()),
                *radius_mm,
                "eccentric section radius must be positive",
            );
            diagnostics.push(Diagnostic::warning(
                Some(item.id.clone()),
                "eccentric section schema is present but toolpath generation is not implemented",
            ));
        }
    }
}

fn validate_spur_gear(
    diagnostics: &mut Vec<Diagnostic>,
    item_id: &str,
    gear: &SpurGear,
    stock_diameter_mm: f64,
) {
    validate_positive(
        diagnostics,
        Some(item_id.to_string()),
        gear.module_mm,
        "gear module must be positive",
    );
    if gear.tooth_count < 3 {
        diagnostics.push(Diagnostic::error(
            Some(item_id.to_string()),
            "gear tooth count must be at least 3",
        ));
    }
    if !(0.0..45.0).contains(&gear.pressure_angle_deg) {
        diagnostics.push(Diagnostic::error(
            Some(item_id.to_string()),
            "pressure angle must be greater than 0 and less than 45 degrees",
        ));
    }
    validate_positive(
        diagnostics,
        Some(item_id.to_string()),
        gear.addendum_coeff,
        "addendum coefficient must be positive",
    );
    validate_positive(
        diagnostics,
        Some(item_id.to_string()),
        gear.dedendum_coeff,
        "dedendum coefficient must be positive",
    );

    let outer_radius = gear.module_mm * (gear.tooth_count as f64 + 2.0 * gear.addendum_coeff) / 2.0;
    validate_fits_stock(diagnostics, item_id, outer_radius, stock_diameter_mm);

    if gear.tooth_count < 17 && gear.profile_shift <= 0.0 && gear.pressure_angle_deg <= 20.0 {
        diagnostics.push(Diagnostic::warning(
            Some(item_id.to_string()),
            "low tooth count may produce undercut; generated geometry will report the manufactured result",
        ));
    }
}

fn validate_positive(
    diagnostics: &mut Vec<Diagnostic>,
    object_id: Option<String>,
    value: f64,
    message: &str,
) {
    if !value.is_finite() || value <= 0.0 {
        diagnostics.push(Diagnostic::error(object_id, message));
    }
}

fn validate_fits_stock(
    diagnostics: &mut Vec<Diagnostic>,
    item_id: &str,
    radius_mm: f64,
    stock_diameter_mm: f64,
) {
    if 2.0 * radius_mm > stock_diameter_mm {
        diagnostics.push(Diagnostic::error(
            Some(item_id.to_string()),
            format!(
                "feature diameter {:.3} mm exceeds stock diameter {:.3} mm",
                2.0 * radius_mm,
                stock_diameter_mm
            ),
        ));
    }
}

fn validate_interval(
    diagnostics: &mut Vec<Diagnostic>,
    object_id: Option<String>,
    start: f64,
    end: f64,
    label: &str,
) {
    if !start.is_finite() || !end.is_finite() || end <= start {
        diagnostics.push(Diagnostic::error(
            object_id,
            format!("{label} must have finite end greater than start"),
        ));
    }
}

fn collect_unique_id(diagnostics: &mut Vec<Diagnostic>, ids: &mut HashSet<String>, id: &str) {
    if id.trim().is_empty() {
        diagnostics.push(Diagnostic::error(None, "entity id must not be empty"));
    } else if !ids.insert(id.to_string()) {
        diagnostics.push(Diagnostic::error(
            Some(id.to_string()),
            format!("duplicate entity id '{id}'"),
        ));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn computes_ordered_stack_intervals() {
        let stack = vec![
            StackItem {
                id: "a".to_string(),
                name: "A".to_string(),
                length_mm: 10.0,
                kind: StackItemKind::CylindricalSection {
                    radius_mm: 4.0,
                    machining: FeatureMachining::default(),
                },
            },
            StackItem {
                id: "b".to_string(),
                name: "B".to_string(),
                length_mm: 5.0,
                kind: StackItemKind::CylindricalSection {
                    radius_mm: 3.0,
                    machining: FeatureMachining::default(),
                },
            },
        ];

        assert_eq!(
            compute_stack_intervals(&stack, 2.0),
            vec![
                StackInterval {
                    item_id: "a".to_string(),
                    start_s_mm: 2.0,
                    end_s_mm: 12.0,
                },
                StackInterval {
                    item_id: "b".to_string(),
                    start_s_mm: 12.0,
                    end_s_mm: 17.0,
                }
            ]
        );
    }
}
