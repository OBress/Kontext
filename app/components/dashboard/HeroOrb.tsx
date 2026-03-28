"use client";

import { useRef, useMemo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";

function Particles({ count = 1200 }: { count?: number }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  const particles = useMemo(() => {
    const arr = [];
    for (let i = 0; i < count; i++) {
      // Distribute on sphere surface
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = 2.2 + (Math.random() - 0.5) * 0.6;
      arr.push({
        x: r * Math.sin(phi) * Math.cos(theta),
        y: r * Math.sin(phi) * Math.sin(theta),
        z: r * Math.cos(phi),
        scale: 0.01 + Math.random() * 0.025,
        speed: 0.1 + Math.random() * 0.3,
        isCyan: Math.random() > 0.75,
      });
    }
    return arr;
  }, [count]);

  useFrame((state) => {
    if (!meshRef.current) return;
    const t = state.clock.getElapsedTime() * 0.15;

    particles.forEach((p, i) => {
      // Slow orbit rotation
      const angle = t * p.speed;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      dummy.position.set(
        p.x * cos - p.z * sin,
        p.y + Math.sin(t * p.speed * 2) * 0.05,
        p.x * sin + p.z * cos
      );
      dummy.scale.setScalar(p.scale);
      dummy.updateMatrix();
      meshRef.current!.setMatrixAt(i, dummy.matrix);
    });
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  // Create two colors for variety
  const cyanColor = new THREE.Color("#00E5FF");
  const purpleColor = new THREE.Color("#7C4DFF");
  const colors = useMemo(() => {
    const arr = new Float32Array(count * 3);
    particles.forEach((p, i) => {
      const color = p.isCyan ? cyanColor : purpleColor;
      arr[i * 3] = color.r;
      arr[i * 3 + 1] = color.g;
      arr[i * 3 + 2] = color.b;
    });
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count]);

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]}>
      <sphereGeometry args={[1, 6, 6]}>
        <instancedBufferAttribute
          attach="attributes-color"
          args={[colors, 3]}
        />
      </sphereGeometry>
      <meshBasicMaterial
        vertexColors
        transparent
        opacity={0.8}
      />
    </instancedMesh>
  );
}

export function HeroOrb() {
  return (
    <div className="w-[280px] h-[280px] md:w-[360px] md:h-[360px]">
      <Canvas
        camera={{ position: [0, 0, 6], fov: 45 }}
        style={{ background: "transparent" }}
        dpr={[1, 2]}
      >
        <ambientLight intensity={0.5} />
        <Particles count={1200} />
      </Canvas>
    </div>
  );
}
