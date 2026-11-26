# Aurum Serpens

**Live:** https://kiefcake.github.io/aurum-serpens/

A real-time WebGL study in avarice. One continuous scroll descends through four scenes:

- **The Serpent:** a gold serpent inlaid with cloisonné emeralds that follows your cursor across a lacquer floor. When you're idle it wanders on its own, coils up the money tree and circles the sculpture.
- **I. The Money Tree (摇钱树):** a procedurally grown bronze tree hung with square-holed coins, after the money trees of Han-dynasty tombs. A coin moon rises behind it as it grows. Click to shake loose a rain of coins.
- **II. Ouroboros:** a white marble serpent tied in a trefoil knot, levitating above a black marble plinth and feeding forever into its own mouth. It is cracked and mended with gold (kintsugi). Drag to turn it.
- **Coda:** the gold serpent closes into a ring and bites its own tail.

## Technique

| Piece | How it works |
| --- | --- |
| Lighting | Photographed HDRIs. A softbox studio is reshaped on load into a black jewellery studio: the walls are sunk and the lamps soft-clipped so gold highlights stay gold. A colonnaded rotunda lights the gallery. Both are prefiltered with PMREM |
| Serpent spine | Follow-the-leader IK on 128 joints. Position, tangent and a camera-facing dorsal normal are packed into a float texture every frame |
| Serpent body | A single tube mesh skinned entirely in the vertex shader from that texture (`texelFetch` with manual interpolation). Diamond scales, the anti-aliased cloisonné motif and cabochon emeralds are in a patched `MeshPhysicalMaterial` |
| Money tree | Seeded recursive branching, resampled along Catmull-Rom curves, with twisting metal lobes and buttress roots. Every ring is stamped with a birth time, so growth is one uniform. The bark is cast bronze with verdigris in the grooves, and turns to gold at the twig tips |
| Coins | Instanced, with a square-hole cut-out, embossed rim and glyphs. They hang, swing in a shared wind field and pop in with an elastic overshoot. Falling coins are animated purely on the GPU |
| Sculpture | Signed distance fields raymarched inside a proxy box. The body is an analytic (2,3) torus knot, with a sculpted head whose jaws close on the tail. Scales crawl toward the mouth. It has soft shadows, AO, translucency and fbm veining. The polished plinth reflects the knot with a secondary march, and it writes `gl_FragDepth` so it composites with the rasterised scene |
| Gallery | Photogrammetry scans (a marble bust and brass vases) on pedestals between a fluted colonnade, in front of procedurally drawn moonlit windows |
| Backdrops | One sky-dome shader per chapter: velvet drapes, ink-wash mountains, a gallery wall, and a starfield with a gold nebula |
| Camera and scroll | Catmull-Rom rails keyed to DOM sections, timed with a monotone cubic so the camera never stops at a key. The scroll follows a critically damped spring, and mouse-wheel input glides |
| Post | Dual-filter bloom with a Karis firefly filter, then one fused pass that adds bloom, lens warp, chromatic fringing, vignette, ACES tone mapping and display-space grain |
| Performance | Adaptive resolution driven by GPU timer queries, per-chapter culling, a reflection pass limited to the floor's subjects, bounded SDF marching, and no per-frame allocations |

## Run locally

It's static, so serve the folder with anything:

```bash
python -m http.server 5173
```

Then open http://localhost:5173. Three.js r170 loads from jsDelivr via an import map.

## Credits

HDRIs and scanned models are from [Poly Haven](https://polyhaven.com), released under CC0:

- [Studio Small 09](https://polyhaven.com/a/studio_small_09) and [Sepulchral Chapel Rotunda](https://polyhaven.com/a/sepulchral_chapel_rotunda) HDRIs
- [Marble Bust 01](https://polyhaven.com/a/marble_bust_01) and [Brass Vase 01](https://polyhaven.com/a/brass_vase_01) by Rico Cilliers
