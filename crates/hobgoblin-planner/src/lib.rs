use hobgoblin_core::{PlanningPurpose, Project, StackItemKind};
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
            StackItemKind::CylindricalSection(_) => {
                nodes.push(OperationNode {
                    id: format!("op.feature.{}.finish", item.id),
                    feature_id: Some(item.id.clone()),
                    region_id: None,
                    kind: OperationKind::CylindricalFinishSurface,
                    stage: 100,
                });
            }
            StackItemKind::SpurGear(_) => {
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
