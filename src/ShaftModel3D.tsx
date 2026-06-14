import { useEffect, useRef } from "react";
import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  DirectionalLight,
  HemisphereLight,
  Line,
  LineBasicMaterial,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Material,
  type Object3D,
} from "three";
import { radiusForItem, stackSpans } from "./geometry";
import type { HobgoblinProject, StackItem } from "./project";
import type { GeneratedToolpath } from "./tauri";

export default function ShaftModel3D({
  project,
  selectedObjectId,
  toolpaths,
  onSelect,
}: {
  project: HobgoblinProject;
  selectedObjectId: string | null;
  toolpaths: GeneratedToolpath[];
  onSelect: (objectId: string) => void;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const cameraState = useRef({
    theta: -0.7,
    phi: 1.1,
    distance: Math.max(project.stock.length_mm * 1.35, project.stock.diameter_mm * 5),
    target: new Vector3(project.stock.length_mm / 2, 0, 0),
  });
  const dragState = useRef<{
    pointerId: number;
    x: number;
    y: number;
    mode: "orbit" | "pan";
  } | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) {
      return;
    }
    mount.textContent = "";
    const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setClearColor(0xf7faf4, 1);
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.domElement.className = "shaft-3d-canvas";
    renderer.domElement.dataset.renderer = "three-webgl";
    renderer.domElement.dataset.selectedObject = selectedObjectId ?? "";
    mount.appendChild(renderer.domElement);

    const scene = new Scene();
    scene.add(new HemisphereLight(0xffffff, 0x6a756f, 2.2));
    const keyLight = new DirectionalLight(0xffffff, 2.6);
    keyLight.position.set(-40, 50, 70);
    scene.add(keyLight);
    const fillLight = new DirectionalLight(0x9fc5b4, 1.0);
    fillLight.position.set(60, -30, -45);
    scene.add(fillLight);

    const camera = new PerspectiveCamera(42, 1, 0.1, 2000);
    const raycaster = new Raycaster();
    const pointer = new Vector2();
    const pickables: Object3D[] = [];

    const stockStart = project.project.datum.s_offset_mm;
    const stockLength = project.stock.length_mm;
    const stockRadius = project.stock.diameter_mm / 2;
    const stockMaterial = new MeshStandardMaterial({
      color: project.stock.id === selectedObjectId ? 0xf0bf6b : 0xd9a44c,
      transparent: true,
      opacity: project.stock.id === selectedObjectId ? 0.44 : 0.28,
      roughness: 0.72,
      metalness: 0.12,
    });
    const stockMesh = cylinderAlongX(stockLength, stockRadius, 72, stockMaterial);
    stockMesh.position.x = stockStart + stockLength / 2;
    stockMesh.name = project.stock.id;
    stockMesh.userData.featureId = project.stock.id;
    scene.add(stockMesh);
    pickables.push(stockMesh);

    const spans = stackSpans(project);
    for (const span of spans) {
      const radius = Math.max(0.1, radiusForItem(span.item));
      const spurGear = span.item.type === "spur_gear";
      const featureMaterial = new MeshStandardMaterial({
        color: span.item.id === selectedObjectId ? 0x7ec4a5 : spurGear ? 0x67a893 : 0x8fbeb2,
        roughness: 0.48,
        metalness: 0.34,
      });
      const rootRadius = spurGear
        ? Math.max(radius * 0.72, radius - moduleForStackItem(span.item) * 1.25)
        : radius;
      const featureMesh = cylinderAlongX(span.endS - span.startS, rootRadius, 72, featureMaterial);
      featureMesh.position.x = (span.startS + span.endS) / 2;
      featureMesh.userData.featureId = span.item.id;
      scene.add(featureMesh);
      pickables.push(featureMesh);

      if (spurGear) {
        const toothCount = toothCountForStackItem(span.item);
        const toothDepth = Math.max(0.18, radius - rootRadius);
        const toothWidth = Math.max(0.08, ((2 * Math.PI * radius) / toothCount) * 0.46);
        const toothGeometry = new BoxGeometry(span.endS - span.startS, toothWidth, toothDepth);
        for (let index = 0; index < toothCount; index += 1) {
          const angle = (index / toothCount) * Math.PI * 2;
          const tooth = new Mesh(toothGeometry, featureMaterial);
          tooth.position.set(
            (span.startS + span.endS) / 2,
            Math.cos(angle) * (rootRadius + toothDepth / 2),
            Math.sin(angle) * (rootRadius + toothDepth / 2),
          );
          tooth.rotation.x = -angle;
          tooth.userData.featureId = span.item.id;
          scene.add(tooth);
          pickables.push(tooth);
        }
      }
    }

    for (const interval of project.setup.protected_intervals ?? []) {
      const length = Math.max(0.1, interval.end_s_mm - interval.start_s_mm);
      const protectedMesh = cylinderAlongX(
        length,
        stockRadius * 1.04,
        48,
        new MeshStandardMaterial({
          color: 0xd97c5e,
          transparent: true,
          opacity: 0.2,
          roughness: 0.6,
        }),
      );
      protectedMesh.position.x = (interval.start_s_mm + interval.end_s_mm) / 2;
      scene.add(protectedMesh);
    }

    const pathMaterial = new LineBasicMaterial({ color: 0xd04a35 });
    for (const generated of toolpaths) {
      const span = spans.find((candidate) => candidate.item.id === generated.feature_id);
      if (!span) {
        continue;
      }
      const radius = radiusForItem(span.item);
      let previous: Vector3 | null = null;
      let currentX = span.startS;
      for (const move of generated.path.path.moves) {
        if (typeof move.x_mm === "number") {
          currentX = move.x_mm;
        }
        const depth = typeof move.z_mm === "number" ? Math.abs(move.z_mm) : 0;
        const a = typeof move.a_deg === "number" ? MathUtils.degToRad(move.a_deg) : 0;
        const point = new Vector3(
          currentX,
          Math.cos(a) * Math.max(0.1, radius - depth),
          Math.sin(a) * Math.max(0.1, radius - depth),
        );
        if (move.type === "linear_cut" && previous) {
          scene.add(new Line(new BufferGeometry().setFromPoints([previous, point]), pathMaterial));
        }
        previous = point;
      }
    }

    const axis = new Line(
      new BufferGeometry().setFromPoints([
        new Vector3(stockStart - stockLength * 0.08, 0, 0),
        new Vector3(stockStart + stockLength * 1.08, 0, 0),
      ]),
      new LineBasicMaterial({ color: 0x46555a }),
    );
    scene.add(axis);

    const updateSize = () => {
      const bounds = mount.getBoundingClientRect();
      const width = Math.max(1, Math.round(bounds.width));
      const height = Math.max(1, Math.round(bounds.height));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const applyCamera = () => {
      const state = cameraState.current;
      const sinPhi = Math.sin(state.phi);
      camera.position.set(
        state.target.x + Math.cos(state.theta) * sinPhi * state.distance,
        state.target.y + Math.cos(state.phi) * state.distance,
        state.target.z + Math.sin(state.theta) * sinPhi * state.distance,
      );
      camera.lookAt(state.target);
    };
    const render = () => {
      updateSize();
      applyCamera();
      renderer.render(scene, camera);
    };
    render();
    const resizeObserver = new ResizeObserver(render);
    resizeObserver.observe(mount);

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      cameraState.current.distance = Math.min(
        800,
        Math.max(8, cameraState.current.distance * (event.deltaY > 0 ? 1.12 : 0.88)),
      );
      render();
    };
    const onPointerDown = (event: PointerEvent) => {
      renderer.domElement.setPointerCapture(event.pointerId);
      dragState.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        mode: event.shiftKey || event.button === 1 ? "pan" : "orbit",
      };
    };
    const onPointerMove = (event: PointerEvent) => {
      const drag = dragState.current;
      if (!drag || drag.pointerId !== event.pointerId) {
        return;
      }
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      drag.x = event.clientX;
      drag.y = event.clientY;
      if (drag.mode === "pan") {
        const panScale = cameraState.current.distance * 0.0018;
        cameraState.current.target.x -= dx * panScale;
        cameraState.current.target.y += dy * panScale;
      } else {
        cameraState.current.theta -= dx * 0.008;
        cameraState.current.phi = Math.min(
          Math.PI - 0.08,
          Math.max(0.12, cameraState.current.phi + dy * 0.008),
        );
      }
      render();
    };
    const onPointerUp = (event: PointerEvent) => {
      const drag = dragState.current;
      if (drag?.pointerId === event.pointerId) {
        dragState.current = null;
      }
    };
    const onClick = (event: MouseEvent) => {
      const bounds = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
      pointer.y = -(((event.clientY - bounds.top) / bounds.height) * 2 - 1);
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(pickables, false);
      const hit = hits.find((candidate) => candidate.object.userData.featureId !== project.stock.id) ?? hits[0];
      const featureId = hit?.object.userData.featureId;
      if (typeof featureId === "string") {
        onSelect(featureId);
      }
    };

    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointercancel", onPointerUp);
    renderer.domElement.addEventListener("click", onClick);

    return () => {
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("wheel", onWheel);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointercancel", onPointerUp);
      renderer.domElement.removeEventListener("click", onClick);
      renderer.dispose();
      scene.traverse((object) => {
        if (object instanceof Mesh) {
          object.geometry.dispose();
          if (Array.isArray(object.material)) {
            object.material.forEach((material) => material.dispose());
          } else {
            object.material.dispose();
          }
        }
      });
    };
  }, [project, selectedObjectId, toolpaths, onSelect]);

  return (
    <div className="shaft-3d-viewer" role="img" aria-label="3D WebGL shaft model preview">
      <div ref={mountRef} className="shaft-3d-mount" />
    </div>
  );
}

function cylinderAlongX(length: number, radius: number, segments: number, material: Material) {
  const geometry = new CylinderGeometry(radius, radius, Math.max(0.1, length), segments, 1, false);
  const mesh = new Mesh(geometry, material);
  mesh.rotation.z = Math.PI / 2;
  return mesh;
}

function moduleForStackItem(item: StackItem): number {
  const direct = typeof item.module_mm === "number" ? item.module_mm : null;
  const spur = typeof item.spur === "object" && item.spur !== null ? (item.spur as Record<string, unknown>) : null;
  const nested = typeof spur?.module_mm === "number" ? spur.module_mm : null;
  return Math.max(0.05, direct ?? nested ?? Math.max(0.1, radiusForItem(item) * 0.08));
}

function toothCountForStackItem(item: StackItem): number {
  const direct = typeof item.tooth_count === "number" ? item.tooth_count : null;
  const spur = typeof item.spur === "object" && item.spur !== null ? (item.spur as Record<string, unknown>) : null;
  const nested = typeof spur?.tooth_count === "number" ? spur.tooth_count : null;
  return Math.max(6, Math.min(64, Math.round(direct ?? nested ?? 18)));
}
