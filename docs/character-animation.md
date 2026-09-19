# Making Nova react

Use the existing Three.js renderer for immediate movement and [Blender](https://www.blender.org/about/) for authored character animation. Blender is free and open source. No additional animation software is needed to run the current procedural reactions.

## What the supplied asset supports

Inspection of `glasses-web/public/models/nova.glb` confirms one colored mesh, no skeleton/skin, no morph targets, and no animation clips. The source asset is a static sculpture with vertex colors. Procedural code moves, turns, and squashes the character, adds hearts or treats, and generates a soft head tilt/bow plus approximate alternating foot swings. Detailed eyes, mouth, ears, and articulated limbs need authored controls; a broad deformation cannot provide a true blink or articulated chewing. See [asset provenance](character-model.md).

An interaction has three parts: an input requests `pet`, `feed`, or `play`; `CreatureSession` accepts it and records its timing; `NovaRenderer` displays the response. Button, keyboard, pointer, and hand tracking inputs can share the same animation logic. Improving the animation does not by itself improve hand detection.

`NovaLocomotion` owns actual movement. It runs at 120 Hz with a 190 scene-unit/second speed cap, acceleration 520, braking 640, gravity 720, and jump speed 250. A jump rises about 43 scene units and returns to ground in about 0.69 seconds. `Run around` / L follows a short bounded route with two moving hops and returns home; J jumps; clicking empty ground sets a destination. `GroundContact` measures the posed mesh's support vertices to keep the soles above the simulated floor. These are scene-unit simulation values, not a claim of calibrated real-world scale or detected surfaces.

Author future run cycles **in place**: the physics system must remain responsible for translation, takeoff, and landing. Keep motion inside the root-relative stage; animation should not relocate the saved direction anchor. The current `Play` reaction starts a short run that may continue after its three-second feedback effects finish. Pet/feed stop the route and brake on landing if Nova is already airborne.

## Proposed authored clips

These are the target names and art direction for a future animated GLB, not clips already present in the asset. Durations match the current interaction timings; `Idle` is a suggested loop length.

| Clip | Length | Motion | Playback |
| --- | --- | --- | --- |
| `Idle` | About 4 seconds | Gentle breathing and occasional blink | Loop seamlessly |
| `Pet` | 2.2 seconds | Lean toward touch, soften eyes, perk ears, settle | Once, then idle |
| `Feed` | 2.8 seconds | Anticipate treat, lower head, chew, satisfied lift | Once, then idle |
| `Play` | 3 seconds | Crouch, hop or turn, land softly | Once, then idle |

Keep each action centered on the same origin so the saved glasses anchor stays stable. Match each reaction's first and last pose to the idle rest pose. Author a visible response near the start instead of leaving a long anticipation with no feedback. Treats and hearts can remain web-generated effects.

## Blender workflow

1. Import a copy of `nova.glb` through **File → Import → glTF 2.0** and save an editable `nova.blend` source file separately. Keep the current runtime GLB until the replacement passes review.
2. Inspect the face and joints before rigging. The simplified triangle mesh may need cleaner geometry around eyelids, mouth, and bending joints. Finish those topology edits before creating expressions; shape keys store vertex positions. [Blender shape key guide](https://docs.blender.org/manual/en/4.5/animation/shape_keys/introduction.html).
3. Add a small armature with a root/body, neck/head, and only the ear or limb bones needed by the clips. Select the mesh, then the armature, and use **Parent → Armature Deform → With Automatic Weights** as a starting point. Test head and ear poses, then correct unwanted deformation with weight painting. Automatic weights often need manual correction. [Blender armature parenting](https://docs.blender.org/manual/en/4.1/animation/armatures/skinning/parenting.html).
4. Add a `Basis` shape key plus relative keys such as `Blink`, `HappyEyes`, and `MouthOpen`, sculpting the existing vertices into each expression. Keyframe each expression's influence alongside the body poses. If the face lacks enough geometry, add it during step 2. [Blender shape keys](https://docs.blender.org/manual/en/4.5/animation/shape_keys/introduction.html).
5. Create the four actions above. At 30 fps, starting at frame 1, a 2.2-second pet action ends at frame 67; feed ends at 85; play ends at 91. Inspect silhouettes at the small size used in the glasses display, where clear head and body movement matters more than tiny detail.

## Export and verify

Export **glTF Binary (`.glb`)** with the character mesh, armature, animations, and shape keys enabled. For a straightforward explicit clip grouping, use animation mode **NLA Tracks**: give each clip its own track, and use matching track names on the armature and face animation so they export together. Keep all parts of a clip on the same frame range. Sample animation when constraints or drivers are involved. Blender's **Actions** grouping changed with slotted actions in 4.4, so do not assume older track-name advice applies to that mode. [Official glTF exporter documentation](https://docs.blender.org/manual/id/5.0/addons/import_export/scene_gltf2.html#animations).

Re-import the exported file into a clean Blender scene and inspect all four clips. In the web app, verify clip names, facial movement, smooth transitions, complete playback, and return to idle. Check reduced-motion behavior, repeated inputs, the existing camera-facing control, and the saved anchor. Recheck loading time and frame rate on the target phone/glasses before replacing the current optimized asset.

## Web integration for the future animated GLB

`GLTFLoader` exposes embedded clips as `gltf.animations`. The playback pattern is an `AnimationMixer` for the loaded character, actions cached by clip name, and mixer updates using elapsed **seconds** each frame. Keep the glasses anchor outside the animated model hierarchy. [GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html), [AnimationMixer](https://threejs.org/docs/pages/AnimationMixer.html).

`CharacterClips` loops `Idle` and runs `Pet`, `Feed`, and `Play` once with 180 ms crossfades. Clip names are case-insensitive. Playback speed matches each imported reaction to the session duration; completion returns to idle or the rest pose. Missing clips retain procedural feedback. A separate parent handles model normalization, anchor-relative placement, and proximity movement, so authored tracks retain their own transforms. [AnimationAction](https://threejs.org/docs/pages/AnimationAction.html).
