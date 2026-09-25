/**
 * @file core/config.js — every tunable (metres, seconds, m/s). No magic
 * numbers outside this file (bible rule 5).
 */
export const CONFIG = {
  // World layout
  CHUNK_LEN: 40,
  ROAD_WIDTH: 12.6, // incl. shoulders; lane edges at ±5.1, lanes centred -3.4/0/+3.4
  LANE_W: 3.4,
  ROAD_TILE_LEN: 12, // road texture metres per v-repeat
  SAND_TILE_LEN: 13,
  DESERT_HALF_W: 170,
  ROAD_AHEAD: 330, // shells extend this far ahead of the camera
  ROAD_BEHIND: 40,
  CORRIDOR_CLEAR: 1.55, // menu-dolly/attract corridor kept free at all z

  STREAM: { maxChunksBehind: 1 },
  // Cycle: index%8===1 and 7 are hero convoy clusters (index 1 backs staged=beauty).
  CHUNK_PLAN: ["plain", "convoy", "plain", "wreck", "plain", "wreck", "plain", "convoy"],

  GUARDRAIL: {
    xInner: 6.55, postSpacing: 4, railY: 0.62, postH: 1.05,
    // Retroreflector dots (chunks.js): their own instanced mesh + basic
    // material so per-post brightness (instanceColor, HDR allowed) reads as
    // real retroreflection — some posts "catch" more than others.
    reflector: {
      size: [0.03, 0.07, 0.07], zOff: 0.11, color: 0xffb24d,
      dusk: { dim: [0.1, 0.4], glintChance: 0.15, glint: [0.75, 1.15] }, // sun glint only
      night: [0.55, 1.35], // all lit, varied catch
    },
  },
  STREETLIGHT: {
    x: 7.7, poleH: 8.6, chance: 0.85,
    // Night light kit (chunks.js only — dusk lamps stay dead: power is out).
    // <=2 draws per lit lamp (head + pool), shared geo/materials. Round-4:
    // the additive light cones are DELETED (hard-edged translucent
    // triangles — cheapest-looking element); the ground pool carries the
    // light, opacity raised 0.2 -> 0.26 to keep it readable at distance.
    night: {
      litChance: 0.75,
      // Round-5: the night menu is art-directed, not left to seed luck —
      // chunk index < forceLitChunks always places its streetlight AND runs
      // it lit (patchy-grid rule waived there). Chunks 0-1 back the menu
      // dolly opening frame and the staged=beauty convoy, so the captured
      // night view always carries a lit sodium lamp + ground pool beside the
      // camera path regardless of ?seed. Other chunks keep litChance.
      forceLitChunks: 2,
      lamp: { size: [0.64, 0.08, 0.28] }, // emissive head plate on emissiveStrip
      pool: { w: 6.4, l: 4.6, y: 0.04, opacity: 0.26, color: 0xffb26a },
    },
  },
  SCRUB: { perChunk: 22, xMin: 9.5, xMax: 64 },
  ROCKS: { perChunk: 9, xMin: 7.6, xMax: 64 },
  // Mesas: distant silhouettes. Aerial perspective is two-layered — scene fog
  // handles the along-road axis; the per-instance tint below (chunks.js
  // mesa builder) tints toward the sky haze with LATERAL distance, so
  // near-road mesas stay crisp and far ones melt into the horizon. Dusk lifts
  // toward the pale haze (25-40% silhouette contrast gone by ~t=0.7, full
  // melt at fadeFar); night tints deep blue with a faint ember retained in
  // red AND roughly doubles the hemi/moon-lit rock so mesas hold a ~6-10%
  // luminance floor instead of filling pure black.
  MESAS: {
    chance: 0.8, xMin: 90, xMax: 250, wMin: 26, wMax: 78, hMin: 15, hMax: 44,
    twinChance: 0.45, // shoulder-peak companion instance (double-peak massifs)
    fadeNear: 90, // lateral m where the haze tint starts
    fadeFar: 200, // lateral m where the haze tint reaches fadeMax
    fadeMax: 1.0, // tint blend cap (instanceColor = lerp(1, hazeTint, t))
    hazeTint: [1.3, 1.45, 1.62], // dusk HDR RGB: lift toward the pale cool haze
    hazeTintNight: [1.3, 1.8, 3.0], // night HDR RGB: deep blue, ember in red
  },
  // Mesa rock texture (assets.js GENERATORS.rock). strataBands per tile with
  // lathe UVs (v ≈ height fraction; profiles sample y near-linearly) -> one
  // band every h/24 m: 0.6-1.8 m across the MESAS height range (round-5:
  // was 6 bands = 2.5-7.3 m slabs). strataTones.length MUST equal
  // strataBands (the generator wraps the tone index by the array length).
  // Adjacent tone steps stay ≤ ~22% — with 0.6-2 m bands, bigger steps
  // pulse as alternating stripes instead of reading as geology.
  MESA_ART: {
    strataBands: 24,
    strataWobble: 1.6, // cycles of band-edge wobble from the low-freq fbm (±0.8 band)
    strataTones: [
      1.02, 0.88, 1.06, 0.92, 0.84, 0.96, 1.1, 0.9, 1.0, 1.08, 0.9, 0.96,
      1.04, 0.9, 1.06, 0.98, 0.88, 1.0, 0.92, 1.08, 0.9, 0.96, 1.02, 0.9,
    ],
    skirtDarken: 0.26, // scree/talus base band albedo dip
    grainHeight: 0.09, // scree grain relief into height (-> normal map bump)
    grainAlbedo: 0.08, // scree grain albedo swing (±4%)
  },

  // Scatter clustering (chunks.js): scrub/rocks/debris gather in a few
  // patches per chunk instead of uniform random, with wide scale variety.
  SCATTER: {
    clusterFrac: 0.72, // probability an item belongs to a cluster
    spread: 7, // cluster radius (m)
    scaleMin: 0.55, // per-item scale multiplier range on top of base sizes
    scaleMax: 1.45,
  },
  SIGNS: {
    chance: 0.4, x: 7.0,
    // Night read (baked + placed in chunks.js): the guide panel dims ~20%
    // (color scalar — it has no true emissive; its white legend just reads
    // self-lit under moon+hemi) and a small warm lightPool quad under it
    // grounds the glow (was emissive-with-zero-spill, floating).
    night: { dim: 0.8, pool: { w: 3.2, l: 2.4, y: -0.02, opacity: 0.18 } },
  },
  WRECKS: {
    wreck: { sedans: [1, 2], bus: 0, cab: 0, trailer: 0, debris: 6, wheels: 2 },
    convoy: { sedans: [2, 3], bus: 1, cab: 1, trailer: 1, debris: 10, wheels: 6 },
    // Per-instance brightness variance (chunks.js buildWrecks, instanceColor
    // diffuse multiplier — HDR allowed): hull flanks get seeded 1.0-1.25
    // tones so near-camera vehicles can sit among the brighter instances;
    // the vehicle nearest the camera per chunk is forced to the lightest
    // paint variant at tone max (beauty/close foreground readability).
    // Round-5: max 1.25 -> 1.15, AND buildWrecks clamps every tone so
    // texelCeil-linear × tone ≤ albedoCap (0.92 / 0.807 = 1.14 binds) —
    // at 1.25 the sunlit flank of the lightest paint sat at ~0.65-0.7
    // linear pre-bloom (threshold 0.62) and blew out to white.
    tone: { min: 1.0, max: 1.15 },
    // Night rim separation (round-5): mid-ground hulls crushed to black
    // boxes against black ground. buildWrecks multiplies the vehicle
    // instanceColor tail by this cool moonlit multi (blue-biased albedo
    // lifts upward-facing edges ~5-8% under the night rig); dusk paint is
    // untouched. Chained AFTER the albedoCap tone clamp — the +4/+12%
    // channels sit on a night-dark base, far from the bloom threshold.
    nightRim: [1.0, 1.04, 1.12],
    albedoCap: 0.92, // max texel × tint × tone product (linear albedo)
    // The nearest (hero) vehicle's fake contact shadow shrinks this much per
    // axis: at the staged beauty pose its full footprint quad reached ~6.5 m
    // toward the camera and blanketed the frame bottom with the bus's cast
    // shadow. 0.78 keeps the rear wheels grounded (quad still spans them).
    heroShadow: 0.78,
    wheelR: { sedan: 0.36, bus: 0.55, cab: 0.5, trailer: 0.5 }, // wheel bottom sits at y=0
    // Wheel archetype (chunks.js buildArchetypes): tire torus + rim disc +
    // hub + through-spokes, 2 material groups, instanced per chunk. Base
    // outer radius = tireR + tube; instances scale by wheelR / baseR so
    // tire bottoms sit at y = 0.
    wheel: {
      tireR: 0.285, tube: 0.08, tubular: 12, radial: 7,
      rimR: 0.22, rimW: 0.11, hubR: 0.07, hubW: 0.19,
      spokes: 5, spokeW: 0.16, spokeT: 0.055, spokeLen: 0.4,
    },
    // DOT-style reflective contour tape on the trailer rear (chunks.js
    // archetype group 9): flat MeshBasicMaterial read = retroreflection at
    // dusk — visible but restrained in the backlit beauty framing; the red/
    // white dash VALUE alternation lives in the dotTape canvas (assets.js).
    // HDR ~0.05 luminance: far under the bloom threshold.
    dotTape: { color: 0x8a2020 },
    // Gameplay dressing (design 4, task 4.1): with the world's gameplay flag
    // set, buildWrecks shifts every ON-road wreck slot to shoulder x =
    // xInner + hull half-width + gap — the 3-lane corridor (edges ±5.1)
    // stays wreck-free. Placement only; the rng draw order is identical.
    gameplay: { shoulderGap: 0.15 },
  },

  // Wreck hull paint texture (assets.js GENERATORS.wreck, 512² via
  // gen.minSize). Backlit-convoy readability: albedo lifted off black, soft
  // top-down dust gradient (box side faces: v=1 top, v=0 bottom), noisy
  // dust band on panel lower edges, rain-drip streaks, rust-bleeding seam
  // lines on an explicit ~2 m panel grid.
  WRECK_ART: {
    albedoLift: 1.1, // paint/primer/mid albedo multiplier (backlit floor)
    // Round-5 albedo ceiling: worst-case chain paint 176 × l 1.04 × band 1.1
    // × albedoLift 1.1 × topLighten 1.04 = 230.3 sRGB — under the byte
    // ceiling again (was 1.28 -> 268, clamping top strips to flat 255 =
    // 1.0 linear albedo and blowing sunlit roofs/flanks past the bloom
    // threshold). texelCeil guards the invariant in GENERATORS.wreck and
    // feeds the chunk-side tone cap (chunks.js buildWrecks): sRGB 232 =
    // 0.807 linear, × max tone 1.14 = 0.92 paint×tone worst case.
    texelCeil: 232,
    topLighten: 0.04, // roof/upper-panel dust lift at v = 1
    baseDarken: 0.08, // lower-panel darkening at v = 0
    dustBandV: 0.3, // height where the lower dust band fades out
    dustBandMax: 0.12, // max albedo darkening inside the dust band
    chipThreshold: 0.78, // primer-chip field gate (sparse, small chips)
    panelsPerTile: 6, // panel breaks per u-tile: bus side 11.5 m -> ~1.9 m
    panelWobble: 0.35, // cycles of seam-line wobble from the low-freq fbm
    // Round-6 "painted metal, not wood grain": seams darker + tighter (1-2 px
    // core) so panel breaks read as crisp fabricated joints, and the drip
    // walks run straighter/shorter/sparser (26 wavy 252 px streaks read as
    // wood grain at hero distance -> 14 near-vertical 126 px weatherers).
    seamPx: 1.5, // seam line half-width in px at the 512 gen size (~1-2 px core)
    seamDarken: 0.42, // max albedo darkening on a panel-break seam
    dripCount: 14, // vertical drip streaks per tile
    dripSteps: 90, // walk length per drip (x dripStepLen px)
    dripStepLen: 1.4,
    dripDarken: 0.16, // max drip albedo darkening at the streak tail
    dripJitter: 0.3, // start-angle spread (rad, about straight-down)
    dripWiggle: 0.22, // per-step heading wobble (was 0.55 = wavy bands)
    // Horizontal feature lines (window sill / skirt break on the bus flank:
    // v 0.553 = y 1.62 m = the window-band sill, v 0.22 = y 0.87 m = the
    // skirt top). Crisp ~2 px core with a lit lower lip (metal edge read).
    sillV: 0.553,
    skirtV: 0.22,
    lineWobble: 0.004, // v units of line wander (~±1 px at 512)
    lineDarken: 0.06, // line-core albedo darkening
    lineLift: 0.04, // lit lip just below the line
    rivetsPerTile: 36, // rivet lattice along the sill (512/36 = ~14 px pitch)
    rivetChance: 0.72, // fraction of lattice points that carry a rivet
    rivetDarken: 0.3, // rivet dot albedo darkening at its core
    rivetOffsetPx: 3, // rivet row sits this far (px) below the sill line
    rustEdgeMix: 0.5, // rust tint strength on panel-break seams
  },

  // Vehicle emissive kit (chunks.js archetypes), dusk vs night. taillight
  // drives the red rear markers; glow drives the shared "reflector" group —
  // the bus interior light boxes (read through the window band) and the
  // trailer amber side markers — so at night the convoy bus reads as the
  // warm-lit hero instead of unlit windows (round-5: was never wired).
  // Round-6 bloom cap: glowDusk 1.15 put the bus glow boxes at HDR ~0.62
  // (emissive 0xffb24d linear luminance 0.536 x 1.15) — ON the bloom
  // threshold 0.62, so at close range the bloom radius fused the interior
  // boxes into one blown white roofline strip. 0.72 gives HDR 0.386; seen
  // through the 0.65-opacity glass the composite is ~0.25 — under both the
  // 0.55 pre-bloom budget and the threshold (windows still glow warmly
  // through dark glass). Night keeps 1.8 (deliberate hero glow, fused read
  // wanted there; night capture scored with it).
  VEHICLE_LIGHTS: { taillightDusk: 2.2, taillightNight: 3.5, glowDusk: 0.72, glowNight: 1.8 },

  // City glow card. Width >> frustum needs: the envelope fade (outer
  // envelopeFrac of the canvas each side) and the hard ends stay off screen.
  CITY: {
    dist: 700, height: 130, y: 26,
    width: 3000, hazeWidth: 3000, hazeHeight: 260,
    envelopeFrac: 0.18, // each side of the skyline canvas fades smoothly to zero
    cardOpacity: { dusk: 0.38, night: 0.55 }, // glow sits behind the tower silhouettes
    // Round-5: haze 0.14 -> 0.18 — the single radial haze core brightens
    // ~30% over the baked dim stretches, breaking the red monotone.
    hazeOpacity: { dusk: 0.12, night: 0.18 },
    // Night ember variation (round-5): two additive lightPool blobs sharing
    // the haze material (they breathe with its flicker), riding the city
    // group. x = fraction of card width; y = world y at the card plane
    // (just under the horizon line, matching the baked drawCity radials at
    // ~26-62 m across — these read as sibling ember clusters, not patches).
    // Night-only — kills the single-hue red band.
    night: {
      embers: [
        { x: -0.16, y: -7, w: 120, h: 55 },
        { x: 0.12, y: -11, w: 95, h: 45 },
      ],
    },
  },

  // Sky dome gradient shape; sky.js mirrors these in its analytic fog sample.
  SKY: {
    horizonSpan: { dusk: 0.4, night: 0.18 }, // elev (sine) where horizon tint yields to mid/zenith — night keeps the warm band hugging the city azimuth
    warmWash: { dusk: 0.12, night: 0.16 }, // broad warm scatter around the sun/city azimuth — dusk 0.2 -> 0.12 (round 4) so uMid/uZenith teal reads in the upper third of dusk frames; night untouched
    // Thin warm horizon strip (sky.js dome shader: peaked ON the horizon
    // line, faded out within ~2 deg of it). Grades the desert-shell -> sky
    // seam: the desert plane ends at DESERT_HALF_W where fog is only
    // ~50-85% saturated, so the dome carries the last value step.
    horizonGlow: { dusk: 0.1, night: 0.06 },
    fogSampleElev: 0.02, // sine elevation of the analytic fog color sample (toward +Z)
  },

  // Night-only fake headlight pools: additive textured blobs on the asphalt
  // ahead of the camera (not real spotlights — zero light-cost).
  POOL: {
    color: 0xffc987, opacity: 0.34, // round-5: 0.28 -> 0.34 — bottom third still read as dead void
    width: 9, length: 15.6, y: 0.06, tiltDeg: 2.5, // +20% size over r2
    laneOffset: 1.1, // x LANE_W — one pool per headlamp lane
    z: [15, 30], // centers ahead of the camera (spans ~8-21 m and ~23-36 m)
    // Implied light source (round-5): one soft vertical glow column per
    // pool — lightPool texture stretched tall, Y-billboarded to the camera
    // with a slight top-toward-camera lean. Gradient-only (the round-4
    // hard-cone failure must NOT return); 2 draws total at night.
    shaft: { w: 3.4, h: 6.8, y: 3.7, opacity: 0.06, tiltDeg: 6 },
  },

  // Asphalt response under the dusk rig (assets.js GENERATORS.road +
  // MATERIAL_DEFS.road): near-field road must sit ~15-25% screen luminance —
  // darker than sand, never crushed to black. Wheel tracks get worn polish:
  // a roughness dip for sheen AND a slight albedo lift (traffic-polished
  // asphalt reads lighter), while aggregate/oil wear marks cluster onto the
  // tracks + shoulders via the wearAt(u) weight (0 mid-lane .. 1 shoulder).
  ROAD_ART: {
    albedoBase: 54, // sRGB floor of bare asphalt (was 44 — near field read pure black)
    polishLighten: 0.05, // wheel-track albedo lift (was 0.16 — straight bright smears under the raking sun; sheen now lives in polishRough)
    envMapIntensity: 0.24, // road material PMREM/sky fill (was 0.18 — round-6 near-field crush lift; bare mid-lane still reads ~5-6% sRGB, well under the polished tracks' ~12%)
    dashPaint: [0.88, 0.88, 0.92], // sRGB lane-dash paint; desaturated so bloom+ACES clipping can't split its channels apart (purple fringe). Round-5: 0.92 -> 0.88 — under the night moon the old paint read as cold emissive tape; the generator (assets.js) already gives dashes bare-asphalt roughness 0.88-0.98, so the glow was diffuse albedo, not specular
    wearBase: 0.3, // wear-mark acceptance where wearAt = 0 (between lanes)
    wearBias: 0.8, // added acceptance at wearAt = 1 (wheel tracks / shoulders)
    oilCount: 6, // candidate drips per tile; wear gate lands ~3-5
    oilRadius: 6, // blotch base radius in px on the 512 tile (lobed, road-elongated)
    oilStrength: 0.42, // albedo darkening at a blotch core (soft edge falloff)
    // Round-3 anti-smear: the polish bands must never read as straight
    // continuous specular lines under the low sun. The albedo lift is near-
    // zero; the ROUGHNESS dip carries the sheen, and each band meanders and
    // fades in and out along z (2-4 intensity segments per 12 m tile).
    polishWobble: 0.55, // band-centre meander amplitude, m (low-freq noise)
    polishHalfW: 0.3, // band half-width, m
    polishSegLo: 0.1, // segment intensity floor (bands break into pieces)
    polishRough: 0.5, // roughness inside polished tracks (was inline 0.58)
    // Round-4 road->shoulder blend: the paved plane ends in a hard value
    // line against the desert plane, so a few texels at each road-edge UV
    // boundary (u = 0 / 1, assets.js GENERATORS.road) mix toward a gravel
    // sand tone with a smooth inward falloff.
    edgeBlendPx: 3, // band width per side, texels at the 512 gen size (~7 cm)
    edgeBlendStrength: 0.72, // max sand mix at the outermost edge texel
    edgeBlendTone: [118, 99, 76], // sRGB sand-gravel tone the edge blends toward
  },

  // Desert sand texture (assets.js GENERATORS.sand). Ripples are domain-
  // warped: the low-frequency fbm shifts ripple PHASE across the tile (in
  // whole cycles) so no continuous sine line survives, and ripple energy
  // dies on the dry crusted patches. Frequencies are low on purpose —
  // high-frequency v-ripples moiré into wallpaper at grazing angles.
  SAND_ART: {
    rippleFreq: 9, // dominant cross-wind ripple cycles per 13 m tile (~1.4 m)
    ripple2: [5, 4], // counter-ripple cycles (u, -v): diagonal, sparser
    rippleWarp: 1.6, // domain-warp phase shift in cycles (±0.8 across tile)
    driftBias: 0.55, // wind-drift streak field threshold
    driftStrength: 0.2, // max albedo darkening inside a drift streak
    // Round-3 macro variation (kills the monotone single-value read):
    macroStrength: 0.18, // 2-oct macro field albedo modulation (±18%)
    washBands: 2, // diagonal dune-form dark washes per tile (u+v axis)
    washStrength: 0.08, // max albedo darkening inside a wash band
    washWarp: 0.55, // wash phase wobble in cycles (reuses the ripple-warp field)
    gritLo: 0.38, // fine-grit gate at macro-dark patches (dense speckle)
    gritHi: 0.62, // fine-grit gate at macro-bright rises (sparse speckle)
    gritAmp: 17, // gated speckle albedo add (red-channel scale)
  },

  // Time of day — sun low, raking diagonally across the +Z road axis.
  SUN: {
    elevationDeg: 11.5, azimuthDeg: 35, intensity: 3.5, color: 0xffab66,
    lightDist: 130,
    shadow: { left: -44, right: 44, top: 46, bottom: -40, near: 2, far: 320 },
    bias: -0.0002, normalBias: 0.06, anchorAhead: 16,
  },
  HEMI: {
    // Dusk fill lifted ~15% so wreck shadowed sides keep paint/primer
    // separation instead of crushing to black under the raking key.
    dusk: { sky: 0x35506b, ground: 0x6b543c, intensity: 0.63 },
    // Night lift so asphalt reads ~0.15-0.25 sRGB and desert ~0.10-0.20
    // (deep blue-black fill, never grey). Round-5: ground warmed/lightened
    // 0x2a1d12 -> 0x3a2a18 so upward-facing wreck hull edges catch ~5-8%
    // more bounce instead of filling pure black against black ground.
    night: { sky: 0x16243a, ground: 0x3a2a18, intensity: 1.1 },
  },
  // Moon raised to 3.2 (round-2 night verdict: foreground crushed) — lit
  // faces now target ~20-30% luminance; hemi night fill keeps shadow floors.
  MOON: { elevationDeg: 40, azimuthDeg: 150, intensity: 3.2, color: 0x93aad6 },
  CITY_LIGHT: { color: 0xff5a2e, intensity: 0.24 }, // night fire-on-horizon fill
  EXPOSURE: 1.0,
  FOG_DEEPEN: { r: 0.84, g: 0.9, b: 1.0 }, // sampled horizon -> haze (keeps contrast)

  // Post grade (bible): RenderPass->Bloom->[SMAA]->Output->Grade, never reordered.
  BLOOM: { strength: 0.62, radius: 0.55, threshold: 0.62 },
  GRADE: {
    contrast: 0.34, saturation: 1.06,
    // Black-point lift (round-6): the S-curve below crushes display-space
    // darks hard (0.05 in -> ~0.03 out), so backlit rears and the near-field
    // road floor died to absolute black. Mapping output black to 0.012 keeps
    // crushed regions at a ~1.2% sRGB base (plus grain, ~8%+ texture
    // visibility with lighting variance) without greying the blacks —
    // highlights lose a negligible 1.2% x (1 - c).
    blackPoint: 0.012,
    // Per-time-of-day shadow split-tone: dusk pushed ~8% further toward teal
    // (red 0.94 -> 0.87, blue 1.09 -> 1.10) to break the single-hue red wash
    // and join the night two-tone; NIGHT UNCHANGED (it already scored
    // best). renderer.js picks the entry from the __QA time-of-day.
    shadowTint: { dusk: [0.87, 1.0, 1.1], night: [0.94, 1.0, 1.09] },
    highlightTint: [1.06, 1.01, 0.92],
    vignette: 0.24, // was 0.35 — corners crushed to black; renderer.js also eases the rolloff curve
    aberration: 0.0045, grain: 0.028,
  },

  // Camera rigs: offsets from the dolly point on the road centreline.
  // laneX0/driftAmp/driftT (run/drive/ride attract rigs, round-4): the dolly
  // travels offset from the centreline with a slow sine drift (period
  // 2*PI/driftT ~ 11 s), so the framing is asymmetric and wrecks are passed
  // at varied lateral distance. The menu rig stays centred (no lane terms).
  RIGS: {
    menu: { back: 0, up: 2.35, lookAhead: 34, lookUp: 1.3, fov: 55, swayX: 0.55, swayT: 0.16, bobY: 0.05 },
    run: { back: 5.2, up: 1.85, lookAhead: 15, lookUp: 1.5, fov: 68, swayX: 0.25, swayT: 0.35, bobY: 0.03, laneX0: 0.8, driftAmp: 0.6, driftT: 0.57 },
    drive: { back: 8.6, up: 3.4, lookAhead: 21, lookUp: 1.1, fov: 61, swayX: 0.9, swayT: 0.24, bobY: 0.04, laneX0: 1.4, driftAmp: 0.6, driftT: 0.57 },
    ride: { back: 4.6, up: 1.6, lookAhead: 14, lookUp: 1.25, fov: 70, swayX: 1.1, swayT: 0.3, bobY: 0.04, laneX0: -1.2, driftAmp: 0.6, driftT: 0.57 },
    beauty: { back: 1.5, up: 2.1, lookAhead: 30, lookUp: 1.15, fov: 57, swayX: 2.6, swayT: 0.1, bobY: 0.04 },
    close: { back: 2.6, up: 1.35, lookAhead: 12, lookUp: 1.1, fov: 66, swayX: 0, swayT: 0.3, bobY: 0.02 },
    side: { back: 2, up: 2.7, lookAhead: 11, lookUp: 1.2, fov: 58, swayX: 7.5, swayT: 0.1, bobY: 0.03 },
    front: { back: -13, up: 1.75, lookAhead: -8, lookUp: 1.2, fov: 55, swayX: 0.4, swayT: 0.2, bobY: 0.03 },
  },
  // staged=beauty: low hero angle framed inside the convoy chunk (index 1).
  // Recomposed (round-5) around the REAL seed-1 chunk-1 layout (bus x -2.42 /
  // z 51.71 ry 0.207, trailer 3.90/67.25 ry -0.472, cab 2.60/73.49 ry -0.146,
  // sedans -3.22/49.53 ry 0.303 [nearest; embedded against the bus flank],
  // 2.90/63.56 ry -0.725, 4.45/69.52 ry -1.010). The old pose sat 1.5 m
  // BEFORE the chunk and faced the bus's SUN-SHADOWED rear face (rear
  // normal · sunDir = -0.90, 44 deg oblique) with its ~16 m cast shadow
  // (-sunDir horizontal = (-0.57, -0.82), i.e. toward the camera-right)
  // plus the embedded sedan's full-size contact quad — formless black over
  // the whole lower right. The new pose sits 2 m INSIDE the chunk: the rear
  // face compresses to a ~10 deg sliver at the right edge (52 deg oblique,
  // far rear corner exits frame at 44.5 deg), the sunlit bus flank (near
  // corner ~7.5 m, span ~4-33 deg right of centre) fills the right of frame
  // INCLUDING the lower third, and the cast shadow only clips the extreme
  // lower-right corner beside the hull (hard edge, reads as shadow). The
  // lower third reads sunlit road/shoulder (bottom ~60%), then flank base +
  // spare wheel (x -2.23, z 46.9) + the shadow wedge. The jackknifed semi's
  // LIT rear doors stay beyond it (~23 m, ~10 deg left), sedan rears read
  // lit at centre/left distance, the west (-x) guardrail sweeps in from the
  // right edge at ~9 m, and the sun disc/corona (azim 35 deg, elev 11.5 deg)
  // reads upper-left at ~34 deg left of centre. Every LIT hull corner,
  // marker wheel and the corona stay inside the 43.4 deg half-hfov (worst
  // ~39 deg incl. sway); settle time unchanged.
  STAGED_BEAUTY: { z: 30, pos: [1.6, 1.5, 40.0], look: [2.0, 1.05, 63], fov: 56, settleS: 1.5 },

  // ?scene=paused (main.js): the staged pause applies at the ready gates,
  // then screenshotReady waits out the pause screen's UI fade — 0.5s screen
  // opacity + last reveal delay 0.3s + 0.6s reveal, PLUS up to one
  // SwiftShader frame of CSS-transition start lag (~0.4s worst frame) — so
  // captures see the settled overlay, not a mid-fade frame (6.3: 1.0s
  // sampled 0.9975 opacity deterministically; 1.3s clears the worst case).
  STAGED_PAUSE: { settleS: 1.3 },

  // ?scene=gameover (main.js): same gate for the gameover screen's staged
  // death — the run ends during boot, then the settle covers the 0.5s
  // screen fade + last reveal delay 0.46s + 0.6s reveal (+ the same
  // one-frame CSS start lag as STAGED_PAUSE; same 6.3 fix).
  STAGED_GAMEOVER: { settleS: 1.5 },

  CRUISE: { menu: 9, run: 7.5, drive: 26, ride: 20, beauty: 6 },

  // Economy + scoring (run-core-loop design 9; tasks 2.5 + 4.2). score.js
  // owns the run ledger: score = floor(distance) + pickups × pickupScore;
  // currency = pickups × pickupValue — the exact product endRun credits
  // (save.currency += …, the ONE persistence write per death, task 2.5).
  // These two are the ONLY scoring constants (task 4.4 sweep verified).
  SCORE: { pickupValue: 5, pickupScore: 25 },

  // Shared gameplay dolly start z (main.js boot; the RUN mode's distance
  // baseline and the SPAWN grace runway both measure from here).
  START_Z: 20,

  // Spawn director (game/director.js, task 4.2 — stream derivation + band
  // passability semantics documented there). chance entries are [low, high]
  // ramps over rampChunks — pure functions of the chunk index (no rng draws),
  // so layouts stay seed-deterministic. Capacity bounds that keep pooled
  // back-pressure silent on the 8-chunk medium window: ≤ 6 obstacles/chunk
  // (≤ 2/type, distinct archetypes) vs OBSTACLES.maxPerType 24; ≤ perChunkMax
  // pickups/chunk vs PICKUPS.max 48; ≤ 4 zombies/chunk × 8 = ZOMBIES.max 32.
  SPAWN: {
    // 2 = chunks 0–1 stay clear (runway out of the start; 4.3 raised this
    // from 1 once a live player could die — two chunks ≈ 8 s of runway).
    graceChunks: 2,
    rampChunks: 40, // chunk indices over which densities ramp low → high (~1.6 km)
    band: {
      chance: [0.5, 0.8], // P(chunk has ≥ 1 band)
      second: 0.45, // P(2nd band | 1st) — chunk halves, ≥ 6 m apart
      lanes: [1, 3], // filled lanes per band (distinct archetypes)
      jitter: 1.0, // per-lane z jitter inside a band (m)
      pad: 1.0, // occupied() clearance around a placement window (m)
      edge: 6, // band z kept this far inside the chunk edges (m)
      splitGap: 3, // 2nd band clears the chunk midpoint by this much (m)
      maxRolls: 4, // passability validator candidate rolls per band
    },
    pack: {
      chance: [0.25, 0.5], // P(chunk has a zombie pack)
      size: [2, 4], // zombies per pack (2–5 spec envelope; see cap note)
      speed: [2.4, 3.4], // approach m/s at spawn (caller-owned update)
      spacing: [4, 7], // z spread between pack members (m)
      scale: [0.94, 1.06], // per-member figure scale (visual variance)
      inset: 8, // pack lead kept this far inside the chunk edges (m)
      clearWin: 1, // ± m occupied() window each member must spawn clear of
      lungeAt: 7, // < this far ahead of the focus → pose lunge
      cullBehind: 14, // released once this far behind the focus (passed)
    },
    strand: {
      chance: [0.4, 0.65], // P(chunk has ≥ 1 pickup strand)
      second: 0.3, // P(2nd strand | 1st) — only while the budget allows
      size: [3, 6], // markers per strand
      spacing: 2.2, // marker spacing (m; ≥ ~1.5 keeps one collect per step)
      perChunkMax: 6, // markers per chunk (PICKUPS.max = 6 × 8-chunk window)
      pad: 1.0, // strand span clearance from same-lane obstacle windows (m)
      inset: 4, // strand start kept this far inside the chunk edges (m)
    },
  },

  // Gameplay input bindings (input.js; main.js routes actions by state —
  // run-core-loop design 6). Keyboard actions are edge-triggered: one
  // emission per physical press (the keydown path drops e.repeat), no
  // auto-repeat spam. Touch gestures compare the pointerdown/pointerup
  // delta against swipePx; the dominant axis picks left/right vs
  // jump/slide; a release under the threshold emits "tap".
  INPUT: { swipePx: 24 },

  // Procedural SFX (core/audio.js, design 8 / task 5.2): master = the gain
  // the lazy context opens to at the first-gesture unlock; blips = one
  // oscillator with an exponential pitch move + decay, noise voices = the
  // shared looped noise buffer through a swept band-pass. Seconds / linear
  // gain / Hz. Engine/ambient loops are later-slice work.
  AUDIO: {
    master: 0.8,
    noiseS: 1.0, // shared noise buffer length (s; looped by every noise voice)
    ui: { type: "triangle", f0: 1160, f1: 880, dur: 0.07, vol: 0.35 }, // select/start/retry/restart/resume/quit
    pickup: { type: "triangle", f0: 840, f1: 1680, dur: 0.1, vol: 0.4 }, // collect chirp
    jump: { type: "sine", f0: 1350, f1: 1750, dur: 0.05, vol: 0.28 }, // high tick
    whoosh: { f0: 480, f1: 1500, q: 1.1, dur: 0.13, vol: 0.2 }, // lane change (subtle)
    swish: { f0: 240, f1: 640, q: 0.9, dur: 0.22, vol: 0.16 }, // slide: the whoosh path, lower + longer
    death: { // sting: sawtooth pitch-drop + noise burst
      type: "sawtooth", f0: 240, f1: 48, dur: 0.5, vol: 0.5,
      noise: { f0: 900, f1: 120, q: 0.7, dur: 0.3, vol: 0.5 },
    },
  },

  // Gameplay zombies (entities/zombies.js, run-core-loop task 3.1): pooled
  // instanced manager, <= max live figures, TWO InstancedMeshes (13 sphere
  // part instances per body + 2 emissive eye chips) = +2 draws, 1040 tris
  // per figure on screen. Gait/pose/tone tunables live here; the rig
  // anatomy (part dimensions) sits beside the pose composer in zombies.js —
  // the chunks.js shambler precedent. Poses: hz = gait cycles/s band, leg/
  // knee/arm/elbow/hunch/head = joint amplitudes (rad), reach = both-arms-
  // forward lunge pitch (rad), drop = hip crouch (m), bob = step bounce (m),
  // roll = weight-shift sway (rad). instanceColor variance: instanceColor
  // only scales diffuse in r172, which is exactly the skin/clothing channel.
  ZOMBIES: {
    max: 32,
    // Shadow-casting OFF holds the +2 added-draw gate (renderer.info counts
    // shadow-pass draws); grounding rides motion + gait. true = +1
    // shadow-pass draw for a grounded silhouette.
    castShadow: false,
    stride: 1.2, // m per gait cycle — gaitHzFor(speed) maps m/s -> hz
    poseEase: 6, // 1/s exponential rate pose parameters blend at
    poses: {
      shamble: { hz: [0.85, 1.15], leg: 0.3, knee: 0.45, arm: 0.25, reach: 0.1, splay: 0.1, elbow: 0.35, hunch: 0.42, drop: 0.02, bob: 0.028, roll: 0.06, head: 0.08 },
      run: { hz: [2.3, 2.9], leg: 0.8, knee: 1.0, arm: 0.65, reach: 0.5, splay: 0.12, elbow: 1.2, hunch: 0.62, drop: 0.05, bob: 0.05, roll: 0.06, head: -0.18 },
      lunge: { hz: [3.0, 3.4], leg: 0.95, knee: 1.2, arm: 0.25, reach: 1.35, splay: 0.32, elbow: 0.3, hunch: 0.85, drop: 0.14, bob: 0.06, roll: 0.04, head: -0.4 },
    },
    // Per-zombie skin variance around the shared olive `shambler` material
    // (pale lift + channel drift) x per-part clothing multipliers (diffuse
    // scale). HDR allowed (the mesa-haze precedent).
    tones: { skinLift: 0.04, skinVar: 0.15, shirt: 0.34, shirtVar: 0.1, pants: 0.45, pantsVar: 0.1, boot: 0.24 },
    // Eyeshine multiplier on the eye material's time-of-day emissive (the
    // manager clones `reflector` after chunks.js baked its intensity).
    eyeGlow: 1.35,
  },

  // Obstacles (entities/obstacles.js, task 3.2 — archetype + collision
  // semantics documented there): THREE pooled InstancedMeshes, one material
  // each = 3 draws. Solid Y-window per type: low up to y1 (jump clears),
  // gantry between y0/y1 (slide passes), block solidAlways (dodge only).
  OBSTACLES: {
    maxPerType: 24, // per archetype -> 72 pooled records worst case
    castShadow: false, // holds the +3 draw gate (renderer.info counts shadow draws)
    // Solid Y-window (metres above the road) per archetype + footprint
    // half-sizes. low: solid up to y1 — a jump clears it the moment the
    // player's feet (y0) reach y1 inside the z-window. gantry: solid between
    // gap (y0) and top (y1) — standing profiles hit, slide profiles pass.
    // block: solidAlways ignores Y — dodge-only.
    types: {
      low: { halfW: 1.45, zHalf: 0.28, y1: 0.8 },
      gantry: { halfW: 1.6, zHalf: 0.22, y0: 1.1, y1: 2.45 },
      block: { halfW: 1.62, zHalf: 0.55, solidAlways: true },
    },
    playerHalfW: 0.35, // runner collision half-width (shoulders + grace)
    playerHalfD: 0.3, // runner collision half-depth along z
    // collide()'s no-explicit-profile default reads PLAYER.profile.standTop
    // (below) — ONE source for the profile heights, folded in task 4.4.
    // Visual-only per-instance yaw jitter (rad, deterministic per slot):
    // debris feel on the ground pieces; the gantry stays square (its gap
    // must read true along z).
    jitter: { low: 0.09, gantry: 0, block: 0.05 },
    // Emissive accents (atlas glow mask x this color/intensity): dusk keeps
    // the stripes/lamps/restroreflectors at a restrained idle; night raises
    // them and the gantry's hazard lamps BLINK between gantryMin/gantryMax
    // (battery roadwork lamps — the gap's top edge reads at night). Bloom
    // threshold 0.62: dusk values stay well under it, gantryMax punches.
    glow: {
      dusk: { low: 0.55, gantry: 0.75, block: 0.65 },
      night: { low: 0.95, gantryMin: 0.5, gantryMax: 2.4, block: 1.05 },
      blinkHz: 0.85,
    },
  },

  // Pickups (entities/pickups.js, task 3.3 — pulse/channel trades documented
  // there): ONE pooled InstancedMesh, 1 draw; collect windows are
  // deliberately magnetic (halfW/zHalf + runner halves below).
  PICKUPS: {
    max: 48, // strand of 6 x worst-case chunk window, with headroom
    castShadow: false, // holds the +1 draw gate (renderer.info counts shadow draws)
    halfW: 0.7, // collect x half-size (crate + grace)
    zHalf: 0.5, // collect z-window half-depth
    // Runner half-sizes in the collect test (obstacles use 0.35/0.3; pickup
    // windows are deliberately magnetic — a strafing near-miss should pay).
    playerHalfW: 0.45,
    playerHalfD: 0.45,
    jitter: 0.22, // visual-only per-instance yaw jitter (rad, slot-derived)
    pulse: {
      dusk: { min: 0.5, max: 1.05 }, // HDR peak ~0.56 — under bloom threshold
      night: { min: 0.85, max: 2.1 }, // beacon read; rides bloom like eyeshine
      hz: 0.9, // breath cycles/s
    },
  },

  // Particles (entities/particles.js, task 3.3 — ring-allocation + the 1-draw
  // count/spread/tone trade documented there): ONE pooled additive Points
  // system, CPU-integrated per fixed step, no rng (slot streams).
  PARTICLES: {
    max: 384,
    size: 0.3, // world-unit sprite (sizeAttenuation on, dustDot texture)
    renderOrder: 2, // with the dust motes, after opaque
    gravity: 5.5, // m/s^2
    drag: 1.6, // 1/s exponential velocity damping
    bounceY: 0.03, // ground plane sparks bounce off (m above the road)
    bounce: 0.35, // vertical restitution kept on that bounce
    jitterY: 0.12, // per-point spawn-height scatter inside a burst (m)
    types: {
      pickup: { // small amber spark burst at the collect point
        y: 0.35, // burst origin height (the crate's emissive band)
        count: 12, spread: 0.55, speed: [1.2, 2.6], up: 1.6, ttl: [0.35, 0.7],
        colors: [[1.9, 1.25, 0.55], [1.5, 0.9, 0.38]], // HDR amber (bloom pops)
      },
      death: { // larger dark burst: crimson embers + thrown dust
        y: 0.5, // burst origin height (runner chest)
        count: 30, spread: 0.85, speed: [2.0, 4.5], up: 2.8, ttl: [0.5, 1.0],
        colors: [[0.85, 0.16, 0.1], [0.5, 0.12, 0.09], [0.42, 0.36, 0.3]],
      },
    },
  },

  // Player runner (entities/player.js, run-core-loop task 3.4): the ONE
  // hierarchical character (real Group rig — design decision 5). The MODE
  // writes player.z per fixed step + passes speed (cadence only); the player
  // owns x/y/cadence/pose. Full semantics: 3.4 report + the module header.
  PLAYER: {
    castShadow: true, // hero grounding; +11 shadow draws (3.4 A/B) — flip for budget
    stride: 1.35, // m per gait cycle — cadence = speed/stride
    gaitHz: [1.9, 3.1], // cadence clamp (cycles/s); speed 0 rests mid-band
    laneChangeTime: 0.16, // s eased per lane step (smoothstep)
    laneLean: 0.22, // rad roll into a lane change
    jump: { v0: 5.6, gravity: 15.5 }, // apex v0^2/2g ~1.01 m, air ~0.72 s
    slideTime: 0.7, // s the slide profile holds
    poseEase: 12, // 1/s blend of lean + jump/slide/dead pose weights
    // Collide y-heights — the ONE source (4.4 fold): the mode passes the live
    // values; obstacles.collide()'s QA-mock default reads standTop here.
    profile: { standTop: 1.75, jumpTop: 1.0, slideTop: 0.85 },
    pose: { // run cycle + action pose targets (rad/m; authored beside the rig)
      legAmp: 0.85, kneeAmp: 1.2, kneeBase: 0.22, armAmp: 0.8, armFwd: 0.3,
      bob: 0.05, leanFwd: 0.24, sway: 0.055, headCounter: 0.45,
      tuck: { hip: 0.05, leg: -1.05, knee: 1.75, arm: -2.0, lean: -0.14 },
      slide: { hip: 0.44, leg: -1.3, knee: 0.85, arm: 0.85, lean: -0.6 },
      dead: { hip: 0.3, lean: 1.2 },
    },
  },

  // RUN mode (modes/run.js, run-core-loop task 4.3): the mode owns the focus
  // z (== player z), advances it at the ramped speed and reports death to the
  // shell. The ramp is STEPWISE (spec: "increases stepwise") — a pure
  // function of distance covered, so ?seed=/time= runs stay deterministic.
  RUN: {
    // Matches CRUISE.run so the staged-gameover defaults (round(CRUISE × t),
    // tasks 2.2/2.4 evidence) and the 4.2 preview ledger stay exact at the
    // base step.
    speedStart: 7.5, // m/s at 0 m
    speedStep: 0.6, // m/s added per step of the table below
    stepDist: 250, // metres covered per ramp step
    speedMax: 11.7, // m/s cap — reached at 1750 m (~3 min live)
    // Zombie contact (spec: same lane at ground level ends the run):
    // radial check vs the live profile x/z (~0.5 m body + arms read).
    contactR: 0.6, // m — precomputed squared in run.js
    // Jump evasion (spec: "changes lanes or jumps before a lunging zombie
    // makes contact"): a lunge cannot catch feet above this height, so a
    // mid-arc profile.y0 >= evadeY misses. Landing ON a zombie still kills
    // (y0 ~ 0 at the arc ends).
    evadeY: 0.5, // m
    // Live-world settle between die() and shell endRun(): the crumple pose
    // eases in (poseEase 12) and the death burst fades while the world still
    // ticks — the gameover reveal then holds a readable death frame instead
    // of a mid-stride freeze. Purely cosmetic delay; stats are final at die().
    deathSettleS: 0.55,
    // Retry respawn runway (task 7.2 E2E fix): retry keeps the seeded layout,
    // so respawning at the death spot re-dies on frame 1 against the very
    // band/pack that killed the run. Retry skips to the next chunk boundary
    // instead — every chunk start carries the spawn geometry's own clear
    // inset (SPAWN.band.edge 6 m, SPAWN.pack.inset 8 m) as free runway.
    retrySkipChunks: 1,
    // Run rig lane-follow (design 2: CONFIG.RIGS.run is the rig; the mode
    // only rides its laneX0 term with the player so edge lanes keep the
    // runner in frame): laneX0 = RIGS.run.laneX0 + player.x × camFollowX.
    camFollowX: 0.65,
  },

  // Dust motes (world/dust.js): warm amber-grey, small, dim, hugging the
  // ground near the camera and faded out by ~35 m — round-3 verdict was
  // "white bokeh dots over road and desert, read as sensor noise". The
  // depth fade (and fog:false on the material) keeps motes from ever
  // dotting the horizon; the tracking box stays inside the fade range.
  DUST: {
    count: 160,
    box: { x: 40, y: 2.2, z: 46 }, // low y band; z spans behind..ahead of camera
    behind: 12, // metres of the box trailing the camera (rest ahead-biased)
    wind: { x: -0.5, z: 0.28 }, // gentle parallax drift
    wander: { x: 0.25, z: 0.22, y: 0.08, rise: 0.045 }, // per-mote sway amplitudes
    yBias: 1.8, // >1 concentrates motes toward the ground on (re)spawn
    fadeStart: 13, // distance where the depth fade begins
    fadeEnd: 35, // fully gone at/beyond this distance (never dots the horizon)
    nearFade: 3, // fade-in completes by this distance (no in-face blobs)
    opacity: 0.35,
    size: 0.22,
    brightness: 0.5, // multiplies the warm amber vertex colors down
  },

  FIXED_DT: 1 / 60,
  MAX_FRAME_DT: 0.1,
  MAX_STEPS_PER_FRAME: 8,
  WARM_FRAMES: 5,
  TIME_CAP: 120,

  SAVE_KEY: "endless.save.v1",
};

