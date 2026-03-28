"use client";

import { useRef, useMemo, useState, useCallback, useEffect } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { TrackballControls } from "@react-three/drei";
import * as THREE from "three";
import { FEATURED_REPOS, getLanguageColor } from "@/lib/data/featured-repos";
import { Repo } from "@/lib/store/app-store";
import { RepoTooltip } from "./RepoTooltip";

/* ═══════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════ */

export interface ConstellationNode {
  id: string;
  name: string;
  owner: string;
  description: string;
  language: string;
  stars: number;
  isUserRepo: boolean;
  indexed?: boolean;
}

interface NodePlacement extends ConstellationNode {
  x: number;
  y: number;
  z: number;
  baseScale: number;
}

const MAX_NODES = 100;
const DUST_COUNT = 500;
const SPHERE_RADIUS = 2.8;
const AUTO_SPOTLIGHT_INTERVAL = 3500;
const AUTO_SPOTLIGHT_DURATION = 2800;

/* ═══════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════ */

function buildNodes(userRepos: Repo[]): ConstellationNode[] {
  const userNodes: ConstellationNode[] = userRepos.map((r) => ({
    id: r.full_name,
    name: r.name,
    owner: r.owner,
    description: r.description || "",
    language: r.language || "Unknown",
    stars: r.stargazers_count,
    isUserRepo: true,
    indexed: r.indexed,
  }));

  const featuredSlots = Math.max(0, MAX_NODES - userNodes.length);
  const userFullNames = new Set(userNodes.map((n) => n.id));

  const featured = [...FEATURED_REPOS]
    .filter((r) => !userFullNames.has(r.full_name))
    .slice(0, featuredSlots)
    .map(
      (r): ConstellationNode => ({
        id: r.full_name,
        name: r.name,
        owner: r.owner,
        description: r.description,
        language: r.language,
        stars: r.stars,
        isUserRepo: false,
      })
    );

  return [...userNodes, ...featured];
}

function placeOnSphere(nodes: ConstellationNode[]): NodePlacement[] {
  const count = nodes.length;
  if (count === 0) return [];
  if (count === 1) {
    return [{ ...nodes[0], x: 0, y: 0, z: SPHERE_RADIUS, baseScale: 0.07 }];
  }

  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  return nodes.map((node, i) => {
    const y = 1 - (i / (count - 1)) * 2;
    const radiusAtY = Math.sqrt(1 - y * y);
    const theta = goldenAngle * i;
    const r = SPHERE_RADIUS + (Math.random() - 0.5) * 0.3;
    return {
      ...node,
      x: Math.cos(theta) * radiusAtY * r,
      y: y * r,
      z: Math.sin(theta) * radiusAtY * r,
      baseScale: node.isUserRepo ? 0.09 : 0.065,
    };
  });
}

/* ═══════════════════════════════════════════════════
   Dust Particles
   ═══════════════════════════════════════════════════ */

function DustParticles({ count = DUST_COUNT }: { count?: number }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  const particles = useMemo(() => {
    const arr = [];
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = SPHERE_RADIUS + (Math.random() - 0.5) * 1.2;
      arr.push({
        x: r * Math.sin(phi) * Math.cos(theta),
        y: r * Math.sin(phi) * Math.sin(theta),
        z: r * Math.cos(phi),
        scale: 0.006 + Math.random() * 0.014,
        speed: 0.08 + Math.random() * 0.2,
      });
    }
    return arr;
  }, [count]);

  useFrame((state) => {
    if (!meshRef.current) return;
    const t = state.clock.getElapsedTime() * 0.15;
    particles.forEach((p, i) => {
      const angle = t * p.speed;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      dummy.position.set(
        p.x * cos - p.z * sin,
        p.y + Math.sin(t * p.speed * 2) * 0.04,
        p.x * sin + p.z * cos
      );
      dummy.scale.setScalar(p.scale);
      dummy.updateMatrix();
      meshRef.current!.setMatrixAt(i, dummy.matrix);
    });
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]}>
      <sphereGeometry args={[1, 4, 4]} />
      <meshBasicMaterial color="#ffffff" transparent opacity={0.25} />
    </instancedMesh>
  );
}

