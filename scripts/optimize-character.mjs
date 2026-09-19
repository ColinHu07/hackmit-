#!/usr/bin/env node
// Offline asset build; the exported GLB needs no mesh compression decoder.
// Usage: node scripts/optimize-character.mjs /path/to/GLB0_colored.glb [output.glb]
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, renameSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const input = process.argv[2] && resolve(process.argv[2]);
const output = resolve(process.argv[3] ?? join(root, "glasses-web/public/models/nova.glb"));
if (!input || input === output) {
  throw new Error("Supply an input GLB different from the output path.");
}

function inspect(path) {
  const bytes = readFileSync(path);
  if (bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2) {
    throw new Error("Expected a glTF 2.0 binary.");
  }
  const jsonLength = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8"));
  const binaryStart = 28 + jsonLength;
  const primitives = gltf.meshes.flatMap((mesh) => mesh.primitives);
  if (primitives.length !== 1 || (primitives[0].mode ?? 4) !== 4) {
    throw new Error("This pipeline expects a single triangle primitive.");
  }
  const primitive = primitives[0];
  const positions = gltf.accessors[primitive.attributes.POSITION];
  const colors = gltf.accessors[primitive.attributes.COLOR_0];
  if (!colors || colors.type !== "VEC4" || colors.componentType !== 5126 || colors.sparse) {
    throw new Error("Expected the supplied model's float RGBA vertex colors.");
  }
  if (positions.count !== colors.count) throw new Error("Vertex color count mismatch.");
  const view = gltf.bufferViews[colors.bufferView];
  const start = binaryStart + (view.byteOffset ?? 0) + (colors.byteOffset ?? 0);
  const stride = view.byteStride ?? 16;
  const minimum = [Infinity, Infinity, Infinity, Infinity];
  const maximum = [-Infinity, -Infinity, -Infinity, -Infinity];
  const distinctColors = new Set();
  for (let vertex = 0; vertex < colors.count; vertex++) {
    const rgba = [];
    for (let channel = 0; channel < 4; channel++) {
      const value = bytes.readFloatLE(start + vertex * stride + channel * 4);
      if (!Number.isFinite(value) || value < 0 || value > 1) {
        throw new Error("Invalid vertex color.");
      }
      rgba.push(value);
      minimum[channel] = Math.min(minimum[channel], value);
      maximum[channel] = Math.max(maximum[channel], value);
    }
    distinctColors.add(rgba.join(","));
  }
  const pbr = gltf.materials[primitive.material].pbrMetallicRoughness;
  return {
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    triangles: gltf.accessors[primitive.indices].count / 3,
    vertices: positions.count,
    bounds: { min: positions.min, max: positions.max },
    color: { min: minimum, max: maximum, distinct: distinctColors.size },
    material: {
      baseColorFactor: pbr.baseColorFactor ?? [1, 1, 1, 1],
      metallicFactor: pbr.metallicFactor ?? 1,
      roughnessFactor: pbr.roughnessFactor ?? 1,
    },
    requiredExtensions: gltf.extensionsRequired ?? [],
    animations: gltf.animations?.length ?? 0,
    skins: gltf.skins?.length ?? 0,
  };
}

const before = inspect(input);
const temporary = mkdtempSync(join(dirname(output), ".nova-build-"));
try {
  const candidate = join(temporary, "nova.glb");
  const result = spawnSync("npx", [
    "--yes", "--package=@gltf-transform/cli@4.5.0", "--package=meshoptimizer@1.2.0",
    "node", join(root, "scripts/simplify-colored-character.mjs"), input, candidate,
  ], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Simplification exited with ${result.status}.`);
  const after = inspect(candidate);
  if (after.triangles > 70_000 || after.triangles < 60_000 || after.bytes > 2_000_000) {
    throw new Error("Output exceeded the intended geometry/size budget.");
  }
  if (JSON.stringify(before.material) !== JSON.stringify(after.material)
      || after.requiredExtensions.length || after.animations !== before.animations
      || after.skins !== before.skins || after.color.distinct < 25_000
      || after.color.min[3] !== 1 || after.color.max[3] !== 1) {
    throw new Error("Output failed material, color, or decoder compatibility checks.");
  }
  for (let axis = 0; axis < 3; axis++) {
    const extent = before.bounds.max[axis] - before.bounds.min[axis];
    for (const end of ["min", "max"]) {
      if (Math.abs(before.bounds[end][axis] - after.bounds[end][axis]) > extent * 0.002) {
        throw new Error("Simplification changed the character bounds too much.");
      }
      if (Math.abs(before.color[end][axis] - after.color[end][axis]) > 0.001) {
        throw new Error("Simplification changed the color range too much.");
      }
    }
  }
  const sourceHash = createHash("sha256").update(readFileSync(input)).digest("hex");
  if (sourceHash !== before.sha256) throw new Error("Source changed during the build.");
  renameSync(candidate, output);
  console.log(JSON.stringify({ input, output, before, after }, null, 2));
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
