use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use hobgoblin_core::{
    validate_project, validate_project_with_libraries, LibrarySet, MachineProfile, Material,
    Project, Severity, SpurGear, StackItemKind, ToolLibrary,
};
use hobgoblin_gear::derive_spur_dimensions;
use hobgoblin_planner::{
    build_initial_operation_graph, generate_spur_shaping_path, SpurShapingConfig,
};
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
        #[arg(long, default_value_t = 5)]
        rack_steps_per_tooth: u32,
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

fn main() -> Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Command::Validate { project, libraries } => validate(project, libraries),
        Command::Plan { project, libraries } => plan(project, libraries),
        Command::DebugSpurPath {
            project,
            feature_id,
            rack_steps_per_tooth,
            depth_layers,
            libraries,
        } => debug_spur_path(
            project,
            feature_id,
            rack_steps_per_tooth,
            depth_layers,
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
    rack_steps_per_tooth: u32,
    depth_layers: Vec<f64>,
    libraries: LibraryArgs,
) -> Result<()> {
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

        let config = SpurShapingConfig {
            rack_steps_per_tooth,
            depth_layers,
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

        let output = DebugSpurPathOutput {
            feature_id: &feature_id,
            machine_profile_id: machine_profile.map(|profile| profile.id.as_str()),
            shaft_axis: machine_profile.map(|profile| profile.axis_mapping.shaft_axis.as_str()),
            virtual_rack_axis: machine_profile
                .map(|profile| profile.axis_mapping.virtual_rack_axis.as_str()),
            radial_axis: machine_profile.map(|profile| profile.axis_mapping.radial_axis.as_str()),
            rotary_axis: machine_profile.map(|profile| profile.axis_mapping.rotary_axis.as_str()),
            pitch_radius_mm: dimensions.pitch_radius_mm,
            debug_step_count: result.debug_steps.len(),
            move_count: result.path.moves.len(),
            config: &config,
            path: &result.path,
            debug_steps: &result.debug_steps,
        };

        println!("{}", serde_json::to_string_pretty(&output)?);
        return Ok(());
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
    debug_step_count: usize,
    move_count: usize,
    config: &'a SpurShapingConfig,
    path: &'a hobgoblin_post::AbstractPath,
    debug_steps: &'a [hobgoblin_planner::SpurShapingDebugStep],
}
