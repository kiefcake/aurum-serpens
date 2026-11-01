# Aurum Serpens

A real-time WebGL study in avarice. One continuous scroll descends through three scenes:

- **The Serpent:** a gilded snake that follows your cursor. When you're idle it wanders on its own, coils up the money tree and circles the sculpture.
- **I. The Money Tree (摇钱树):** a procedurally grown tree hung with square-holed coins, after the bronze money trees of Han-dynasty tombs. It grows as you scroll. Click to shake loose a rain of coins.
- **II. Ouroboros:** a marble serpent eating its own tail on a fluted plinth, cracked and mended with gold (kintsugi). Drag to turn it.

No models, no textures: everything is generated in code and shaders.

## Technique

| Piece | How it works |
| --- | --- |
| Serpent spine | Follow-the-leader IK on 128 joints. Position, tangent and a camera-facing dorsal normal are packed into a float texture every frame |
| Serpent body | A single tube mesh skinned entirely in the vertex shader from that texture (`texelFetch` with manual interpolation). Scales, iridescence and the travelling light pulse are all in the fragment shader |
| Money tree | Seeded recursive branching. Every ring is stamped with a birth time, and the vertex shader slides each ring out from its parent, so growth is one uniform |
| Coins | Instanced, with a square-hole cut-out, embossed rim and glyphs. They hang, swing in a shared wind field and pop in with an elastic overshoot. Falling coins are animated purely on the GPU |
| Sculpture | Signed distance fields raymarched inside a proxy box: soft shadows, AO, translucency, fbm marble veins and Voronoi kintsugi seams. Writes `gl_FragDepth` so it composites correctly with the rasterised scene |
| Camera | Catmull-Rom rails keyed to DOM section offsets, with eased segments and damped scroll |
| Post | Unreal bloom, then a lens pass (scroll-velocity barrel warp, chromatic fringing, vignette, grain), then ACES tone mapping |

## Run locally

It's static, so serve the folder with anything:

```bash
python -m http.server 5173
```

Then open http://localhost:5173. Three.js r170 loads from jsDelivr via an import map.