/* ═══════════════════════════════════════════════════
   RepoNodes — interactive repo spheres
   ═══════════════════════════════════════════════════ */

interface RepoNodesProps {
  placements: NodePlacement[];
  hoveredId: string | null;
  spotlightIds: Set<string>;
  onHover: (id: string | null, screenPos: { x: number; y: number } | null) => void;
  onClick: (node: ConstellationNode) => void;
  onSpotlightScreenPos: (pos: { x: number; y: number } | null) => void;
}

function RepoNodes({
  placements,
  hoveredId,
  spotlightIds,
  onHover,
  onClick,
  onSpotlightScreenPos,
}: RepoNodesProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const { camera, gl } = useThree();


  const animatedScales = useRef<Float32Array>(
    new Float32Array(placements.length).fill(1)
  );

  // Re-initialize scales when node count changes
  useEffect(() => {
    animatedScales.current = new Float32Array(placements.length).fill(1);
  }, [placements.length]);

  // Language-based colors
  const colors = useMemo(() => {
    const arr = new Float32Array(placements.length * 3);
    placements.forEach((p, i) => {
      const hex = getLanguageColor(p.language);
      const color = new THREE.Color(hex);
      arr[i * 3] = color.r;
      arr[i * 3 + 1] = color.g;
      arr[i * 3 + 2] = color.b;
    });
    return arr;
  }, [placements]);

  const HIT_RADIUS_PX = 30; // generous pixel-based hit radius

  // Find closest node to screen position within hit radius
  const findClosestNode = useCallback(
    (clientX: number, clientY: number) => {
      const rect = gl.domElement.getBoundingClientRect();
      let closestIdx = -1;
      let closestDist = Infinity;

      for (let i = 0; i < placements.length; i++) {
        const p = placements[i];
        const pos = new THREE.Vector3(p.x, p.y, p.z);
        pos.project(camera);
        const sx = ((pos.x + 1) / 2) * rect.width + rect.left;
        const sy = ((-pos.y + 1) / 2) * rect.height + rect.top;
        const dx = clientX - sx;
        const dy = clientY - sy;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // Only consider nodes in front of the camera (z < 1 in NDC)
        if (dist < closestDist && dist < HIT_RADIUS_PX && pos.z < 1) {
          closestDist = dist;
          closestIdx = i;
        }
      }
      return closestIdx;
    },
    [camera, gl, placements]
  );

  // Pointer move → screen-space distance check
  const handlePointerMove = useCallback(
    (e: PointerEvent) => {
      const rect = gl.domElement.getBoundingClientRect();
      const idx = findClosestNode(e.clientX, e.clientY);

      if (idx >= 0) {
        const node = placements[idx];
        const pos = new THREE.Vector3(node.x, node.y, node.z);
        pos.project(camera);
        const screenX = ((pos.x + 1) / 2) * rect.width + rect.left;
        const screenY = ((-pos.y + 1) / 2) * rect.height + rect.top;
        onHover(node.id, { x: screenX, y: screenY });
      } else {
        onHover(null, null);
      }
    },
    [camera, gl, placements, onHover, findClosestNode]
  );

  const handleClick = useCallback(
    (e: MouseEvent) => {
      const idx = findClosestNode(e.clientX, e.clientY);
      if (idx >= 0) {
        onClick(placements[idx]);
      }
    },
    [placements, onClick, findClosestNode]
  );

  // Track drag distance to distinguish click from drag
  const mouseDownPos = useRef<{ x: number; y: number } | null>(null);
  const DRAG_THRESHOLD = 5; // px

  const handleMouseDown = useCallback((e: MouseEvent) => {
    mouseDownPos.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handleMouseUp = useCallback(
    (e: MouseEvent) => {
      if (!mouseDownPos.current) return;
      const dx = e.clientX - mouseDownPos.current.x;
      const dy = e.clientY - mouseDownPos.current.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < DRAG_THRESHOLD) {
        handleClick(e);
      }
      mouseDownPos.current = null;
    },
    [handleClick]
  );

  useEffect(() => {
    const el = gl.domElement;
    el.addEventListener("pointermove", handlePointerMove);
    el.addEventListener("mousedown", handleMouseDown);
    el.addEventListener("mouseup", handleMouseUp);
    return () => {
      el.removeEventListener("pointermove", handlePointerMove);
      el.removeEventListener("mousedown", handleMouseDown);
      el.removeEventListener("mouseup", handleMouseUp);
    };
  }, [gl, handlePointerMove, handleMouseDown, handleMouseUp]);

  // Frame loop: animate scales + project spotlight position
  useFrame((state) => {
    if (!meshRef.current) return;
    const dt = state.clock.getDelta();

    // Project spotlight node position to screen for tooltip
    if (spotlightIds.size > 0 && !hoveredId) {
      const firstId = Array.from(spotlightIds)[0];
      const placement = placements.find((p) => p.id === firstId);
      if (placement) {
        const rect = gl.domElement.getBoundingClientRect();
        const pos = new THREE.Vector3(placement.x, placement.y, placement.z);
        pos.project(camera);
        const screenX = ((pos.x + 1) / 2) * rect.width + rect.left;
        const screenY = ((-pos.y + 1) / 2) * rect.height + rect.top;
        onSpotlightScreenPos({ x: screenX, y: screenY });
      }
    }

    placements.forEach((p, i) => {
      const isHovered = hoveredId === p.id;
      const isSpotlit = spotlightIds.has(p.id);
      let targetScaleMult = 1;
      if (isHovered) targetScaleMult = 2.5;
      else if (isSpotlit) targetScaleMult = 2.0;

      const current = animatedScales.current[i];
      const lerped = current + (targetScaleMult - current) * Math.min(1, dt * 6);
      animatedScales.current[i] = lerped;

      dummy.position.set(p.x, p.y, p.z);
      dummy.scale.setScalar(p.baseScale * lerped);
      dummy.updateMatrix();
      meshRef.current!.setMatrixAt(i, dummy.matrix);
    });

    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, placements.length]}
      frustumCulled={false}
    >
      <sphereGeometry args={[1, 12, 12]}>
        <instancedBufferAttribute attach="attributes-color" args={[colors, 3]} />
      </sphereGeometry>
      <meshBasicMaterial vertexColors transparent opacity={0.9} />
    </instancedMesh>
  );
}

