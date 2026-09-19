# Supplied character asset

- Input: user-supplied `GLB0_colored.glb`, 51,288,108 bytes, 986,288 vertices, 1,972,568 triangles. This replaces the earlier uncolored `GLB0.glb` runtime asset.
- Original SHA-256: `3ef63c5d4ab3703c872c7cf364144aed885916bacdcd62448c566c09a13dc06e`.
- Runtime: `glasses-web/public/models/nova.glb`, 474,644 bytes, 11,839 vertices, 23,670 triangles.
- Runtime SHA-256: `5431e4ce2f8b8f6c2a28b456a2969dadea043061ec23619505b11665ddb295d6`.
- Tools: glTF Transform CLI 4.5.0 and meshoptimizer 1.2.0, both pinned by the build script.
- Rebuild from the repository root: `node scripts/optimize-character.mjs /path/to/GLB0_colored.glb` (Node.js and npm required; first use downloads the pinned build tools).
- Exact pipeline: `npx --yes --package=@gltf-transform/cli@4.5.0 --package=meshoptimizer@1.2.0 gltf-transform simplify GLB0_colored.glb nova.glb --ratio 0.012 --error 0.001`.
- Reference: [official simplify documentation](https://gltf-transform.dev/modules/functions/functions/simplify).

The original supplied file was not modified. Only the optimized asset is checked in. The model has one mesh with one primitive, one material, no textures, no skin, no morph targets, and no animation clips. Color is stored in float RGBA `COLOR_0` vertex attributes, not image textures. The material keeps a white base-color multiplier, metallic factor 0, and roughness 0.88 so the supplied palette remains visible. Its vertex data also contains positions and triangle indices; normals are computed after loading. No external decoder or CDN is needed at runtime. No author or license was supplied with the file; this record does not invent attribution or relicensing.

The build verifies the material, vertex color count/range/diversity, geometry budget, bounds, absence of decoder extensions, and unchanged source SHA before replacing the runtime asset. Measured color retention:

| Measurement | Source | Optimized runtime |
| --- | --- | --- |
| Distinct RGBA values | 710,298 | 11,783 |
| Minimum RGB | (0.0019004, 0.0013683, 0.0008362) | (0.0019062, 0.0013725, 0.0008387) |
| Maximum RGB | (1, 1, 0.9675509) | (1, 1, 0.9608293) |
| Alpha range | 1–1 | 1–1 |
| Bounds minimum | (-0.6737865, -0.4975595, -0.7945887) | (-0.6737865, -0.4973406, -0.7943098) |
| Bounds maximum | (0.6204690, 0.8546355, 0.6001794) | (0.6201575, 0.8546355, 0.6000510) |

Simplification is lossy: retained vertices keep their source colors, with interpolated colors across larger triangles. The optimized GLB is approximately 99.1% smaller and retains the source silhouette within 0.00032 units at the bounding-box extrema.

Pet/feed/play use procedural movement and generated reaction effects, separate from the input system that triggers them. Runtime-generated deformation adds a head tilt/bow and approximate alternating foot swings while the source GLB remains unchanged. Running and jumping use acceleration, braking, gravity, and a simulated floor; a posed-vertex contact solver keeps the feet above that floor. There is no detected real-world room geometry. Detailed eyelid, mouth, ear, and articulated limb movement still needs artist-authored rigging or morph targets. See [character animation workflow](character-animation.md) for the Blender authoring and web playback plan.
