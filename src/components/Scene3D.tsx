import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
import { USDZLoader } from "three/examples/jsm/loaders/USDZLoader.js";
import type { Room, ScanFormat, Severity } from "../lib/types";
import { SEVERITY_COLOR } from "../lib/format";

export interface Scene3DProps {
  mode: "plan" | "scan";
  rooms: Room[];
  severityByRoom: Record<string, Severity | null>;
  issueCountByRoom: Record<string, number>;
  scan?: { fileName: string; blob: Blob; format: ScanFormat } | null;
  placingRoomId?: string | null;
  onSelectRoom?: (roomId: string) => void;
  onMoveRoom?: (roomId: string, x: number, y: number) => void;
  onPlaceMarker?: (roomId: string, point: [number, number, number]) => void;
  onScanError?: (message: string) => void;
}

const NEUTRAL = "#8d99ae";

interface Ctx {
  renderer: THREE.WebGLRenderer;
  labelRenderer: CSS2DRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  planGroup: THREE.Group;
  scanGroup: THREE.Group;
  markerGroup: THREE.Group;
  pickables: THREE.Object3D[];
  scanMeshes: THREE.Object3D[];
  scanSize: number;
}

export default function Scene3D(props: Scene3DProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const ctxRef = useRef<Ctx | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  // --- one-time setup -----------------------------------------------------
  useEffect(() => {
    const host = hostRef.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    host.appendChild(renderer.domElement);

    const labelRenderer = new CSS2DRenderer();
    labelRenderer.domElement.className = "scene-labels";
    host.appendChild(labelRenderer.domElement);

    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x667788, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(30, 60, 20);
    scene.add(sun);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 2000);
    camera.position.set(30, 40, 50);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI / 2.05;

    const planGroup = new THREE.Group();
    const scanGroup = new THREE.Group();
    const markerGroup = new THREE.Group();
    scene.add(planGroup, scanGroup, markerGroup);

    const ctx: Ctx = {
      renderer, labelRenderer, scene, camera, controls, planGroup, scanGroup, markerGroup,
      pickables: [], scanMeshes: [], scanSize: 10,
    };
    ctxRef.current = ctx;

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = host;
      renderer.setSize(w, h);
      labelRenderer.setSize(w, h);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();

    // --- picking & dragging ---
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    let drag: { roomId: string; mesh: THREE.Object3D; offset: THREE.Vector3; moved: boolean } | null = null;
    let downAt: { x: number; y: number } | null = null;

    const setNdc = (e: PointerEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
    };

    const onDown = (e: PointerEvent) => {
      downAt = { x: e.clientX, y: e.clientY };
      const p = propsRef.current;
      if (p.mode !== "plan") return;
      setNdc(e);
      const hit = raycaster.intersectObjects(ctx.pickables, false)[0];
      if (!hit) return;
      const group = hit.object.parent!;
      const point = new THREE.Vector3();
      raycaster.ray.intersectPlane(ground, point);
      drag = { roomId: group.userData.roomId, mesh: group, offset: group.position.clone().sub(point), moved: false };
      controls.enabled = false;
      renderer.domElement.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!drag) return;
      setNdc(e);
      const point = new THREE.Vector3();
      if (!raycaster.ray.intersectPlane(ground, point)) return;
      const next = point.add(drag.offset);
      // Snap to half-foot grid.
      drag.mesh.position.x = Math.round(next.x * 2) / 2;
      drag.mesh.position.z = Math.round(next.z * 2) / 2;
      drag.moved = true;
    };
    const onUp = (e: PointerEvent) => {
      const p = propsRef.current;
      const isClick = downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 6;
      if (drag) {
        controls.enabled = true;
        const { roomId, mesh, moved } = drag;
        drag = null;
        if (moved && !isClick) {
          const room = p.rooms.find((r) => r.id === roomId);
          if (room) p.onMoveRoom?.(roomId, mesh.position.x - room.widthFt / 2, mesh.position.z - room.lengthFt / 2);
          return;
        }
      }
      if (!isClick) return;
      setNdc(e);
      if (p.mode === "scan" && p.placingRoomId) {
        const hit = raycaster.intersectObjects(ctx.scanMeshes, true)[0];
        if (hit) p.onPlaceMarker?.(p.placingRoomId, [hit.point.x, hit.point.y, hit.point.z]);
        return;
      }
      const targets = p.mode === "plan" ? ctx.pickables : ctx.markerGroup.children;
      const hit = raycaster.intersectObjects(targets, true)[0];
      let o: THREE.Object3D | null = hit?.object ?? null;
      while (o && !o.userData.roomId) o = o.parent;
      if (o) p.onSelectRoom?.(o.userData.roomId);
    };
    const el = renderer.domElement;
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);

    let raf = 0;
    const loop = () => {
      controls.update();
      renderer.render(scene, camera);
      labelRenderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    loop();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      controls.dispose();
      disposeTree(scene);
      renderer.dispose();
      host.innerHTML = "";
      ctxRef.current = null;
    };
  }, []);

  // --- generated floor plan ----------------------------------------------
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    clearGroup(ctx.planGroup);
    ctx.pickables = [];
    ctx.planGroup.visible = props.mode === "plan";
    if (props.mode !== "plan") return;

    const bounds = new THREE.Box3();
    for (const room of props.rooms) {
      const sev = props.severityByRoom[room.id];
      const color = new THREE.Color(sev ? SEVERITY_COLOR[sev] : NEUTRAL);
      const g = new THREE.Group();
      g.userData.roomId = room.id;
      g.position.set(room.x + room.widthFt / 2, 0, room.y + room.lengthFt / 2);

      const floor = new THREE.Mesh(
        new THREE.BoxGeometry(room.widthFt, 0.3, room.lengthFt),
        new THREE.MeshStandardMaterial({ color, roughness: 0.8 }),
      );
      floor.position.y = 0.15;
      g.add(floor);
      ctx.pickables.push(floor);

      const walls = new THREE.Mesh(
        new THREE.BoxGeometry(room.widthFt, room.ceilingFt, room.lengthFt),
        new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }),
      );
      walls.position.y = room.ceilingFt / 2;
      g.add(walls);
      ctx.pickables.push(walls);

      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(walls.geometry),
        new THREE.LineBasicMaterial({ color: 0x14213d }),
      );
      edges.position.copy(walls.position);
      g.add(edges);

      g.add(makeLabel(room.name, props.issueCountByRoom[room.id] ?? 0, sev, room.id, room.ceilingFt + 0.8));
      ctx.planGroup.add(g);
      bounds.expandByObject(g);
    }
    if (!bounds.isEmpty() && !ctx.planGroup.userData.framed) {
      frame(ctx, bounds);
      ctx.planGroup.userData.framed = true;
    }
  }, [props.mode, props.rooms, props.severityByRoom, props.issueCountByRoom]);

  // --- imported scan ------------------------------------------------------
  // IndexedDB hands back a new Blob on every reload, so key on file identity.
  const scanKey = props.scan ? `${props.scan.fileName}|${props.scan.blob.size}|${props.scan.format}` : "";
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    clearGroup(ctx.scanGroup);
    ctx.scanMeshes = [];
    const scan = propsRef.current.scan;
    if (!scan) return;
    let cancelled = false;
    const url = URL.createObjectURL(scan.blob);
    loadScan(url, scan.format)
      .then((obj) => {
        if (cancelled) return;
        // Center on origin with the floor at y=0 so marker coordinates stay stable.
        const box = new THREE.Box3().setFromObject(obj);
        const center = box.getCenter(new THREE.Vector3());
        obj.position.sub(new THREE.Vector3(center.x, box.min.y, center.z));
        ctx.scanGroup.add(obj);
        ctx.scanMeshes = [obj];
        const size = box.getSize(new THREE.Vector3());
        ctx.scanSize = Math.max(size.x, size.y, size.z) || 10;
        if (propsRef.current.mode === "scan") frame(ctx, new THREE.Box3().setFromObject(ctx.scanGroup));
      })
      .catch((err) => {
        console.error(err);
        propsRef.current.onScanError?.("Could not open this 3D file. Export it as .glb from your scanning app and try again.");
      })
      .finally(() => URL.revokeObjectURL(url));
    return () => {
      cancelled = true;
    };
  }, [scanKey]);

  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    ctx.scanGroup.visible = props.mode === "scan";
    ctx.markerGroup.visible = props.mode === "scan";
    if (props.mode === "scan" && ctx.scanGroup.children.length) frame(ctx, new THREE.Box3().setFromObject(ctx.scanGroup));
    if (props.mode === "plan" && ctx.planGroup.children.length) frame(ctx, new THREE.Box3().setFromObject(ctx.planGroup));
  }, [props.mode]);

  // --- room markers on the scan ------------------------------------------
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    clearGroup(ctx.markerGroup);
    if (props.mode !== "scan") return;
    const r = Math.max(0.08, ctx.scanSize * 0.015);
    for (const room of props.rooms) {
      if (!room.scanMarker) continue;
      const sev = props.severityByRoom[room.id];
      const g = new THREE.Group();
      g.userData.roomId = room.id;
      g.position.set(...room.scanMarker);
      g.add(
        new THREE.Mesh(
          new THREE.SphereGeometry(r, 24, 16),
          new THREE.MeshStandardMaterial({ color: sev ? SEVERITY_COLOR[sev] : NEUTRAL, emissive: 0x222222 }),
        ),
      );
      g.add(makeLabel(room.name, props.issueCountByRoom[room.id] ?? 0, sev, room.id, r * 2.5));
      ctx.markerGroup.add(g);
    }
  }, [props.mode, props.rooms, props.severityByRoom, props.issueCountByRoom, scanKey]);

  useEffect(() => {
    const el = ctxRef.current?.renderer.domElement;
    if (el) el.style.cursor = props.placingRoomId ? "crosshair" : props.mode === "plan" ? "grab" : "default";
  }, [props.placingRoomId, props.mode]);

  return <div ref={hostRef} className="scene3d" />;
}

