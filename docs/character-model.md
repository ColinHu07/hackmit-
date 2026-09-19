# Supplied character asset

- Input: user-supplied `GLB0_colored.glb`, 51,288,108 bytes, 986,288 vertices, 1,972,568 triangles. This replaces the earlier uncolored `GLB0.glb` runtime asset.
- Original SHA-256: `3ef63c5d4ab3703c872c7cf364144aed885916bacdcd62448c566c09a13dc06e`.
- Runtime: `glasses-web/public/models/nova.glb`, 1,381,248 bytes, 34,504 vertices, 69,000 triangles.
- Runtime SHA-256: `4b0cba5f2e83f7b5a1becf7241350e2432c99ec703acdb364c348703d787a10b`.
- Tools: glTF Transform CLI 4.5.0 and meshoptimizer 1.2.0, both pinned by the build script.
- Rebuild from the repository root: `node scripts/optimize-character.mjs /path/to/GLB0_colored.glb` (Node.js and npm required; first use downloads the pinned build tools).
- Exact pipeline: the wrapper invokes `npx --yes --package=@gltf-transform/cli@4.5.0 --package=meshoptimizer@1.2.0 node scripts/simplify-colored-character.mjs INPUT TEMP_OUTPUT`. The helper reads/writes with glTF Transform's `NodeIO` and calls meshoptimizer's `simplifyWithAttributes` with position stride 3, RGBA stride 4, attribute weights `[1, 1, 1, 0]`, target 207,000 indices (69,000 triangles), maximum error 0.005, and `RegularizeLight`. It compacts surviving vertices, uses 16-bit indices, and prunes the unused index accessor. The wrapper validates the temporary result before replacing the destination.
- Measured appearance error returned by meshoptimizer: 0.0008278257. This combines geometric and weighted color error; it is not a screen-pixel or geometric-distance bound.
- Reference: [meshoptimizer's simplifier documentation](https://github.com/zeux/meshoptimizer/tree/master/js#simplifier).

The original supplied file was not modified. Only the optimized asset is checked in. The model has one mesh with one primitive, one material, no textures, no skin, no morph targets, and no animation clips. Color is stored in float RGBA `COLOR_0` vertex attributes, not image textures. The material keeps a white base-color multiplier, metallic factor 0, and roughness 0.88 so the supplied palette remains visible. Its vertex data also contains positions and triangle indices; normals are computed after loading. No external decoder or CDN is needed at runtime. No author or license was supplied with the file; this record does not invent attribution or relicensing.

The build verifies the material, opaque vertex alpha, vertex color count/range/diversity, 60,000–70,000 triangle budget, file size below 2 MB, bounds, absence of decoder extensions, and unchanged source SHA before replacing the runtime asset. Measured color retention:

| Measurement | Source | Optimized runtime |
| --- | --- | --- |
| Distinct RGBA values | 710,298 | 34,002 |
| Minimum RGB | (0.0019004, 0.0013683, 0.0008362) | (0.0019015, 0.0013691, 0.0008367) |
| Maximum RGB | (1, 1, 0.9675509) | (1, 1, 0.9675509) |
| Alpha range | 1–1 | 1–1 |
| Bounds minimum | (-0.6737865, -0.4975595, -0.7945887) | (-0.6737865, -0.4975513, -0.7945585) |
| Bounds maximum | (0.6204690, 0.8546355, 0.6001794) | (0.6203708, 0.8545424, 0.6001776) |

The previous 23,670-triangle build simplified geometry without considering vertex color. That left only 15 and 14 dark vertices in the two pupils; small painted details looked chipped even though the mesh had no open boundary edges. Increasing geometry alone helped, but preserving RGB during simplification is what restored coherent pupils, catchlights and teeth. The current build retains 70 and 67 dark pupil vertices and 38 catchlight vertices across the eyes, versus two catchlight vertices in the previous build. Asset regression tests verify both eyes retain dark pupils, white surrounds, and bright catchlights. They also verify the mesh remains opaque and closed.

Simplification remains lossy: retained vertices keep their exact source positions and colors, with interpolated colors across larger triangles. The optimized GLB is approximately 97.3% smaller than the source, with bounding-box extrema differing by less than 0.0001 source units. It retains the source's two connected components; the result has no boundary edges, nonmanifold edges, or degenerate triangles. The source itself contained 30 nonmanifold edges. No new facial parts, recoloring, or surface smoothing were added.

Pet/feed/play use procedural movement and generated reaction effects, separate from the input system that triggers them. Runtime animation rotates the face as a rigid region with blending at the neck, and alternates planted stance and lifted swing steps while the source GLB remains unchanged. A spring-damped lean follows touch, and procedural reactions, idle, and landings preserve body scale without squashing or stretching. Running stays grounded by default; explicit jumps use gravity and conserved horizontal momentum, with a planted preparatory bend, airborne foot tuck, and a soft landing/recovery pose. Runtime morph bases preserve torso and face proportions through the bend; whole-body scale stays unchanged. Movement also uses acceleration, braking, and a simulated floor; a posed-vertex contact solver keeps the feet above that floor. There is no detected real-world room geometry. This static-mesh animation is an approximation; detailed eyelid, mouth, ear, and articulated limb movement still needs artist-authored rigging or morph targets. See [character animation workflow](character-animation.md) for the Blender authoring and web playback plan.