export const QUALITY_ORDER = ["low", "medium", "high", "ultra"];

export const QUALITY_PRESETS = {
  low: {
    pixelRatioCap: 1, shadowMapSize: 1024, shadowsEnabled: true,
    texSize: 256, aoMaps: false,
    post: false, bloom: false, grade: false, smaa: false, msaa: 0,
    drawDistance: 150, fogNear: 40, fogFar: 150, nightFogScale: 0.7, dust: 0.5, maxChunksAhead: 5,
  },
  medium: {
    pixelRatioCap: 1.25, shadowMapSize: 1024, shadowsEnabled: true,
    texSize: 256, aoMaps: false,
    post: true, bloom: true, grade: true, smaa: false, msaa: 2,
    drawDistance: 200, fogNear: 55, fogFar: 190, nightFogScale: 0.72, dust: 0.75, maxChunksAhead: 6,
  },
  high: {
    pixelRatioCap: 1.5, shadowMapSize: 2048, shadowsEnabled: true,
    texSize: 512, aoMaps: true,
    post: true, bloom: true, grade: true, smaa: true, msaa: 2,
    drawDistance: 250, fogNear: 65, fogFar: 235, nightFogScale: 0.75, dust: 1, maxChunksAhead: 7,
  },
  ultra: {
    pixelRatioCap: 2, shadowMapSize: 2048, shadowsEnabled: true,
    texSize: 512, aoMaps: true,
    post: true, bloom: true, grade: true, smaa: true, msaa: 4,
    drawDistance: 300, fogNear: 70, fogFar: 270, nightFogScale: 0.78, dust: 1.25, maxChunksAhead: 8,
  },
};

/** Tier autodetect (devicePixelRatio + cores); ?quality= overrides. */
export function detectQualityTier(params) {
  const forced = params && params.get("quality");
  if (forced && QUALITY_ORDER.includes(forced)) return forced;
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  const cores = (typeof navigator !== "undefined" && navigator.hardwareConcurrency) || 4;
  let tier;
  if (dpr >= 2 && cores >= 8) tier = "ultra";
  else if (cores >= 8 || (dpr >= 1.5 && cores >= 4)) tier = "high";
  else if (cores >= 4) tier = "medium";
  else tier = "low";
  return tier;
}

export function getQualityPreset(tier) {
  return QUALITY_PRESETS[tier] || QUALITY_PRESETS.high;
}
