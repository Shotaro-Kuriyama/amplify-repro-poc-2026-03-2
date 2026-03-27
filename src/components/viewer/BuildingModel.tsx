"use client";

import type { PipelineViewerFloor, PipelineViewerModel } from "@/types";

interface BuildingModelProps {
  floors?: number;
  floorHeight?: number;
  planOpacity?: number;
  scale?: number;
  pipelineModel?: PipelineViewerModel | null;
}

const SLAB_THICKNESS = 0.08;

function toWorldMeters(paperMillimeters: number, scale: number): number {
  return (paperMillimeters * Math.max(scale, 1)) / 1000;
}

function toCenteredX(
  xInPaperMillimeters: number,
  pageWidthInPaperMillimeters: number,
  scale: number
): number {
  return toWorldMeters(xInPaperMillimeters, scale) - toWorldMeters(pageWidthInPaperMillimeters, scale) / 2;
}

function toCenteredZ(
  yInPaperMillimeters: number,
  pageHeightInPaperMillimeters: number,
  scale: number
): number {
  return -(toWorldMeters(yInPaperMillimeters, scale) - toWorldMeters(pageHeightInPaperMillimeters, scale) / 2);
}

function renderPipelineFloor(
  floor: PipelineViewerFloor,
  floorIndex: number,
  floorHeight: number,
  planOpacity: number,
  scale: number
) {
  const wallColor = "#cbd5e1";
  const floorColor = "#f8fafc";
  const windowColor = "#38bdf8";
  const doorColor = "#f59e0b";
  const unknownColor = "#a78bfa";

  const pageWidth = Math.max(toWorldMeters(floor.pageWidth, scale), 0.5);
  const pageHeight = Math.max(toWorldMeters(floor.pageHeight, scale), 0.5);
  const wallHeight = Math.max(floorHeight - SLAB_THICKNESS, 0.2);
  const baseY = floorIndex * floorHeight;

  return (
    <group key={`floor-${floorIndex}`} position={[0, baseY, 0]}>
      <mesh position={[0, SLAB_THICKNESS / 2, 0]} receiveShadow>
        <boxGeometry args={[pageWidth, SLAB_THICKNESS, pageHeight]} />
        <meshStandardMaterial color={floorColor} />
      </mesh>

      {floor.walls.map((wall, wallIndex) => {
        const startX = toCenteredX(wall.startX, floor.pageWidth, scale);
        const startZ = toCenteredZ(wall.startY, floor.pageHeight, scale);
        const endX = toCenteredX(wall.endX, floor.pageWidth, scale);
        const endZ = toCenteredZ(wall.endY, floor.pageHeight, scale);

        const deltaX = endX - startX;
        const deltaZ = endZ - startZ;
        const length = Math.hypot(deltaX, deltaZ);
        if (length < 0.03) return null;

        const thickness = Math.max(toWorldMeters(wall.thickness, scale), 0.05);
        const centerX = (startX + endX) / 2;
        const centerZ = (startZ + endZ) / 2;
        const rotationY = Math.atan2(deltaZ, deltaX);

        return (
          <mesh
            key={`wall-${floorIndex}-${wall.id || wallIndex}`}
            position={[centerX, SLAB_THICKNESS + wallHeight / 2, centerZ]}
            rotation={[0, -rotationY, 0]}
            castShadow
          >
            <boxGeometry args={[length, wallHeight, thickness]} />
            <meshStandardMaterial color={wallColor} transparent opacity={planOpacity} />
          </mesh>
        );
      })}

      {floor.openings.map((opening, openingIndex) => {
        const centerX = toCenteredX(opening.centerX, floor.pageWidth, scale);
        const centerZ = toCenteredZ(opening.centerY, floor.pageHeight, scale);
        const width = Math.max(toWorldMeters(opening.width, scale), 0.2);
        const height = Math.min(Math.max(toWorldMeters(opening.height, scale), 0.8), wallHeight - 0.1);
        const depth = 0.06;

        const color = opening.type === "window"
          ? windowColor
          : opening.type === "door"
            ? doorColor
            : unknownColor;

        const y = opening.type === "window"
          ? SLAB_THICKNESS + wallHeight * 0.58
          : SLAB_THICKNESS + height / 2;

        return (
          <mesh
            key={`opening-${floorIndex}-${opening.id || openingIndex}`}
            position={[centerX, y, centerZ]}
            castShadow
          >
            <boxGeometry args={[width, height, depth]} />
            <meshStandardMaterial color={color} transparent opacity={0.72} />
          </mesh>
        );
      })}
    </group>
  );
}

function FallbackModel({
  floors,
  floorHeight,
  planOpacity,
}: {
  floors: number;
  floorHeight: number;
  planOpacity: number;
}) {
  const wallColor = "#e2e8f0";
  const floorColor = "#f1f5f9";

  return (
    <group>
      {Array.from({ length: floors }).map((_, floorIndex) => {
        const baseY = floorIndex * floorHeight;
        const wallHeight = Math.max(floorHeight - SLAB_THICKNESS, 0.2);
        const wallThickness = 0.15;

        return (
          <group key={`fallback-floor-${floorIndex}`} position={[0, baseY, 0]}>
            <mesh position={[0, SLAB_THICKNESS / 2, 0]} receiveShadow>
              <boxGeometry args={[10, SLAB_THICKNESS, 8]} />
              <meshStandardMaterial color={floorColor} />
            </mesh>

            <mesh position={[0, SLAB_THICKNESS + wallHeight / 2, 4 - wallThickness / 2]} castShadow>
              <boxGeometry args={[10, wallHeight, wallThickness]} />
              <meshStandardMaterial color={wallColor} transparent opacity={planOpacity} />
            </mesh>
            <mesh position={[0, SLAB_THICKNESS + wallHeight / 2, -4 + wallThickness / 2]} castShadow>
              <boxGeometry args={[10, wallHeight, wallThickness]} />
              <meshStandardMaterial color={wallColor} transparent opacity={planOpacity} />
            </mesh>
            <mesh position={[-5 + wallThickness / 2, SLAB_THICKNESS + wallHeight / 2, 0]} castShadow>
              <boxGeometry args={[wallThickness, wallHeight, 8]} />
              <meshStandardMaterial color={wallColor} transparent opacity={planOpacity} />
            </mesh>
            <mesh position={[5 - wallThickness / 2, SLAB_THICKNESS + wallHeight / 2, 0]} castShadow>
              <boxGeometry args={[wallThickness, wallHeight, 8]} />
              <meshStandardMaterial color={wallColor} transparent opacity={planOpacity} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

export function BuildingModel({
  floors = 1,
  floorHeight = 2.8,
  planOpacity = 0.7,
  scale = 50,
  pipelineModel,
}: BuildingModelProps) {
  const hasPipelineFloors = !!pipelineModel && pipelineModel.floors.length > 0;

  if (!hasPipelineFloors) {
    return (
      <FallbackModel
        floors={Math.max(floors, 1)}
        floorHeight={floorHeight}
        planOpacity={planOpacity}
      />
    );
  }

  return (
    <group>
      {pipelineModel.floors.map((floor, floorIndex) =>
        renderPipelineFloor(floor, floorIndex, floorHeight, planOpacity, scale)
      )}
    </group>
  );
}