function makeLabel(name: string, count: number, sev: Severity | null | undefined, roomId: string, y: number) {
  const div = document.createElement("div");
  div.className = "scene-label";
  div.style.borderColor = sev ? SEVERITY_COLOR[sev] : NEUTRAL;
  div.textContent = count ? `${name} · ${count}` : name;
  const obj = new CSS2DObject(div);
  obj.position.y = y;
  obj.userData.roomId = roomId;
  return obj;
}

function frame(ctx: Ctx, box: THREE.Box3) {
  if (box.isEmpty()) return;
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3()).length();
  ctx.controls.target.copy(center);
  ctx.camera.position.set(center.x + size * 0.5, center.y + size * 0.85, center.z + size * 0.75);
  ctx.camera.near = size / 500;
  ctx.camera.far = size * 50;
  ctx.camera.updateProjectionMatrix();
}

async function loadScan(url: string, format: ScanFormat): Promise<THREE.Object3D> {
  switch (format) {
    case "glb":
    case "gltf":
      return (await new GLTFLoader().loadAsync(url)).scene;
    case "obj": {
      const obj = await new OBJLoader().loadAsync(url);
      obj.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = new THREE.MeshStandardMaterial({ color: 0xd9dde3, side: THREE.DoubleSide });
      });
      return obj;
    }
    case "ply": {
      const geo = await new PLYLoader().loadAsync(url);
      const hasColor = Boolean(geo.getAttribute("color"));
      // PLY files without faces are point clouds (e.g. Scaniverse/Polycam point exports).
      if (!geo.index) {
        return new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.015, vertexColors: hasColor, color: hasColor ? 0xffffff : 0x8d99ae }));
      }
      if (!geo.getAttribute("normal")) geo.computeVertexNormals();
      return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: hasColor ? 0xffffff : 0xd9dde3, vertexColors: hasColor, side: THREE.DoubleSide }));
    }
    case "usdz": {
      const buf = await (await fetch(url)).arrayBuffer();
      return new USDZLoader().parse(buf) as THREE.Object3D;
    }
  }
}

function clearGroup(g: THREE.Group) {
  for (const child of [...g.children]) {
    disposeTree(child);
    g.remove(child);
  }
}

function disposeTree(root: THREE.Object3D) {
  root.traverse((o) => {
    if (o instanceof CSS2DObject) o.element.remove();
    const m = o as THREE.Mesh;
    m.geometry?.dispose?.();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else mat?.dispose?.();
  });
}