/* ═══════════════════════════════════════════════════
   Glow Rings
   ═══════════════════════════════════════════════════ */

interface GlowRingsProps {
  placements: NodePlacement[];
  hoveredId: string | null;
  spotlightIds: Set<string>;
}

function GlowRings({ placements, hoveredId, spotlightIds }: GlowRingsProps) {
  const ringsRef = useRef<THREE.Group>(null);

  useFrame((state) => {
    if (!ringsRef.current) return;
    const t = state.clock.getElapsedTime();

    let childIdx = 0;
    ringsRef.current.children.forEach((child) => {
      child.visible = false;
    });

    placements.forEach((p) => {
      const active = hoveredId === p.id || spotlightIds.has(p.id);
      if (!active) return;
      if (childIdx >= ringsRef.current!.children.length) return;

      const ring = ringsRef.current!.children[childIdx] as THREE.Mesh;
      ring.visible = true;
      ring.position.set(p.x, p.y, p.z);

      const pulse = 1 + Math.sin(t * 3) * 0.15;
      const s = (hoveredId === p.id ? 0.22 : 0.18) * pulse;
      ring.scale.setScalar(s);

      const mat = ring.material as THREE.MeshBasicMaterial;
      mat.color.set(getLanguageColor(p.language));

      childIdx++;
    });
  });

  return (
    <group ref={ringsRef}>
      {Array.from({ length: 5 }).map((_, i) => (
        <mesh key={i} visible={false}>
          <ringGeometry args={[0.8, 1, 32]} />
          <meshBasicMaterial
            color="#3FB950"
            transparent
            opacity={0.3}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
    </group>
  );
}

/* ═══════════════════════════════════════════════════
   Scene
   ═══════════════════════════════════════════════════ */

interface SceneProps {
  placements: NodePlacement[];
  hoveredId: string | null;
  spotlightIds: Set<string>;
  onHover: (id: string | null, screenPos: { x: number; y: number } | null) => void;
  onClick: (node: ConstellationNode) => void;
  onSpotlightScreenPos: (pos: { x: number; y: number } | null) => void;
  isUserHovering: boolean;
}

function Scene({
  placements,
  hoveredId,
  spotlightIds,
  onHover,
  onClick,
  onSpotlightScreenPos,
  isUserHovering,
}: SceneProps) {
  const controlsRef = useRef<any>(null);
  const { camera } = useThree();
  const [isDragging, setIsDragging] = useState(false);
  const dragTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoRotateStrength = useRef(1);

  // Manual auto-rotation: rotate camera around the Y axis each frame
  useFrame((_, delta) => {
    const shouldRotate = !isDragging && !isUserHovering;
    const target = shouldRotate ? 1 : 0;
    autoRotateStrength.current += (target - autoRotateStrength.current) * 0.08;

    if (autoRotateStrength.current > 0.001) {
      const speed = 0.15 * autoRotateStrength.current * delta;
      // Rotate camera position around the origin on the Y axis
      const x = camera.position.x;
      const z = camera.position.z;
      camera.position.x = x * Math.cos(speed) - z * Math.sin(speed);
      camera.position.z = x * Math.sin(speed) + z * Math.cos(speed);
      camera.lookAt(0, 0, 0);

      // Sync TrackballControls target
      if (controlsRef.current) {
        controlsRef.current.target.set(0, 0, 0);
      }
    }
  });

  const handleStart = useCallback(() => {
    setIsDragging(true);
    if (dragTimeoutRef.current) clearTimeout(dragTimeoutRef.current);
  }, []);

  const handleEnd = useCallback(() => {
    if (dragTimeoutRef.current) clearTimeout(dragTimeoutRef.current);
    dragTimeoutRef.current = setTimeout(() => {
      setIsDragging(false);
    }, 500);
  }, []);

  return (
    <>
      <ambientLight intensity={0.5} />
      <TrackballControls
        ref={controlsRef}
        noZoom
        noPan
        rotateSpeed={3}
        dynamicDampingFactor={0.15}
        onStart={handleStart}
        onEnd={handleEnd}
      />
      <DustParticles />
      <RepoNodes
        placements={placements}
        hoveredId={hoveredId}
        spotlightIds={spotlightIds}
        onHover={onHover}
        onClick={onClick}
        onSpotlightScreenPos={onSpotlightScreenPos}
      />
      <GlowRings
        placements={placements}
        hoveredId={hoveredId}
        spotlightIds={spotlightIds}
      />
    </>
  );
}

/* ═══════════════════════════════════════════════════
   RepoConstellation — exported
   ═══════════════════════════════════════════════════ */

interface RepoConstellationProps {
  repos: Repo[];
  onNodeClick?: (node: ConstellationNode) => void;
  fillContainer?: boolean;
}

export function RepoConstellation({ repos, onNodeClick, fillContainer }: RepoConstellationProps) {
  const nodes = useMemo(() => buildNodes(repos), [repos]);
  const placements = useMemo(() => placeOnSphere(nodes), [nodes]);

  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
  const [isUserHovering, setIsUserHovering] = useState(false);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [spotlightIds, setSpotlightIds] = useState<Set<string>>(new Set());
  const spotlightTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [spotlightScreenPos, setSpotlightScreenPos] = useState<{ x: number; y: number } | null>(null);

  const hoveredNode = useMemo(
    () => nodes.find((n) => n.id === hoveredId) || null,
    [nodes, hoveredId]
  );

  const handleHover = useCallback(
    (id: string | null, screenPos: { x: number; y: number } | null) => {
      setHoveredId(id);
      setTooltipPos(screenPos);

      if (id) {
        setIsUserHovering(true);
        if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
      } else {
        if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
        hoverTimeoutRef.current = setTimeout(() => {
          setIsUserHovering(false);
        }, 3000);
      }
    },
    []
  );

  const handleClick = useCallback(
    (node: ConstellationNode) => {
      onNodeClick?.(node);
    },
    [onNodeClick]
  );

  // Spotlight screen position callback (from inside Three.js frame loop)
  const handleSpotlightScreenPos = useCallback(
    (pos: { x: number; y: number } | null) => {
      setSpotlightScreenPos(pos);
    },
    []
  );

  // Auto-spotlight
  useEffect(() => {
    if (isUserHovering) {
      setSpotlightIds(new Set());
      setSpotlightScreenPos(null);
      if (spotlightTimerRef.current) {
        clearInterval(spotlightTimerRef.current);
        spotlightTimerRef.current = null;
      }
      return;
    }

    function pickSpotlight() {
      if (nodes.length === 0) return;
      const count = Math.random() > 0.5 ? 2 : 1;
      const picked = new Set<string>();
      while (picked.size < count && picked.size < nodes.length) {
        const idx = Math.floor(Math.random() * nodes.length);
        picked.add(nodes[idx].id);
      }
      setSpotlightIds(picked);
      setTimeout(() => {
        setSpotlightIds(new Set());
        setSpotlightScreenPos(null);
      }, AUTO_SPOTLIGHT_DURATION);
    }

    const initialTimeout = setTimeout(pickSpotlight, 1000);
    spotlightTimerRef.current = setInterval(pickSpotlight, AUTO_SPOTLIGHT_INTERVAL);

    return () => {
      clearTimeout(initialTimeout);
      if (spotlightTimerRef.current) clearInterval(spotlightTimerRef.current);
    };
  }, [isUserHovering, nodes]);

  // Determine which tooltip to show
  const displayedTooltipNode = useMemo(() => {
    if (hoveredNode) return hoveredNode;
    if (spotlightIds.size > 0 && !isUserHovering) {
      const firstId = Array.from(spotlightIds)[0];
      return nodes.find((n) => n.id === firstId) || null;
    }
    return null;
  }, [hoveredNode, spotlightIds, isUserHovering, nodes]);

  const activeTooltipPos = hoveredId ? tooltipPos : spotlightScreenPos;

  const sizeClass = fillContainer
    ? "relative w-full h-full"
    : "relative w-[280px] h-[280px] md:w-[400px] md:h-[400px]";

  return (
    <div className={sizeClass}>
      <Canvas
        camera={{ position: [0, 0, 8], fov: 50 }}
        style={{ background: "transparent", cursor: hoveredId ? "pointer" : "grab" }}
        dpr={[1, 2]}
      >
        <Scene
          placements={placements}
          hoveredId={hoveredId}
          spotlightIds={spotlightIds}
          onHover={handleHover}
          onClick={handleClick}
          onSpotlightScreenPos={handleSpotlightScreenPos}
          isUserHovering={isUserHovering}
        />
      </Canvas>

      <RepoTooltip
        node={displayedTooltipNode}
        position={activeTooltipPos}
        visible={!!displayedTooltipNode && !!activeTooltipPos}
      />
    </div>
  );
}
