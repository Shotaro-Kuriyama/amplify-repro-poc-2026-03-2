"use client";

import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

interface BuildingModelProps {
  floors?: number;
  floorHeight?: number;
  planOpacity?: number;
}

/**
 * Procedural mock building model.
 * floorHeight and planOpacity are now driven by SettingsPanel.
 */
export function BuildingModel({
  floors = 1,
  floorHeight = 2.8,
  planOpacity = 0.7,
}: BuildingModelProps) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame((_, delta) => {
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * 0.08;
    }
  });

  const wallThickness = 0.15;
  const wallColor = "#e2e8f0";
  const wallEdgeColor = "#94a3b8";
  const floorColor = "#f1f5f9";
  const windowColor = "#7dd3fc";
  const doorColor = "#fbbf24";

  // Memoize edge geometries to avoid re-creating on every render
  const edgeGeometries = useMemo(() => {
    const wt = wallThickness;
    return [
      { pos: [0, floorHeight / 2, 4 - wt / 2] as const, geo: new THREE.BoxGeometry(10, floorHeight, wt) },
      { pos: [0, floorHeight / 2, -4 + wt / 2] as const, geo: new THREE.BoxGeometry(10, floorHeight, wt) },
      { pos: [-5 + wt / 2, floorHeight / 2, 0] as const, geo: new THREE.BoxGeometry(wt, floorHeight, 8) },
      { pos: [5 - wt / 2, floorHeight / 2, 0] as const, geo: new THREE.BoxGeometry(wt, floorHeight, 8) },
    ];
  }, [floorHeight]);

  return (
    <group ref={groupRef} position={[0, -(floors * floorHeight) / 2, 0]}>
      {Array.from({ length: floors }).map((_, floorIndex) => {
        const y = floorIndex * floorHeight;
        return (
          <group key={floorIndex} position={[0, y, 0]}>
            {/* Floor slab */}
            <mesh position={[0, 0, 0]} receiveShadow>
              <boxGeometry args={[10, 0.2, 8]} />
              <meshStandardMaterial color={floorColor} />
            </mesh>

            {/* Outer walls */}
            <mesh position={[0, floorHeight / 2, 4 - wallThickness / 2]} castShadow>
              <boxGeometry args={[10, floorHeight, wallThickness]} />
              <meshStandardMaterial color={wallColor} transparent opacity={planOpacity} />
            </mesh>
            <mesh position={[0, floorHeight / 2, -4 + wallThickness / 2]} castShadow>
              <boxGeometry args={[10, floorHeight, wallThickness]} />
              <meshStandardMaterial color={wallColor} transparent opacity={planOpacity} />
            </mesh>
            <mesh position={[-5 + wallThickness / 2, floorHeight / 2, 0]} castShadow>
              <boxGeometry args={[wallThickness, floorHeight, 8]} />
              <meshStandardMaterial color={wallColor} transparent opacity={planOpacity} />
            </mesh>
            <mesh position={[5 - wallThickness / 2, floorHeight / 2, 0]} castShadow>
              <boxGeometry args={[wallThickness, floorHeight, 8]} />
              <meshStandardMaterial color={wallColor} transparent opacity={planOpacity} />
            </mesh>

            {/* Interior walls */}
            <mesh position={[0, floorHeight / 2, -0.5]} castShadow>
              <boxGeometry args={[6, floorHeight, wallThickness]} />
              <meshStandardMaterial color={wallColor} transparent opacity={planOpacity} />
            </mesh>
            <mesh position={[-1.5, floorHeight / 2, 2]} castShadow>
              <boxGeometry args={[wallThickness, floorHeight, 3.8]} />
              <meshStandardMaterial color={wallColor} transparent opacity={planOpacity} />
            </mesh>

            {/* Windows (front) */}
            {[-3, 0, 3].map((x) => (
              <mesh key={`wf-${x}`} position={[x, floorHeight * 0.55, 4]} castShadow>
                <boxGeometry args={[1.2, 1, 0.08]} />
                <meshStandardMaterial color={windowColor} transparent opacity={0.6} />
              </mesh>
            ))}

            {/* Windows (back) */}
            {[-2, 2].map((x) => (
              <mesh key={`wb-${x}`} position={[x, floorHeight * 0.55, -4]} castShadow>
                <boxGeometry args={[1.4, 1, 0.08]} />
                <meshStandardMaterial color={windowColor} transparent opacity={0.6} />
              </mesh>
            ))}

            {/* Door */}
            <mesh position={[1.5, 1, 4]} castShadow>
              <boxGeometry args={[0.9, 2, 0.08]} />
              <meshStandardMaterial color={doorColor} transparent opacity={0.7} />
            </mesh>

            {/* Wall edges */}
            {edgeGeometries.map((e, i) => (
              <lineSegments key={`edge-${i}`} position={[e.pos[0], e.pos[1], e.pos[2]]}>
                <edgesGeometry args={[e.geo]} />
                <lineBasicMaterial color={wallEdgeColor} transparent opacity={0.3} />
              </lineSegments>
            ))}
          </group>
        );
      })}
    </group>
  );
}
