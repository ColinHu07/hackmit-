#!/usr/bin/env node
// Invoked by optimize-character.mjs inside npm's pinned build-tool environment.
import { existsSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { delimiter, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { repairCharacterEye } from "./repair-character-eye.mjs";

const input = process.argv[2] && resolve(process.argv[2]);
const output = process.argv[3] && resolve(process.argv[3]);
if (!input || !output || input === output) throw new Error("Supply separate input and output GLB paths.");

// npm exec exposes its temporary .bin directory through PATH. Resolve the SDK
// next to that CLI, without adding offline asset tools to the web application's dependencies.
const executable = (process.env.PATH ?? "").split(delimiter)
  .map(directory => join(directory, process.platform === "win32" ? "gltf-transform.cmd" : "gltf-transform"))
  .find(path => existsSync(path));
if (!executable) throw new Error("Run this helper through scripts/optimize-character.mjs.");
const requireTool = createRequire(realpathSync(executable));
// Use their ESM builds: the CJS builds require ESM-only dependencies on Node 22.
const { NodeIO } = await import(pathToFileURL(join(dirname(requireTool.resolve("@gltf-transform/core")), "index.js")).href);
const { compactPrimitive, prune } = await import(pathToFileURL(join(dirname(requireTool.resolve("@gltf-transform/functions")), "index.js")).href);
const { MeshoptSimplifier } = await import(pathToFileURL(requireTool.resolve("meshoptimizer")).href);

await MeshoptSimplifier.ready;
const io = new NodeIO();
const document = await io.read(input);
const primitives = document.getRoot().listMeshes().flatMap(mesh => mesh.listPrimitives());
if (primitives.length !== 1) throw new Error("Expected the supplied single-primitive character.");
const primitive = primitives[0];
const positions = primitive.getAttribute("POSITION");
const colors = primitive.getAttribute("COLOR_0");
const indices = primitive.getIndices();
if (!indices || primitive.getMode() !== 4 || !positions || !colors
    || positions.getType() !== "VEC3" || colors.getType() !== "VEC4"
    || positions.getCount() !== colors.getCount()
    || !(positions.getArray() instanceof Float32Array) || !(colors.getArray() instanceof Float32Array)) {
  throw new Error("Expected indexed triangles with float positions and RGBA vertex colors.");
}

// Geometry-only decimation deletes vertices on flat surfaces even when they
// carry small painted features. Include RGB error so pupils, teeth and muzzle
// edges receive detail where it matters. Alpha is opaque and needs no weight.
const [simplified, error] = MeshoptSimplifier.simplifyWithAttributes(
  new Uint32Array(indices.getArray()), positions.getArray(), 3,
  colors.getArray(), 4, [1, 1, 1, 0], null,
  69_000 * 3, 0.005, ["RegularizeLight"],
);
primitive.setIndices(indices.clone().setArray(simplified));
compactPrimitive(primitive);
if (primitive.getAttribute("POSITION").getCount() < 65_535) {
  primitive.getIndices().setArray(new Uint16Array(primitive.getIndices().getArray()));
}
const compactColors = primitive.getAttribute("COLOR_0");
compactColors.setArray(repairCharacterEye(primitive.getAttribute("POSITION").getArray(), compactColors.getArray()));
await document.transform(prune());
await io.write(output, document);
console.log(JSON.stringify({ triangles: simplified.length / 3, appearanceError: error }));
