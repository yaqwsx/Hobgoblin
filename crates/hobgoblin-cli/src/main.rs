use anyhow::{Context, Result};
use clap::{Parser, Subcommand, ValueEnum};
use hobgoblin_core::{
    validate_project, validate_project_with_libraries, LibrarySet, MachineProfile, Material,
    Project, Severity, SpurGear, StackItemKind, Tool, ToolLibrary,
};
use hobgoblin_gear::{derive_spur_dimensions, AdaptiveRackSteppingConfig, RackSteppingQuality};
use hobgoblin_planner::{
    build_initial_operation_graph, generate_spur_shaping_path, SpurShapingConfig, SpurShapingPath,
};
use hobgoblin_sim::simulate_abstract_path_with_tool;
use serde::Serialize;
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Parser)]
#[command(name = "hobgoblin")]
#[command(about = "Single-purpose CAM for geared shafts")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    Validate {
        project: PathBuf,
        #[command(flatten)]
        libraries: LibraryArgs,
    },
    Plan {
        project: PathBuf,
        #[command(flatten)]
        libraries: LibraryArgs,
    },
    DebugSpurPath {
        project: PathBuf,
        feature_id: String,
        #[arg(long, default_value_t = 5, help = "Fixed-mode rack samples per tooth")]
        rack_steps_per_tooth: u32,
        #[arg(long, value_enum, default_value_t = RackSteppingMode::Adaptive)]
        stepping: RackSteppingMode,
        #[arg(long, value_enum, default_value_t = CliRackSteppingQuality::Standard)]
        quality: CliRackSteppingQuality,
        #[arg(long)]
        tolerance_mm: Option<f64>,
        #[arg(long)]
        min_step_mm: Option<f64>,
        #[arg(long)]
        max_step_mm: Option<f64>,
        #[arg(long, value_delimiter = ',', default_value = "0.25,0.5,0.75,1.0")]
        depth_layers: Vec<f64>,
        #[command(flatten)]
        libraries: LibraryArgs,
    },
    SimulateSpurPath {
        project: PathBuf,
        feature_id: String,
        #[arg(long, default_value_t = 5, help = "Fixed-mode rack samples per tooth")]
        rack_steps_per_tooth: u32,
        #[arg(long, value_enum, default_value_t = RackSteppingMode::Adaptive)]
        stepping: RackSteppingMode,
        #[arg(long, value_enum, default_value_t = CliRackSteppingQuality::Standard)]
        quality: CliRackSteppingQuality,
        #[arg(long)]
        tolerance_mm: Option<f64>,
        #[arg(long)]
        min_step_mm: Option<f64>,
        #[arg(long)]
        max_step_mm: Option<f64>,
        #[arg(long, value_delimiter = ',', default_value = "0.25,0.5,0.75,1.0")]
        depth_layers: Vec<f64>,
        #[command(flatten)]
        libraries: LibraryArgs,
    },
}

