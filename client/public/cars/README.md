# Real car models (optional)

The game ships with built-in lookalike models. To make a car look exactly like the real thing,
drop a glTF binary (`.glb`) here and list it in `models.json`:

```json
{
  "toro":     { "file": "aventador.glb", "rotateY": 0,   "paint": ["paint", "body"] },
  "stallion": { "file": "porsche-911.glb", "rotateY": 180 }
}
```

- Keys are car ids from `shared/cars.ts`: `danfo`, `runner`, `lekki`, `keke`, `okada`, `toro`, `rosso`, `stallion`, `gwagon`, `phantom`.
- `rotateY` (degrees): use `180` if the car drives backwards. Models lying along the x axis are turned automatically.
- `paint`: words in the body-paint material names, so the garage paint colours apply.
- Models are scaled to the car's real length and sat on the road automatically.

Where to get models: Sketchfab (filter by *Downloadable* and a licence that allows your use, e.g. CC-BY,
and credit the author), Poly Pizza, or your own Blender exports. Keep each file under ~5 MB
(low-poly, compressed textures) so the game still loads quickly on phones. Draco-compressed files aren't supported.

Traffic always uses the built-in models, so the town stays fast.
