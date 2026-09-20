# Making Nova react

Use the existing Three.js renderer for immediate movement and [Blender](https://www.blender.org/about/) for authored character animation. Blender is free and open source. No additional animation software is needed to run the current procedural reactions.

## What the supplied asset supports

Inspection of `glasses-web/public/models/nova.glb` confirms one colored mesh, no skeleton/skin, no morph targets, and no animation clips. The source asset is a static sculpture with vertex colors. Procedural code moves and turns the character, adds hearts or treats, rotates the face as a rigid region with blending at the neck, and generates alternating planted and lifted foot steps. Petting uses a spring-damped lean toward touch; idle, feed, play, and landings also preserve body scale without compressing or stretching the character. This remains an approximation on the static mesh, not an artist-authored skeleton. Detailed eyes, mouth, ears, and articulated limbs need authored controls; a broad deformation cannot provide a true blink or articulated chewing. See [asset provenance](character-model.md).

An interaction has three parts: an input requests `pet`, `feed`, or `play`; `CreatureSession` accepts it and records its timing; `NovaRenderer` displays the response. Button, keyboard, pointer, and hand tracking inputs can share the same animation logic. Improving the animation does not by itself improve hand detection.

`NovaLocomotion` owns actual movement. It runs at 120 Hz with a 190 scene-unit/second speed cap, acceleration 520, braking 640, gravity 720, and jump speed 250. A jump first anticipates for about 0.18 seconds, rises about 43 scene units during a 0.69-second ballistic flight, then settles over about 0.32 seconds. `JumpPose` synchronizes the crouch, push-off, tuck, floor reach, and impact recovery with those physics phases. `SoftJump` poses the lower body while preserving rigid torso/face proportions and overall body scale. The head nod lags the landing bend, and its rotation composes with the torso hinge. Airborne contact correction uses the untucked soles so lifting the feet cannot pull the whole body down. Visible movement renders at the display refresh rate; there is no separate 30 Hz idle/run cap. `Run around` / L follows a short bounded route on the ground and returns home; J explicitly jumps; clicking empty ground sets a destination. The foot cycle follows distance traveled and alternates a planted stance with a lifted forward swing, so speed changes and braking also change the scurry rate. `GroundContact` measures the posed mesh's support vertices to keep the soles above the simulated floor. These are scene-unit simulation values, not a claim of calibrated real-world scale or detected surfaces.

Author future run cycles **in place**: the physics system must remain responsible for translation, takeoff, and landing. Keep authored clip motion inside the root-relative stage; animation clips should not relocate the saved direction anchor. Explicit **Move here** commands use `AnchorTravel` to move that anchor along a smooth angular path. Its travel distance drives the same `SoftGait` footsteps and facing, with a speed cap derived from calibrated FOV. Initial placement remains immediate; subsequent relocation and retargeting preserve the visible current position. The current `Play` reaction starts a short run that may continue after its three-second feedback effects finish. Pet/feed stop the route and brake on landing if Nova is already airborne.

## Phone playground actions

`PetActionPose` samples the shared action clock so every phone sees the same sequence. Treat takes 6.2 seconds: a half turn toward the viewer, a crouched approach, a fruit lifted from the ground to the muzzle, three bites with crumbs, a happy head wiggle with hearts, and a turn and walk home. Wave takes 3.4 seconds, turns toward the viewer, raises and swings one forepaw using `SoftPaws`, lowers it, and turns forward again. Jump takes 1.4 seconds with a grounded knee bend, ballistic flight, tucked feet, and an impact bend using `SoftJump`. `GroundContact` uses a support depth in the phone scene's units to keep the soles on the ground.

These actions offset the rendered body; shared player coordinates and the following camera remain anchored to the walking heading. Reduced motion retains static treat/heart feedback without turns, travel, or jumping. The source mesh remains unrigged, so the forepaw and chewing responses are procedural approximations. Shared durations live in `shared/play-protocol.mjs`; a running game server needs a restart to serve changed durations. Device-local happiness loses one point every 45 minutes (1.5 times the previous 30-minute interval), retaining the existing floor and quest rewards.

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
