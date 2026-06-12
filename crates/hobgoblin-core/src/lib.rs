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

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct LibrarySet {
    #[serde(default)]
    pub machine_profiles: Vec<MachineProfile>,
    #[serde(default)]
    pub tools: Vec<Tool>,
    #[serde(default)]
    pub materials: Vec<Material>,
}

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
pub struct ToolLibrary {
    pub tools: Vec<Tool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Tool {
    VCutter(VCutter),
    CylindricalCutter(CylindricalCutter),
}

impl Tool {
    pub fn id(&self) -> &str {
        match self {
            Tool::VCutter(tool) => &tool.id,
            Tool::CylindricalCutter(tool) => &tool.id,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VCutter {
    pub id: String,
    pub name: String,
    pub included_angle_deg: f64,
    pub tip_flat_width_mm: f64,
    pub max_cut_diameter_mm: f64,
    pub flute_length_mm: f64,
    pub shank_diameter_mm: f64,
    pub stickout_mm: f64,
    pub holder_diameter_mm: f64,
    pub holder_length_mm: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CylindricalCutter {
    pub id: String,
    pub name: String,
    pub diameter_mm: f64,
    pub corner_radius_mm: f64,
    pub flute_length_mm: f64,
    pub cutting_length_mm: f64,
    pub shank_diameter_mm: f64,
    pub stickout_mm: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Material {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub recipes: Vec<CuttingRecipe>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CuttingRecipe {
    pub tool_class: ToolClass,
    pub operation: RecipeOperation,
    pub engagement: EngagementMode,
    pub feed_mm_min: f64,
    pub spindle_rpm: u32,
    pub radial_depth_per_pass_mm: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ToolClass {
    VCutter,
    CylindricalCutter,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RecipeOperation {
    Roughing,
    Finishing,
    RootGeneration,
    FlankGeneration,
    SpringPass,
    SurfaceFinishing,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EngagementMode {
    FullWidthGenerate,
    SideFlankGenerate,
    CylindricalSurface,
    RootGenerate,
    SpringFinish,
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

impl LibrarySet {
    pub fn from_parts(
        machine_profiles: Vec<MachineProfile>,
        tool_libraries: Vec<ToolLibrary>,
        materials: Vec<Material>,
    ) -> Self {
        Self {
            machine_profiles,
            tools: tool_libraries
                .into_iter()
                .flat_map(|library| library.tools)
                .collect(),
            materials,
        }
    }

    fn machine_profile_ids(&self) -> HashSet<&str> {
        self.machine_profiles
            .iter()
            .map(|profile| profile.id.as_str())
            .collect()
    }

    fn tool_ids(&self) -> HashSet<&str> {
        self.tools.iter().map(Tool::id).collect()
    }

    fn material_ids(&self) -> HashSet<&str> {
        self.materials
            .iter()
            .map(|material| material.id.as_str())
            .collect()
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

    if project.project.name.trim().is_empty() {
        diagnostics.push(Diagnostic::error(
            Some(project.project.id.clone()),
            "project name must not be empty",
        ));
    }

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

    if project.setup.name.trim().is_empty() {
        diagnostics.push(Diagnostic::error(
            Some(project.setup.id.clone()),
            "setup name must not be empty",
        ));
    }
    if project.setup.machine_profile_id.trim().is_empty() {
        diagnostics.push(Diagnostic::error(
            Some(project.setup.id.clone()),
            "setup machine profile id must not be empty",
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
    if project.stock.material_id.trim().is_empty() {
        diagnostics.push(Diagnostic::error(
            Some(project.stock.id.clone()),
            "stock material id must not be empty",
        ));
    }

    validate_tailstock(
        &mut diagnostics,
        &project.setup,
        project.project.datum.s_offset_mm,
        project.stock.length_mm,
    );

    let mut ids = HashSet::new();
    collect_unique_id(&mut diagnostics, &mut ids, &project.project.id);
    collect_unique_id(&mut diagnostics, &mut ids, &project.setup.id);
    collect_unique_id(&mut diagnostics, &mut ids, &project.stock.id);

    let intervals = compute_stack_intervals(&project.stack, project.project.datum.s_offset_mm);
    if project.stack.is_empty() {
        diagnostics.push(Diagnostic::error(
            Some(project.project.id.clone()),
            "project stack must contain at least one item",
        ));
    }
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
        if !matches!(protected.purpose, ProtectedPurpose::ChuckGrip) {
            validate_interval_within_stock(
                &mut diagnostics,
                Some(protected.id.clone()),
                protected.start_s_mm,
                protected.end_s_mm,
                project.project.datum.s_offset_mm,
                project.stock.length_mm,
                "protected interval",
            );
        }
    }

    for region in &project.planning_regions {
        collect_unique_id(&mut diagnostics, &mut ids, &region.id);
        if region.polygon.len() < 3 {
            diagnostics.push(Diagnostic::error(
                Some(region.id.clone()),
                "planning region polygon must contain at least three points",
            ));
        }
        for point in &region.polygon {
            if !point.s_mm.is_finite() || !point.r_mm.is_finite() {
                diagnostics.push(Diagnostic::error(
                    Some(region.id.clone()),
                    "planning region polygon points must be finite",
                ));
            }
            if point.r_mm < 0.0 {
                diagnostics.push(Diagnostic::error(
                    Some(region.id.clone()),
                    "planning region radius coordinates must be non-negative",
                ));
            }
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

pub fn validate_project_with_libraries(
    project: &Project,
    libraries: &LibrarySet,
) -> ValidationReport {
    let mut report = validate_project(project);
    validate_libraries(&mut report.diagnostics, libraries);
    validate_project_library_refs(&mut report.diagnostics, project, libraries);
    report
}

fn validate_libraries(diagnostics: &mut Vec<Diagnostic>, libraries: &LibrarySet) {
    let mut ids = HashSet::new();
    for profile in &libraries.machine_profiles {
        collect_unique_id(diagnostics, &mut ids, &profile.id);
        if profile.name.trim().is_empty() {
            diagnostics.push(Diagnostic::error(
                Some(profile.id.clone()),
                "machine profile name must not be empty",
            ));
        }
        validate_positive(
            diagnostics,
            Some(profile.id.clone()),
            profile.limits.max_stock_diameter_mm,
            "machine max stock diameter must be positive",
        );
        validate_positive(
            diagnostics,
            Some(profile.id.clone()),
            profile.limits.max_stock_length_mm,
            "machine max stock length must be positive",
        );
        validate_positive(
            diagnostics,
            Some(profile.id.clone()),
            profile.limits.travel_x_mm,
            "machine X travel must be positive",
        );
        validate_positive(
            diagnostics,
            Some(profile.id.clone()),
            profile.limits.travel_y_mm,
            "machine Y travel must be positive",
        );
        validate_positive(
            diagnostics,
            Some(profile.id.clone()),
            profile.limits.travel_z_mm,
            "machine Z travel must be positive",
        );
        validate_positive(
            diagnostics,
            Some(profile.id.clone()),
            profile.limits.max_spindle_rpm as f64,
            "machine max spindle rpm must be positive",
        );
        for (label, axis) in [
            ("shaft axis", &profile.axis_mapping.shaft_axis),
            ("virtual rack axis", &profile.axis_mapping.virtual_rack_axis),
            ("radial axis", &profile.axis_mapping.radial_axis),
            ("rotary axis", &profile.axis_mapping.rotary_axis),
        ] {
            if axis.trim().is_empty() {
                diagnostics.push(Diagnostic::error(
                    Some(profile.id.clone()),
                    format!("machine {label} mapping must not be empty"),
                ));
            }
        }
        if !profile.axis_mapping.rotary_sign.is_finite() || profile.axis_mapping.rotary_sign == 0.0
        {
            diagnostics.push(Diagnostic::error(
                Some(profile.id.clone()),
                "machine rotary sign must be finite and non-zero",
            ));
        }
    }

    for tool in &libraries.tools {
        collect_unique_id(diagnostics, &mut ids, tool.id());
        validate_tool(diagnostics, tool);
    }

    for material in &libraries.materials {
        collect_unique_id(diagnostics, &mut ids, &material.id);
        if material.name.trim().is_empty() {
            diagnostics.push(Diagnostic::error(
                Some(material.id.clone()),
                "material name must not be empty",
            ));
        }
        for recipe in &material.recipes {
            validate_positive(
                diagnostics,
                Some(material.id.clone()),
                recipe.feed_mm_min,
                "recipe feed must be positive",
            );
            validate_positive(
                diagnostics,
                Some(material.id.clone()),
                recipe.spindle_rpm as f64,
                "recipe spindle rpm must be positive",
            );
            validate_positive(
                diagnostics,
                Some(material.id.clone()),
                recipe.radial_depth_per_pass_mm,
                "recipe radial depth per pass must be positive",
            );
        }
    }
}

fn validate_project_library_refs(
    diagnostics: &mut Vec<Diagnostic>,
    project: &Project,
    libraries: &LibrarySet,
) {
    let machine_ids = libraries.machine_profile_ids();
    let tool_ids = libraries.tool_ids();
    let material_ids = libraries.material_ids();

    validate_ref_exists(
        diagnostics,
        Some(project.setup.id.clone()),
        &project.setup.machine_profile_id,
        &machine_ids,
        "machine profile",
    );
    validate_ref_exists(
        diagnostics,
        Some(project.stock.id.clone()),
        &project.stock.material_id,
        &material_ids,
        "material",
    );

    if let Some(machine_profile_id) = &project.library_refs.machine_profile_id {
        validate_ref_exists(
            diagnostics,
            Some(project.project.id.clone()),
            machine_profile_id,
            &machine_ids,
            "machine profile",
        );
        if machine_profile_id != &project.setup.machine_profile_id {
            diagnostics.push(Diagnostic::warning(
                Some(project.project.id.clone()),
                "library machine profile reference differs from setup machine profile",
            ));
        }
    }

    if let Some(material_id) = &project.library_refs.material_id {
        validate_ref_exists(
            diagnostics,
            Some(project.project.id.clone()),
            material_id,
            &material_ids,
            "material",
        );
        if material_id != &project.stock.material_id {
            diagnostics.push(Diagnostic::warning(
                Some(project.project.id.clone()),
                "library material reference differs from stock material",
            ));
        }
    }

    for tool_id in &project.library_refs.tool_ids {
        validate_ref_exists(
            diagnostics,
            Some(project.project.id.clone()),
            tool_id,
            &tool_ids,
            "tool",
        );
    }

    for item in &project.stack {
        match &item.kind {
            StackItemKind::CylindricalSection { machining, .. } => {
                validate_optional_tool_ref(
                    diagnostics,
                    &item.id,
                    machining.roughing_tool_id.as_deref(),
                    &tool_ids,
                    "roughing tool",
                );
                validate_optional_tool_ref(
                    diagnostics,
                    &item.id,
                    machining.finishing_tool_id.as_deref(),
                    &tool_ids,
                    "finishing tool",
                );
            }
            StackItemKind::SpurGear { machining, .. } => {
                validate_gear_tool_refs(diagnostics, &item.id, machining, &tool_ids);
            }
            StackItemKind::HelicalGear { spur, .. } => {
                validate_gear_tool_refs(diagnostics, &item.id, &spur.machining, &tool_ids);
            }
            StackItemKind::HerringboneGear { left, right, .. } => {
                validate_gear_tool_refs(diagnostics, &item.id, &left.spur.machining, &tool_ids);
                validate_gear_tool_refs(diagnostics, &item.id, &right.spur.machining, &tool_ids);
            }
            StackItemKind::EccentricSection { .. } => {}
        }
    }
}

fn validate_tool(diagnostics: &mut Vec<Diagnostic>, tool: &Tool) {
    match tool {
        Tool::VCutter(tool) => {
            if tool.name.trim().is_empty() {
                diagnostics.push(Diagnostic::error(
                    Some(tool.id.clone()),
                    "tool name must not be empty",
                ));
            }
            validate_positive(
                diagnostics,
                Some(tool.id.clone()),
                tool.included_angle_deg,
                "V cutter included angle must be positive",
            );
            validate_positive(
                diagnostics,
                Some(tool.id.clone()),
                tool.max_cut_diameter_mm,
                "V cutter max cut diameter must be positive",
            );
            validate_positive(
                diagnostics,
                Some(tool.id.clone()),
                tool.flute_length_mm,
                "V cutter flute length must be positive",
            );
            validate_non_negative(
                diagnostics,
                Some(tool.id.clone()),
                tool.tip_flat_width_mm,
                "V cutter tip flat width must be non-negative",
            );
            validate_positive(
                diagnostics,
                Some(tool.id.clone()),
                tool.shank_diameter_mm,
                "V cutter shank diameter must be positive",
            );
            validate_positive(
                diagnostics,
                Some(tool.id.clone()),
                tool.stickout_mm,
                "V cutter stickout must be positive",
            );
            validate_positive(
                diagnostics,
                Some(tool.id.clone()),
                tool.holder_diameter_mm,
                "V cutter holder diameter must be positive",
            );
            validate_positive(
                diagnostics,
                Some(tool.id.clone()),
                tool.holder_length_mm,
                "V cutter holder length must be positive",
            );
        }
        Tool::CylindricalCutter(tool) => {
            if tool.name.trim().is_empty() {
                diagnostics.push(Diagnostic::error(
                    Some(tool.id.clone()),
                    "tool name must not be empty",
                ));
            }
            validate_positive(
                diagnostics,
                Some(tool.id.clone()),
                tool.diameter_mm,
                "cylindrical cutter diameter must be positive",
            );
            validate_positive(
                diagnostics,
                Some(tool.id.clone()),
                tool.flute_length_mm,
                "cylindrical cutter flute length must be positive",
            );
            validate_positive(
                diagnostics,
                Some(tool.id.clone()),
                tool.cutting_length_mm,
                "cylindrical cutter cutting length must be positive",
            );
            validate_non_negative(
                diagnostics,
                Some(tool.id.clone()),
                tool.corner_radius_mm,
                "cylindrical cutter corner radius must be non-negative",
            );
            validate_positive(
                diagnostics,
                Some(tool.id.clone()),
                tool.shank_diameter_mm,
                "cylindrical cutter shank diameter must be positive",
            );
            validate_positive(
                diagnostics,
                Some(tool.id.clone()),
                tool.stickout_mm,
                "cylindrical cutter stickout must be positive",
            );
        }
    }
}

fn validate_gear_tool_refs(
    diagnostics: &mut Vec<Diagnostic>,
    item_id: &str,
    machining: &GearMachining,
    tool_ids: &HashSet<&str>,
) {
    validate_required_tool_ref(
        diagnostics,
        item_id,
        machining.od_tool_id.as_deref(),
        tool_ids,
        "gear OD tool",
    );
    validate_required_tool_ref(
        diagnostics,
        item_id,
        machining.v_tool_id.as_deref(),
        tool_ids,
        "gear V cutter",
    );
    validate_required_tool_ref(
        diagnostics,
        item_id,
        machining.root_tool_id.as_deref(),
        tool_ids,
        "gear root tool",
    );
}

fn validate_optional_tool_ref(
    diagnostics: &mut Vec<Diagnostic>,
    item_id: &str,
    tool_id: Option<&str>,
    tool_ids: &HashSet<&str>,
    label: &str,
) {
    if let Some(tool_id) = tool_id {
        validate_ref_exists(
            diagnostics,
            Some(item_id.to_string()),
            tool_id,
            tool_ids,
            label,
        );
    }
}

fn validate_required_tool_ref(
    diagnostics: &mut Vec<Diagnostic>,
    item_id: &str,
    tool_id: Option<&str>,
    tool_ids: &HashSet<&str>,
    label: &str,
) {
    match tool_id {
        Some(tool_id) => validate_ref_exists(
            diagnostics,
            Some(item_id.to_string()),
            tool_id,
            tool_ids,
            label,
        ),
        None => diagnostics.push(Diagnostic::error(
            Some(item_id.to_string()),
            format!("{label} reference must not be empty"),
        )),
    }
}

fn validate_ref_exists(
    diagnostics: &mut Vec<Diagnostic>,
    object_id: Option<String>,
    referenced_id: &str,
    known_ids: &HashSet<&str>,
    kind: &str,
) {
    if referenced_id.trim().is_empty() {
        diagnostics.push(Diagnostic::error(
            object_id,
            format!("{kind} reference must not be empty"),
        ));
    } else if !known_ids.contains(referenced_id) {
        diagnostics.push(Diagnostic::error(
            object_id,
            format!("unknown {kind} reference '{referenced_id}'"),
        ));
    }
}

fn validate_tailstock(
    diagnostics: &mut Vec<Diagnostic>,
    setup: &Setup,
    datum_s_offset_mm: f64,
    stock_length_mm: f64,
) {
    let tailstock = &setup.workholding.tailstock;
    match (
        tailstock.enabled,
        tailstock.protected_start_s_mm,
        tailstock.protected_end_s_mm,
    ) {
        (true, Some(start), Some(end)) => {
            validate_interval(
                diagnostics,
                Some(setup.id.clone()),
                start,
                end,
                "tailstock protected interval",
            );
            validate_interval_within_stock(
                diagnostics,
                Some(setup.id.clone()),
                start,
                end,
                datum_s_offset_mm,
                stock_length_mm,
                "tailstock protected interval",
            );
        }
        (true, _, _) => diagnostics.push(Diagnostic::error(
            Some(setup.id.clone()),
            "enabled tailstock must define protected start and end",
        )),
        (false, Some(_), _) | (false, _, Some(_)) => diagnostics.push(Diagnostic::warning(
            Some(setup.id.clone()),
            "disabled tailstock has protected coordinates that will be ignored",
        )),
        (false, None, None) => {}
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
        StackItemKind::HerringboneGear { left, right, .. } => {
            validate_spur_gear(diagnostics, &item.id, &left.spur, stock_diameter_mm);
            validate_spur_gear(diagnostics, &item.id, &right.spur, stock_diameter_mm);
            diagnostics.push(Diagnostic::warning(
                Some(item.id.clone()),
                "herringbone gear schema is present but toolpath generation is not implemented",
            ));
        }
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

fn validate_non_negative(
    diagnostics: &mut Vec<Diagnostic>,
    object_id: Option<String>,
    value: f64,
    message: &str,
) {
    if !value.is_finite() || value < 0.0 {
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

fn validate_interval_within_stock(
    diagnostics: &mut Vec<Diagnostic>,
    object_id: Option<String>,
    start: f64,
    end: f64,
    datum_s_offset_mm: f64,
    stock_length_mm: f64,
    label: &str,
) {
    if start.is_finite()
        && end.is_finite()
        && (start < datum_s_offset_mm || end > datum_s_offset_mm + stock_length_mm)
    {
        diagnostics.push(Diagnostic::warning(
            object_id,
            format!("{label} extends outside stock bounds"),
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

    fn diagnostic_messages(report: &ValidationReport) -> Vec<&str> {
        report
            .diagnostics
            .iter()
            .map(|diagnostic| diagnostic.message.as_str())
            .collect()
    }

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

    #[test]
    fn validates_sample_project_without_diagnostics() {
        let project: Project = serde_json::from_str(include_str!(
            "../../../examples/projects/simple_spur_stack.hobgoblin.json"
        ))
        .expect("sample project parses");

        let report = validate_project(&project);

        assert_eq!(report.diagnostics, Vec::new());
        assert_eq!(report.intervals.len(), 3);
        assert!(!report.has_errors());
    }

    #[test]
    fn reports_invalid_sample_project_diagnostics() {
        let project: Project = serde_json::from_str(include_str!(
            "../../../examples/projects/invalid/invalid_validation_cases.hobgoblin.json"
        ))
        .expect("invalid sample still parses");

        let report = validate_project(&project);
        let messages = diagnostic_messages(&report);

        assert!(report.has_errors());
        assert!(messages.contains(&"setup machine profile id must not be empty"));
        assert!(messages.contains(&"enabled tailstock must define protected start and end"));
        assert!(messages.contains(&"stock material id must not be empty"));
        assert!(messages
            .iter()
            .any(|message| message.contains("duplicate entity id")));
        assert!(messages.contains(&"gear module must be positive"));
        assert!(messages.contains(&"gear tooth count must be at least 3"));
        assert!(
            messages.contains(&"pressure angle must be greater than 0 and less than 45 degrees")
        );
        assert!(messages.contains(&"planning region polygon must contain at least three points"));
        assert!(messages
            .iter()
            .any(|message| message.contains("references unknown feature")));
        assert!(messages
            .iter()
            .any(|message| message.contains("exceeds stock length")));
        assert!(messages
            .iter()
            .any(|message| message.contains("exceeds stock diameter")));
    }

    #[test]
    fn warns_for_unsupported_feature_schemas() {
        let project: Project = serde_json::from_str(
            r#"{
                "schema_version": 0,
                "unit_system": "metric",
                "project": {
                    "id": "project.unsupported",
                    "name": "Unsupported feature project",
                    "datum": { "kind": "user_defined", "s_offset_mm": 0.0 }
                },
                "setup": {
                    "id": "setup.unsupported",
                    "name": "Setup",
                    "machine_profile_id": "machine.carvera_air.default",
                    "workholding": {
                        "held_side": "left",
                        "tailstock": { "enabled": false, "protected_start_s_mm": null, "protected_end_s_mm": null }
                    },
                    "protected_intervals": []
                },
                "stock": {
                    "id": "stock.unsupported",
                    "diameter_mm": 20.0,
                    "length_mm": 30.0,
                    "material_id": "material.brass.generic"
                },
                "stack": [
                    {
                        "id": "feature.helical",
                        "name": "Helical placeholder",
                        "length_mm": 10.0,
                        "type": "helical_gear",
                        "helix_angle_deg": 15.0,
                        "hand": "right",
                        "spur": {
                            "module_mm": 0.5,
                            "tooth_count": 20,
                            "pressure_angle_deg": 20.0
                        }
                    },
                    {
                        "id": "feature.eccentric",
                        "name": "Eccentric placeholder",
                        "length_mm": 10.0,
                        "type": "eccentric_section",
                        "radius_mm": 3.0,
                        "offset_y_mm": 1.0,
                        "offset_z_mm": 0.0
                    }
                ]
            }"#,
        )
        .expect("unsupported feature project parses");

        let report = validate_project(&project);
        let messages = diagnostic_messages(&report);

        assert!(!report.has_errors());
        assert!(messages
            .iter()
            .any(|message| message.contains("helical gear schema is present")));
        assert!(messages
            .iter()
            .any(|message| message.contains("eccentric section schema is present")));
    }

    #[test]
    fn validates_nested_herringbone_spur_definitions() {
        let project: Project = serde_json::from_str(
            r#"{
                "schema_version": 0,
                "unit_system": "metric",
                "project": {
                    "id": "project.bad_herringbone",
                    "name": "Bad herringbone project",
                    "datum": { "kind": "user_defined", "s_offset_mm": 0.0 }
                },
                "setup": {
                    "id": "setup.bad_herringbone",
                    "name": "Setup",
                    "machine_profile_id": "machine.carvera_air.default",
                    "workholding": {
                        "held_side": "left",
                        "tailstock": { "enabled": false, "protected_start_s_mm": null, "protected_end_s_mm": null }
                    },
                    "protected_intervals": []
                },
                "stock": {
                    "id": "stock.bad_herringbone",
                    "diameter_mm": 8.0,
                    "length_mm": 20.0,
                    "material_id": "material.brass.generic"
                },
                "stack": [
                    {
                        "id": "feature.bad_herringbone",
                        "name": "Bad herringbone placeholder",
                        "length_mm": 10.0,
                        "type": "herringbone_gear",
                        "center_relief_width_mm": 1.0,
                        "left": {
                            "helix_angle_deg": 15.0,
                            "hand": "left",
                            "spur": {
                                "module_mm": 0.0,
                                "tooth_count": 2,
                                "pressure_angle_deg": 20.0
                            }
                        },
                        "right": {
                            "helix_angle_deg": 15.0,
                            "hand": "right",
                            "spur": {
                                "module_mm": 0.5,
                                "tooth_count": 20,
                                "pressure_angle_deg": 50.0
                            }
                        }
                    }
                ]
            }"#,
        )
        .expect("bad herringbone project parses");

        let report = validate_project(&project);
        let messages = diagnostic_messages(&report);

        assert!(report.has_errors());
        assert!(messages.contains(&"gear module must be positive"));
        assert!(messages.contains(&"gear tooth count must be at least 3"));
        assert!(
            messages.contains(&"pressure angle must be greater than 0 and less than 45 degrees")
        );
        assert!(messages
            .iter()
            .any(|message| message.contains("herringbone gear schema is present")));
    }

    #[test]
    fn warns_when_tailstock_protected_coordinates_exceed_stock() {
        let project: Project = serde_json::from_str(
            r#"{
                "schema_version": 0,
                "unit_system": "metric",
                "project": {
                    "id": "project.tailstock_bounds",
                    "name": "Tailstock bounds project",
                    "datum": { "kind": "user_defined", "s_offset_mm": 0.0 }
                },
                "setup": {
                    "id": "setup.tailstock_bounds",
                    "name": "Setup",
                    "machine_profile_id": "machine.carvera_air.default",
                    "workholding": {
                        "held_side": "left",
                        "tailstock": { "enabled": true, "protected_start_s_mm": 40.0, "protected_end_s_mm": 55.0 }
                    },
                    "protected_intervals": []
                },
                "stock": {
                    "id": "stock.tailstock_bounds",
                    "diameter_mm": 10.0,
                    "length_mm": 50.0,
                    "material_id": "material.brass.generic"
                },
                "stack": [
                    {
                        "id": "feature.section",
                        "name": "Section",
                        "length_mm": 20.0,
                        "type": "cylindrical_section",
                        "radius_mm": 3.0
                    }
                ]
            }"#,
        )
        .expect("tailstock bounds project parses");

        let report = validate_project(&project);
        let messages = diagnostic_messages(&report);

        assert!(!report.has_errors());
        assert!(messages
            .iter()
            .any(|message| message
                .contains("tailstock protected interval extends outside stock bounds")));
    }

    #[test]
    fn parses_example_libraries_and_validates_project_references() {
        let project: Project = serde_json::from_str(include_str!(
            "../../../examples/projects/simple_spur_stack.hobgoblin.json"
        ))
        .expect("sample project parses");
        let machine: MachineProfile = serde_json::from_str(include_str!(
            "../../../examples/library/carvera_air.machine.json"
        ))
        .expect("machine profile parses");
        let tools: ToolLibrary = serde_json::from_str(include_str!(
            "../../../examples/library/basic_tools.tools.json"
        ))
        .expect("tool library parses");
        let material: Material = serde_json::from_str(include_str!(
            "../../../examples/library/brass.material.json"
        ))
        .expect("material parses");
        let libraries = LibrarySet::from_parts(vec![machine], vec![tools], vec![material]);

        let report = validate_project_with_libraries(&project, &libraries);

        assert_eq!(report.diagnostics, Vec::new());
    }

    #[test]
    fn reports_missing_project_library_references() {
        let project: Project = serde_json::from_str(include_str!(
            "../../../examples/projects/simple_spur_stack.hobgoblin.json"
        ))
        .expect("sample project parses");
        let libraries = LibrarySet::default();

        let report = validate_project_with_libraries(&project, &libraries);
        let messages = diagnostic_messages(&report);

        assert!(report.has_errors());
        assert!(messages
            .iter()
            .any(|message| message.contains("unknown machine profile reference")));
        assert!(messages
            .iter()
            .any(|message| message.contains("unknown material reference")));
        assert!(messages
            .iter()
            .any(|message| message.contains("unknown tool reference")));
    }

    #[test]
    fn reports_missing_feature_tool_assignments_with_libraries() {
        let project: Project = serde_json::from_str(
            r#"{
                "schema_version": 0,
                "unit_system": "metric",
                "project": {
                    "id": "project.missing_tools",
                    "name": "Missing tools",
                    "datum": { "kind": "user_defined", "s_offset_mm": 0.0 }
                },
                "setup": {
                    "id": "setup.missing_tools",
                    "name": "Setup",
                    "machine_profile_id": "machine.carvera_air.default",
                    "workholding": {
                        "held_side": "left",
                        "tailstock": { "enabled": false, "protected_start_s_mm": null, "protected_end_s_mm": null }
                    },
                    "protected_intervals": []
                },
                "stock": {
                    "id": "stock.missing_tools",
                    "diameter_mm": 20.0,
                    "length_mm": 20.0,
                    "material_id": "material.brass.generic"
                },
                "stack": [
                    {
                        "id": "feature.gear",
                        "name": "Gear",
                        "length_mm": 10.0,
                        "type": "spur_gear",
                        "module_mm": 0.5,
                        "tooth_count": 20,
                        "pressure_angle_deg": 20.0
                    }
                ]
            }"#,
        )
        .expect("missing tool project parses");
        let machine: MachineProfile = serde_json::from_str(include_str!(
            "../../../examples/library/carvera_air.machine.json"
        ))
        .expect("machine profile parses");
        let tools: ToolLibrary = serde_json::from_str(include_str!(
            "../../../examples/library/basic_tools.tools.json"
        ))
        .expect("tool library parses");
        let material: Material = serde_json::from_str(include_str!(
            "../../../examples/library/brass.material.json"
        ))
        .expect("material parses");
        let libraries = LibrarySet::from_parts(vec![machine], vec![tools], vec![material]);

        let report = validate_project_with_libraries(&project, &libraries);
        let messages = diagnostic_messages(&report);

        assert!(report.has_errors());
        assert!(messages.contains(&"gear OD tool reference must not be empty"));
        assert!(messages.contains(&"gear V cutter reference must not be empty"));
        assert!(messages.contains(&"gear root tool reference must not be empty"));
    }

    #[test]
    fn reports_invalid_library_physical_fields() {
        let libraries = LibrarySet {
            machine_profiles: vec![MachineProfile {
                id: "machine.bad".to_string(),
                name: "".to_string(),
                axis_mapping: AxisMapping {
                    shaft_axis: "".to_string(),
                    virtual_rack_axis: "Y".to_string(),
                    radial_axis: "Z".to_string(),
                    rotary_axis: "A".to_string(),
                    rotary_sign: 0.0,
                },
                limits: MachineLimits {
                    max_stock_diameter_mm: 0.0,
                    max_stock_length_mm: 0.0,
                    travel_x_mm: 0.0,
                    travel_y_mm: 0.0,
                    travel_z_mm: 0.0,
                    max_spindle_rpm: 0,
                },
                postprocessor: PostprocessorDialect::CarveraAir,
            }],
            tools: vec![
                Tool::VCutter(VCutter {
                    id: "tool.bad_v".to_string(),
                    name: "".to_string(),
                    included_angle_deg: 0.0,
                    tip_flat_width_mm: -0.1,
                    max_cut_diameter_mm: 0.0,
                    flute_length_mm: 0.0,
                    shank_diameter_mm: 0.0,
                    stickout_mm: 0.0,
                    holder_diameter_mm: 0.0,
                    holder_length_mm: 0.0,
                }),
                Tool::CylindricalCutter(CylindricalCutter {
                    id: "tool.bad_cyl".to_string(),
                    name: "".to_string(),
                    diameter_mm: 0.0,
                    corner_radius_mm: -0.1,
                    flute_length_mm: 0.0,
                    cutting_length_mm: 0.0,
                    shank_diameter_mm: 0.0,
                    stickout_mm: 0.0,
                }),
            ],
            materials: vec![Material {
                id: "material.bad".to_string(),
                name: "".to_string(),
                recipes: vec![CuttingRecipe {
                    tool_class: ToolClass::VCutter,
                    operation: RecipeOperation::Roughing,
                    engagement: EngagementMode::FullWidthGenerate,
                    feed_mm_min: 0.0,
                    spindle_rpm: 0,
                    radial_depth_per_pass_mm: 0.0,
                }],
            }],
        };
        let project: Project = serde_json::from_str(include_str!(
            "../../../examples/projects/simple_spur_stack.hobgoblin.json"
        ))
        .expect("sample project parses");

        let report = validate_project_with_libraries(&project, &libraries);
        let messages = diagnostic_messages(&report);

        assert!(report.has_errors());
        assert!(messages.contains(&"machine profile name must not be empty"));
        assert!(messages.contains(&"machine X travel must be positive"));
        assert!(messages.contains(&"machine shaft axis mapping must not be empty"));
        assert!(messages.contains(&"machine rotary sign must be finite and non-zero"));
        assert!(messages.contains(&"V cutter tip flat width must be non-negative"));
        assert!(messages.contains(&"V cutter shank diameter must be positive"));
        assert!(messages.contains(&"cylindrical cutter corner radius must be non-negative"));
        assert!(messages.contains(&"cylindrical cutter stickout must be positive"));
        assert!(messages.contains(&"recipe feed must be positive"));
    }
}
