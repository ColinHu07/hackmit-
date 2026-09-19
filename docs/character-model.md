# Supplied character asset

- Input: user-supplied `GLB0.glb`, 35,507,320 bytes, 1,972,568 triangles.
- Original SHA-256: `b3d477cce37b353184cf500c50bfd8aa3f7497c962e4ad16937b07cbdb61c905`.
- Runtime: `glasses-web/public/models/nova.glb`, 190,384 bytes, 15,778 triangles.
- Tool: glTF Transform CLI 4.5.0, meshoptimizer simplification.
- Command: `gltf-transform simplify GLB0.glb nova.glb --ratio 0.008 --error 0.001`.
- Reference: [official simplify documentation](https://gltf-transform.dev/modules/functions/functions/simplify).

The original supplied file was not modified. Only the optimized asset is checked in. The model has one material, no textures, no skin, and no animation clips. Runtime lighting retains its pale material. Missing normals are computed after loading; the bounding box is centered and fit within 142 pixels. No external decoder or CDN is needed. No author or license was supplied with the file; this record does not invent attribution or relicensing.

Pet/feed/play animate the whole mesh and small generated reaction effects. These are not skeletal animations or camera-detected hand interactions.