#[derive(Debug, Clone, Default, Parser)]
struct LibraryArgs {
    #[arg(long = "machine")]
    machine_profiles: Vec<PathBuf>,
    #[arg(long = "tools")]
    tool_libraries: Vec<PathBuf>,
    #[arg(long = "material")]
    materials: Vec<PathBuf>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
enum RackSteppingMode {
    Adaptive,
    Fixed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
enum CliRackSteppingQuality {
    Draft,
    Standard,
    Fine,
}

impl From<CliRackSteppingQuality> for RackSteppingQuality {
    fn from(value: CliRackSteppingQuality) -> Self {
        match value {
            CliRackSteppingQuality::Draft => Self::Draft,
            CliRackSteppingQuality::Standard => Self::Standard,
            CliRackSteppingQuality::Fine => Self::Fine,
        }
    }
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Command::Validate { project, libraries } => validate(project, libraries),
        Command::Plan { project, libraries } => plan(project, libraries),
        Command::DebugSpurPath {
            project,
            feature_id,
            rack_steps_per_tooth,
            stepping,
            quality,
            tolerance_mm,
            min_step_mm,
            max_step_mm,
            depth_layers,
            libraries,
        } => debug_spur_path(
            project,
            feature_id,
            DebugSpurPathOptions {
                rack_steps_per_tooth,
                stepping,
                quality,
                tolerance_mm,
                min_step_mm,
                max_step_mm,
                depth_layers,
            },
            libraries,
        ),
        Command::SimulateSpurPath {
            project,
            feature_id,
            rack_steps_per_tooth,
            stepping,
            quality,
            tolerance_mm,
            min_step_mm,
            max_step_mm,
            depth_layers,
            libraries,
        } => simulate_spur_path(
            project,
            feature_id,
            DebugSpurPathOptions {
                rack_steps_per_tooth,
                stepping,
                quality,
                tolerance_mm,
                min_step_mm,
                max_step_mm,
                depth_layers,
            },
            libraries,
        ),
    }
}

fn read_project(path: PathBuf) -> Result<Project> {
    let content = fs::read_to_string(&path)
        .with_context(|| format!("failed to read project file '{}'", path.display()))?;
    serde_json::from_str(&content)
        .with_context(|| format!("failed to parse project file '{}'", path.display()))
}

fn read_json_file<T: serde::de::DeserializeOwned>(path: &PathBuf, label: &str) -> Result<T> {
    let content = fs::read_to_string(path)
        .with_context(|| format!("failed to read {label} file '{}'", path.display()))?;
    serde_json::from_str(&content)
        .with_context(|| format!("failed to parse {label} file '{}'", path.display()))
}

fn read_libraries(args: &LibraryArgs) -> Result<Option<LibrarySet>> {
    if args.machine_profiles.is_empty()
        && args.tool_libraries.is_empty()
        && args.materials.is_empty()
    {
        return Ok(None);
    }

    let machine_profiles = args
        .machine_profiles
        .iter()
        .map(|path| read_json_file::<MachineProfile>(path, "machine profile"))
        .collect::<Result<Vec<_>>>()?;
    let tool_libraries = args
        .tool_libraries
        .iter()
        .map(|path| read_json_file::<ToolLibrary>(path, "tool library"))
        .collect::<Result<Vec<_>>>()?;
    let materials = args
        .materials
        .iter()
        .map(|path| read_json_file::<Material>(path, "material"))
        .collect::<Result<Vec<_>>>()?;

    Ok(Some(LibrarySet::from_parts(
        machine_profiles,
        tool_libraries,
        materials,
    )))
}

fn validate(path: PathBuf, libraries: LibraryArgs) -> Result<()> {
    let project = read_project(path)?;
    let libraries = read_libraries(&libraries)?;
    let report = match &libraries {
        Some(libraries) => validate_project_with_libraries(&project, libraries),
        None => validate_project(&project),
    };

    println!("stack intervals:");
    for interval in &report.intervals {
        println!(
            "  {}: {:.3} mm -> {:.3} mm",
            interval.item_id, interval.start_s_mm, interval.end_s_mm
        );
    }

    print_diagnostics(&report);

    if report.has_errors() {
        anyhow::bail!("validation failed");
    }

    Ok(())
}

fn print_diagnostics(report: &hobgoblin_core::ValidationReport) {
    if report.diagnostics.is_empty() {
        println!("validation passed with no diagnostics");
    } else {
        println!("diagnostics:");
        for diagnostic in &report.diagnostics {
            let severity = match diagnostic.severity {
                Severity::Error => "error",
                Severity::Warning => "warning",
            };
            match &diagnostic.object_id {
                Some(object_id) => println!("  {severity} [{object_id}]: {}", diagnostic.message),
                None => println!("  {severity}: {}", diagnostic.message),
            }
        }
    }
}

fn plan(path: PathBuf, libraries: LibraryArgs) -> Result<()> {
    let project = read_project(path)?;
    let libraries = read_libraries(&libraries)?;
    let report = match &libraries {
        Some(libraries) => validate_project_with_libraries(&project, libraries),
        None => validate_project(&project),
    };
    if report.has_errors() {
        print_diagnostics(&report);
        anyhow::bail!("project has validation errors; refusing to plan");
    }

    let graph = build_initial_operation_graph(&project);
    println!("{}", serde_json::to_string_pretty(&graph)?);
    Ok(())
}

fn debug_spur_path(
    path: PathBuf,
    feature_id: String,
    options: DebugSpurPathOptions,
    libraries: LibraryArgs,
) -> Result<()> {
    let generated = build_debug_spur_path(path, feature_id, options, libraries)?;
    let output = DebugSpurPathOutput {
        feature_id: &generated.feature_id,
        machine_profile_id: generated.machine_profile_id.as_deref(),
        shaft_axis: generated.shaft_axis.as_deref(),
        virtual_rack_axis: generated.virtual_rack_axis.as_deref(),
        radial_axis: generated.radial_axis.as_deref(),
        rotary_axis: generated.rotary_axis.as_deref(),
        pitch_radius_mm: generated.pitch_radius_mm,
        selected_tool_id: generated.selected_tool_id.as_deref(),
        debug_step_count: generated.path.debug_steps.len(),
        move_count: generated.path.path.moves.len(),
        config: &generated.config,
        adaptive_rack_stepping: generated.path.adaptive_rack_stepping.as_ref(),
        path: &generated.path.path,
        debug_steps: &generated.path.debug_steps,
    };

    println!("{}", serde_json::to_string_pretty(&output)?);
    Ok(())
}

fn simulate_spur_path(
    path: PathBuf,
    feature_id: String,
    options: DebugSpurPathOptions,
    libraries: LibraryArgs,
) -> Result<()> {
    let generated = build_debug_spur_path(path, feature_id, options, libraries)?;
    let result = simulate_abstract_path_with_tool(
        &generated.project,
        &generated.path.path,
        generated.selected_tool.as_ref(),
    );
    println!("{}", serde_json::to_string_pretty(&result)?);
    if result.has_errors() {
        anyhow::bail!("simulation reported errors");
    }
    Ok(())
}

#[derive(Debug)]
struct DebugSpurPathOptions {
    rack_steps_per_tooth: u32,
    stepping: RackSteppingMode,
    quality: CliRackSteppingQuality,
    tolerance_mm: Option<f64>,
    min_step_mm: Option<f64>,
    max_step_mm: Option<f64>,
    depth_layers: Vec<f64>,
}

fn build_adaptive_rack_stepping_config(
    quality: CliRackSteppingQuality,
    tolerance_mm: Option<f64>,
    min_step_mm: Option<f64>,
    max_step_mm: Option<f64>,
) -> AdaptiveRackSteppingConfig {
    let mut config = AdaptiveRackSteppingConfig::for_quality(quality.into());
    if let Some(tolerance_mm) = tolerance_mm {
        config.tolerance_mm = tolerance_mm;
    }
    if let Some(min_step_mm) = min_step_mm {
        config.min_step_mm = min_step_mm;
    }
    if let Some(max_step_mm) = max_step_mm {
        config.max_step_mm = max_step_mm;
    }
    config
}

struct GeneratedDebugSpurPath {
    project: Project,
    feature_id: String,
    machine_profile_id: Option<String>,
    shaft_axis: Option<String>,
    virtual_rack_axis: Option<String>,
    radial_axis: Option<String>,
    rotary_axis: Option<String>,
    pitch_radius_mm: f64,
    config: SpurShapingConfig,
    path: SpurShapingPath,
    selected_tool_id: Option<String>,
    selected_tool: Option<Tool>,
}

fn build_debug_spur_path(
    path: PathBuf,
    feature_id: String,
    options: DebugSpurPathOptions,
    libraries: LibraryArgs,
) -> Result<GeneratedDebugSpurPath> {
    let project = read_project(path)?;
    let libraries = read_libraries(&libraries)?;
    let report = match &libraries {
        Some(libraries) => validate_project_with_libraries(&project, libraries),
        None => validate_project(&project),
    };
    if report.has_errors() {
        print_diagnostics(&report);
        anyhow::bail!("project has validation errors; refusing to generate debug path");
    }

    let machine_profile = libraries.as_ref().and_then(|libraries| {
        libraries
            .machine_profiles
            .iter()
            .find(|profile| profile.id == project.setup.machine_profile_id)
    });

    let mut cursor = project.project.datum.s_offset_mm;
    for item in &project.stack {
        let start = cursor;
        cursor += item.length_mm;
        if item.id != feature_id {
            continue;
        }

        let gear = match &item.kind {
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
            } => SpurGear {
                module_mm: *module_mm,
                tooth_count: *tooth_count,
                pressure_angle_deg: *pressure_angle_deg,
                profile_shift: *profile_shift,
                addendum_coeff: *addendum_coeff,
                dedendum_coeff: *dedendum_coeff,
                backlash_mm: *backlash_mm,
                phase_deg: *phase_deg,
                machining: machining.clone(),
            },
            _ => anyhow::bail!("feature '{feature_id}' is not a spur gear"),
        };
        let selected_tool_id = gear.machining.v_tool_id.clone();
        let selected_tool = selected_tool_id.as_deref().and_then(|selected_tool_id| {
            libraries.as_ref().and_then(|libraries| {
                libraries
                    .tools
                    .iter()
                    .find(|tool| tool.id() == selected_tool_id)
                    .cloned()
            })
        });

        let adaptive_rack_stepping = match options.stepping {
            RackSteppingMode::Adaptive => Some(build_adaptive_rack_stepping_config(
                options.quality,
                options.tolerance_mm,
                options.min_step_mm,
                options.max_step_mm,
            )),
            RackSteppingMode::Fixed => None,
        };
        let config = SpurShapingConfig {
            rack_steps_per_tooth: options.rack_steps_per_tooth,
            adaptive_rack_stepping,
            depth_layers: options.depth_layers,
            a_axis_sign: machine_profile
                .map(|profile| profile.axis_mapping.rotary_sign)
                .unwrap_or_else(|| SpurShapingConfig::default().a_axis_sign),
            ..SpurShapingConfig::default()
        };
        let dimensions = derive_spur_dimensions(&gear);
        let result = generate_spur_shaping_path(
            format!("op.feature.{feature_id}.debug_spur_path"),
            &feature_id,
            &gear,
            start,
            item.length_mm,
            &config,
        )
        .with_context(|| format!("failed to generate debug path for feature '{feature_id}'"))?;

        return Ok(GeneratedDebugSpurPath {
            project,
            feature_id,
            machine_profile_id: machine_profile.map(|profile| profile.id.clone()),
            shaft_axis: machine_profile.map(|profile| profile.axis_mapping.shaft_axis.clone()),
            virtual_rack_axis: machine_profile
                .map(|profile| profile.axis_mapping.virtual_rack_axis.clone()),
            radial_axis: machine_profile.map(|profile| profile.axis_mapping.radial_axis.clone()),
            rotary_axis: machine_profile.map(|profile| profile.axis_mapping.rotary_axis.clone()),
            pitch_radius_mm: dimensions.pitch_radius_mm,
            config,
            path: result,
            selected_tool_id,
            selected_tool,
        });
    }

    anyhow::bail!("feature '{feature_id}' not found")
}

#[derive(Debug, Serialize)]
struct DebugSpurPathOutput<'a> {
    feature_id: &'a str,
    machine_profile_id: Option<&'a str>,
    shaft_axis: Option<&'a str>,
    virtual_rack_axis: Option<&'a str>,
    radial_axis: Option<&'a str>,
    rotary_axis: Option<&'a str>,
    pitch_radius_mm: f64,
    selected_tool_id: Option<&'a str>,
    debug_step_count: usize,
    move_count: usize,
    config: &'a SpurShapingConfig,
    adaptive_rack_stepping: Option<&'a hobgoblin_gear::AdaptiveRackSteppingPlan>,
    path: &'a hobgoblin_post::AbstractPath,
    debug_steps: &'a [hobgoblin_planner::SpurShapingDebugStep],
}
