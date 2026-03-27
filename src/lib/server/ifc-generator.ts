import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import type {
  ExtractedFloorData,
  ExtractedWall,
  PipelineArtifact,
  PipelineOutput,
} from "@/types/pipeline";

const IFC_FILE_NAME = "model.ifc";
const DEFAULT_FLOOR_HEIGHT_METERS = 2.8;

class IfcEntityBuilder {
  private entityLines: string[] = [];
  private nextId = 1;

  add(entityExpression: string): number {
    const id = this.nextId;
    this.nextId += 1;
    this.entityLines.push(`#${id}=${entityExpression};`);
    return id;
  }

  ref(id: number): string {
    return `#${id}`;
  }

  refTuple(ids: number[]): string {
    const refs = ids.map((id) => this.ref(id)).join(",");
    return `(${refs})`;
  }

  buildDataSection(): string {
    return this.entityLines.join("\n");
  }
}

function toIfcGuid(): string {
  return randomUUID().replace(/-/g, "").slice(0, 22).toUpperCase();
}

function escapeIfcString(value: string): string {
  return value.replace(/'/g, "''");
}

function toIfcLiteral(value: string): string {
  return `'${escapeIfcString(value)}'`;
}

function formatNumber(value: number, decimals = 4): string {
  if (!Number.isFinite(value)) return "0.";
  const fixed = value.toFixed(decimals);
  return fixed.includes(".") ? fixed : `${fixed}.`;
}

function toMeters(valueInMillimeters: number): number {
  return valueInMillimeters / 1000;
}

function toWorldWallGeometry(wall: ExtractedWall): {
  startX: number;
  startY: number;
  length: number;
  thickness: number;
  dirX: number;
  dirY: number;
} | null {
  const startX = toMeters(wall.startX);
  const startY = -toMeters(wall.startY);
  const endX = toMeters(wall.endX);
  const endY = -toMeters(wall.endY);

  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const length = Math.hypot(deltaX, deltaY);
  if (length < 0.01) {
    return null;
  }

  const thickness = Math.max(toMeters(wall.thickness), 0.05);

  return {
    startX,
    startY,
    length,
    thickness,
    dirX: deltaX / length,
    dirY: deltaY / length,
  };
}

function buildMinimalIfc(jobId: string, floors: ExtractedFloorData[], floorHeightMeters: number): string {
  const builder = new IfcEntityBuilder();
  const unixTimestamp = Math.floor(Date.now() / 1000);
  const nowIso = new Date().toISOString();

  const organization = builder.add(`IFCORGANIZATION($,${toIfcLiteral("AmpliFy")},$,$,$)`);
  const person = builder.add(`IFCPERSON($,$,${toIfcLiteral("AmpliFy User")},$,$,$,$,$)`);
  const personAndOrg = builder.add(`IFCPERSONANDORGANIZATION(${builder.ref(person)},${builder.ref(organization)},$)`);
  const application = builder.add(
    `IFCAPPLICATION(${builder.ref(organization)},${toIfcLiteral("0.1")},${toIfcLiteral("AmpliFy Phase 8A")},${toIfcLiteral("AMPLIFY")})`
  );
  const ownerHistory = builder.add(
    `IFCOWNERHISTORY(${builder.ref(personAndOrg)},${builder.ref(application)},$,.ADDED.,$,$,$,${unixTimestamp})`
  );

  const unitLength = builder.add("IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)");
  const unitArea = builder.add("IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)");
  const unitVolume = builder.add("IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)");
  const units = builder.add(
    `IFCUNITASSIGNMENT(${builder.refTuple([unitLength, unitArea, unitVolume])})`
  );

  const worldOrigin = builder.add("IFCCARTESIANPOINT((0.,0.,0.))");
  const axisZ = builder.add("IFCDIRECTION((0.,0.,1.))");
  const axisX = builder.add("IFCDIRECTION((1.,0.,0.))");
  const worldAxis = builder.add(`IFCAXIS2PLACEMENT3D(${builder.ref(worldOrigin)},${builder.ref(axisZ)},${builder.ref(axisX)})`);
  const modelContext = builder.add(
    `IFCGEOMETRICREPRESENTATIONCONTEXT($,${toIfcLiteral("Model")},3,1.E-05,${builder.ref(worldAxis)},$)`
  );

  const projectPlacement = builder.add(`IFCLOCALPLACEMENT($,${builder.ref(worldAxis)})`);
  const project = builder.add(
    `IFCPROJECT(${toIfcLiteral(toIfcGuid())},${builder.ref(ownerHistory)},${toIfcLiteral("AmpliFy Project")},${toIfcLiteral(`Phase 8A minimal IFC for ${jobId}`)},$,$,$,${builder.refTuple([modelContext])},${builder.ref(units)})`
  );

  const sitePoint = builder.add("IFCCARTESIANPOINT((0.,0.,0.))");
  const siteAxis = builder.add(`IFCAXIS2PLACEMENT3D(${builder.ref(sitePoint)},${builder.ref(axisZ)},${builder.ref(axisX)})`);
  const sitePlacement = builder.add(`IFCLOCALPLACEMENT(${builder.ref(projectPlacement)},${builder.ref(siteAxis)})`);
  const site = builder.add(
    `IFCSITE(${toIfcLiteral(toIfcGuid())},${builder.ref(ownerHistory)},${toIfcLiteral("Default Site")},$,$,${builder.ref(sitePlacement)},$,$,.ELEMENT.,$,$,$,$,$)`
  );

  const buildingPoint = builder.add("IFCCARTESIANPOINT((0.,0.,0.))");
  const buildingAxis = builder.add(`IFCAXIS2PLACEMENT3D(${builder.ref(buildingPoint)},${builder.ref(axisZ)},${builder.ref(axisX)})`);
  const buildingPlacement = builder.add(`IFCLOCALPLACEMENT(${builder.ref(sitePlacement)},${builder.ref(buildingAxis)})`);
  const building = builder.add(
    `IFCBUILDING(${toIfcLiteral(toIfcGuid())},${builder.ref(ownerHistory)},${toIfcLiteral("Default Building")},$,$,${builder.ref(buildingPlacement)},$,$,.ELEMENT.,$,$,$)`
  );

  const storeyInfos = floors.map((floor, index) => {
    const elevation = index * floorHeightMeters;
    const storeyPoint = builder.add(
      `IFCCARTESIANPOINT((0.,0.,${formatNumber(elevation)}))`
    );
    const storeyAxis = builder.add(
      `IFCAXIS2PLACEMENT3D(${builder.ref(storeyPoint)},${builder.ref(axisZ)},${builder.ref(axisX)})`
    );
    const storeyPlacement = builder.add(
      `IFCLOCALPLACEMENT(${builder.ref(buildingPlacement)},${builder.ref(storeyAxis)})`
    );
    const label = floor.floorLabel || `${index + 1}F`;
    const storey = builder.add(
      `IFCBUILDINGSTOREY(${toIfcLiteral(toIfcGuid())},${builder.ref(ownerHistory)},${toIfcLiteral(label)},$,$,${builder.ref(storeyPlacement)},$,$,.ELEMENT.,${formatNumber(elevation)})`
    );

    return {
      floor,
      storey,
      storeyPlacement,
    };
  });

  builder.add(
    `IFCRELAGGREGATES(${toIfcLiteral(toIfcGuid())},${builder.ref(ownerHistory)},$,$,${builder.ref(project)},${builder.refTuple([site])})`
  );
  builder.add(
    `IFCRELAGGREGATES(${toIfcLiteral(toIfcGuid())},${builder.ref(ownerHistory)},$,$,${builder.ref(site)},${builder.refTuple([building])})`
  );

  if (storeyInfos.length > 0) {
    builder.add(
      `IFCRELAGGREGATES(${toIfcLiteral(toIfcGuid())},${builder.ref(ownerHistory)},$,$,${builder.ref(building)},${builder.refTuple(storeyInfos.map((info) => info.storey))})`
    );
  }

  for (const { floor, storey, storeyPlacement } of storeyInfos) {
    const wallIds: number[] = [];

    for (const wall of floor.walls) {
      const geometry = toWorldWallGeometry(wall);
      if (!geometry) continue;

      const wallPoint = builder.add(
        `IFCCARTESIANPOINT((${formatNumber(geometry.startX)},${formatNumber(geometry.startY)},0.))`
      );
      const wallDirection = builder.add(
        `IFCDIRECTION((${formatNumber(geometry.dirX, 6)},${formatNumber(geometry.dirY, 6)},0.))`
      );
      const wallAxis = builder.add(
        `IFCAXIS2PLACEMENT3D(${builder.ref(wallPoint)},${builder.ref(axisZ)},${builder.ref(wallDirection)})`
      );
      const wallPlacement = builder.add(
        `IFCLOCALPLACEMENT(${builder.ref(storeyPlacement)},${builder.ref(wallAxis)})`
      );

      const profilePoint = builder.add(
        `IFCCARTESIANPOINT((${formatNumber(geometry.length / 2)},0.))`
      );
      const profileAxis = builder.add(`IFCAXIS2PLACEMENT2D(${builder.ref(profilePoint)},$)`);
      const profile = builder.add(
        `IFCRECTANGLEPROFILEDEF(.AREA.,${toIfcLiteral("WallProfile")},${builder.ref(profileAxis)},${formatNumber(geometry.length)},${formatNumber(geometry.thickness)})`
      );
      const solid = builder.add(
        `IFCEXTRUDEDAREASOLID(${builder.ref(profile)},$,${builder.ref(axisZ)},${formatNumber(floorHeightMeters)})`
      );
      const shapeRepresentation = builder.add(
        `IFCSHAPEREPRESENTATION(${builder.ref(modelContext)},${toIfcLiteral("Body")},${toIfcLiteral("SweptSolid")},${builder.refTuple([solid])})`
      );
      const productShape = builder.add(
        `IFCPRODUCTDEFINITIONSHAPE($,$,${builder.refTuple([shapeRepresentation])})`
      );

      const wallName = wall.id || "Wall";
      const wallEntity = builder.add(
        `IFCWALLSTANDARDCASE(${toIfcLiteral(toIfcGuid())},${builder.ref(ownerHistory)},${toIfcLiteral(wallName)},$,$,${builder.ref(wallPlacement)},${builder.ref(productShape)},$)`
      );

      wallIds.push(wallEntity);
    }

    if (wallIds.length > 0) {
      builder.add(
        `IFCRELCONTAINEDINSPATIALSTRUCTURE(${toIfcLiteral(toIfcGuid())},${builder.ref(ownerHistory)},$,$,${builder.refTuple(wallIds)},${builder.ref(storey)})`
      );
    }
  }

  return [
    "ISO-10303-21;",
    "HEADER;",
    "FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');",
    `FILE_NAME(${toIfcLiteral(IFC_FILE_NAME)},${toIfcLiteral(nowIso)},(${toIfcLiteral("AmpliFy")}),(${toIfcLiteral("AmpliFy")}),${toIfcLiteral("AmpliFy")},${toIfcLiteral("Phase8A")},$);`,
    "FILE_SCHEMA(('IFC2X3'));",
    "ENDSEC;",
    "DATA;",
    builder.buildDataSection(),
    "ENDSEC;",
    "END-ISO-10303-21;",
    "",
  ].join("\n");
}

export async function generateIfcArtifact(
  jobId: string,
  output: PipelineOutput,
  floorHeightMeters: number
): Promise<PipelineArtifact> {
  const artifactsDir = path.join(process.cwd(), "data", "artifacts", jobId);
  await fs.mkdir(artifactsDir, { recursive: true });

  const effectiveFloorHeight = floorHeightMeters > 0
    ? floorHeightMeters
    : DEFAULT_FLOOR_HEIGHT_METERS;

  const ifcContent = buildMinimalIfc(jobId, output.floors, effectiveFloorHeight);
  const filePath = path.join(artifactsDir, IFC_FILE_NAME);
  await fs.writeFile(filePath, ifcContent, "utf-8");

  const stat = await fs.stat(filePath);
  return {
    format: "ifc",
    filePath,
    size: stat.size,
  };
}

export async function attachMinimalIfcArtifact(
  jobId: string,
  output: PipelineOutput,
  floorHeightMeters: number
): Promise<PipelineOutput> {
  const ifcArtifact = await generateIfcArtifact(jobId, output, floorHeightMeters);
  const artifactsWithoutIfc = output.artifacts.filter((artifact) => artifact.format !== "ifc");

  return {
    ...output,
    artifacts: [...artifactsWithoutIfc, ifcArtifact],
  };
}
