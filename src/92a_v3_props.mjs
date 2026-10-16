// ===== the weapon models, built to be RENDERED, not drawn =====
//
// Duane, 2026-10-14: *"make it like counterstrike / fortnight. make them realistic and super
// detailed"*. So every item here is real geometry with real materials -- metal that is metal,
// rubber that is rough, glass that is transmissive -- lit by a studio rig and baked to a PNG. That
// is literally how Apex and CS2 make their store art, and it is why theirs reads expensive.
//
// Rules for anything added here:
//  * NO flat colour. Every material gets metalness + roughness that mean something.
//  * Bevel the silhouette. Sharp 90-degree edges read as "untextured box"; a chamfer catches the
//    key light and is most of what makes a render look finished.
//  * Build at roughly 1 unit = 1 metre and let the harness frame it; do not hand-tune scale.
//  * Point the long axis along +X. The harness turns everything to a three-quarter view, which is
//    the angle Apex uses for every weapon because the silhouette reads and the light runs along it.
// Lives in src/ (not dev/) because BOTH the store bake and the live 3D fight build their props
// from it. It used to sit in dev/itemforge/, which is why every set-3 weapon rendered in a match as
// a white icosahedron: the game had no model for any of them and fell through to the stand-in.
export function buildModels(THREE) {
  const M = {};

  // ---- the material library: a small palette, used consistently, so 21 objects look like one set
  const mat = (o) => new THREE.MeshStandardMaterial(o);
  const phys = (o) => new THREE.MeshPhysicalMaterial(o);
  // Palette, 15 Oct: pulled down to Counter-Strike. The first pass was toy-coloured -- cream bats,
  // pale orange rifle furniture, baby-blue blasters -- and against a page of CS2 skins it read as a
  // children's playset. CS2 weapons live in a narrow, dark band: blued steel, black polymer, walnut,
  // and ONE saturated accent per weapon. Everything below is darker and less saturated than it was.
  const PAL = {
    gunmetal:  () => mat({ color: 0x1c2026, metalness: 1, roughness: 0.42 }),   // was 0x2a2f38
    steel:     () => mat({ color: 0x7c8694, metalness: 1, roughness: 0.28 }),
    darksteel: () => mat({ color: 0x323841, metalness: 1, roughness: 0.34 }),
    blued:     () => mat({ color: 0x14181e, metalness: 1, roughness: 0.3 }),    // blued gun steel
    chrome:    () => mat({ color: 0xd6dde8, metalness: 1, roughness: 0.08 }),
    gold:      () => mat({ color: 0xe0a82e, metalness: 1, roughness: 0.2 }),
    brass:     () => mat({ color: 0xa8812f, metalness: 1, roughness: 0.3 }),
    copper:    () => mat({ color: 0x9c5a28, metalness: 1, roughness: 0.34 }),
    rubber:    () => mat({ color: 0x0f1216, metalness: 0, roughness: 0.94 }),
    plastic:   (c) => mat({ color: c, metalness: 0, roughness: 0.52 }),
    polymer:   (c = 0x16191e) => mat({ color: c, metalness: 0.05, roughness: 0.68 }),  // matte furniture
    grip:      () => mat({ color: 0x14171c, metalness: 0.1, roughness: 0.82 }),
    wood:      () => mat({ color: 0x4a2f19, metalness: 0, roughness: 0.66 }),   // walnut, was tan
    woodlite:  () => mat({ color: 0x6b4423, metalness: 0, roughness: 0.62 }),
    glass:     (c) => phys({ color: c, metalness: 0, roughness: 0.06, transmission: 0.92, thickness: 0.4, ior: 1.45 }),
    emissive:  (c, i = 2.0) => mat({ color: c, emissive: c, emissiveIntensity: i, roughness: 0.3, metalness: 0 }),
    hazard:    () => mat({ color: 0xd4891a, metalness: 0.2, roughness: 0.5 }),
  };

  // ---------------------------------------------------------------- procedural surface
  // Studying the CS2 Sport Gloves (15 Oct) against our own renders, the gap on soft goods was never
  // polygon count. It was three things, in this order:
  //   1. PANEL SEAMS with raised piping. A CS2 glove is a dozen small panels with a welt between
  //      each; the welts catch the key light and are what give the object its form.
  //   2. MATERIAL CONTRAST INSIDE ONE OBJECT -- glossy leather next to matte fabric.
  //   3. a mottled GRAIN so no surface is a flat field of one colour.
  // (1) and (2) are geometry and materials, below in each model. (3) is this: a canvas-generated
  // grain used as a roughness map, which is the cheapest way to stop a surface reading as plastic.
  const texCache = {};
  const grainTex = (key, draw) => {
    if (texCache[key]) return texCache[key];
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const x = c.getContext('2d');
    draw(x, 256);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return (texCache[key] = t);
  };
  // leather: fine mottle plus a few long creases
  const leatherRough = () => grainTex('leather', (x, S) => {
    x.fillStyle = '#9a9a9a'; x.fillRect(0, 0, S, S);
    for (let i = 0; i < 9000; i++) {
      const v = 120 + Math.random() * 110;
      x.fillStyle = `rgba(${v},${v},${v},0.5)`;
      x.fillRect(Math.random() * S, Math.random() * S, 1.6, 1.6);
    }
    x.strokeStyle = 'rgba(70,70,70,0.35)'; x.lineWidth = 1.2;
    for (let i = 0; i < 26; i++) {
      x.beginPath();
      let px = Math.random() * S, py = Math.random() * S;
      x.moveTo(px, py);
      for (let k = 0; k < 5; k++) { px += (Math.random() - 0.5) * 70; py += (Math.random() - 0.5) * 70; x.lineTo(px, py); }
      x.stroke();
    }
  });
  // canvas/fabric: a visible weave
  const weaveRough = () => grainTex('weave', (x, S) => {
    x.fillStyle = '#8e8e8e'; x.fillRect(0, 0, S, S);
    for (let i = 0; i < S; i += 4) {
      x.fillStyle = i % 8 ? 'rgba(170,170,170,0.5)' : 'rgba(90,90,90,0.5)';
      x.fillRect(i, 0, 2, S); x.fillRect(0, i, S, 2);
    }
    for (let i = 0; i < 4000; i++) {
      const v = 110 + Math.random() * 120; x.fillStyle = `rgba(${v},${v},${v},0.4)`;
      x.fillRect(Math.random() * S, Math.random() * S, 1.4, 1.4);
    }
  });
  // a material that actually has a surface, rather than a flat colour
  const hide = (color, rough, repeat) => {
    const m = mat({ color, metalness: 0.06, roughness: rough == null ? 0.72 : rough });
    const t = leatherRough(); t.repeat.set(repeat || 3, repeat || 3);
    m.roughnessMap = t; m.bumpMap = t; m.bumpScale = 0.012;
    return m;
  };
  const cloth = (color, repeat) => {
    const m = mat({ color, metalness: 0, roughness: 0.86 });
    const t = weaveRough(); t.repeat.set(repeat || 4, repeat || 4);
    m.roughnessMap = t; m.bumpMap = t; m.bumpScale = 0.01;
    return m;
  };
  // a raised welt: the thin piped seam between two panels, which is what CS2 leans on hardest
  const welt = (grp, material, pts, r) => {
    const c = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p)));
    put(grp, new THREE.TubeGeometry(c, Math.max(12, pts.length * 6), r || 0.011, 7, false), material, [0, 0, 0]);
  };
  // a row of stitches along a curve
  const stitch = (grp, material, pts, n, r) => {
    const c = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p)));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n, p = c.getPoint(t), tan = c.getTangent(t);
      const g2 = new THREE.BoxGeometry(r || 0.016, 0.006, 0.006);
      const mdl = put(grp, g2, material, [p.x, p.y, p.z]);
      mdl.lookAt(p.x + tan.x, p.y + tan.y, p.z + tan.z);
    }
  };

  // a box with its edges knocked off, which is the single biggest upgrade over a raw BoxGeometry
  const bevelBox = (w, h, d, r = 0.012, seg = 2) => {
    const s = new THREE.Shape();
    const x = w / 2, y = h / 2, k = Math.min(r, x * 0.9, y * 0.9);
    s.moveTo(-x + k, -y);
    s.lineTo(x - k, -y); s.quadraticCurveTo(x, -y, x, -y + k);
    s.lineTo(x, y - k); s.quadraticCurveTo(x, y, x - k, y);
    s.lineTo(-x + k, y); s.quadraticCurveTo(-x, y, -x, y - k);
    s.lineTo(-x, -y + k); s.quadraticCurveTo(-x, -y, -x + k, -y);
    const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: true, bevelThickness: r * 0.6, bevelSize: r * 0.6, bevelSegments: seg, curveSegments: 6 });
    g.translate(0, 0, -d / 2); g.computeVertexNormals();
    return g;
  };
  const cyl = (rt, rb, h, seg = 28) => new THREE.CylinderGeometry(rt, rb, h, seg);
  const put = (grp, geo, material, pos, rot, scale) => {
    const m = new THREE.Mesh(geo, material);
    if (pos) m.position.set(pos[0] || 0, pos[1] || 0, pos[2] || 0);
    if (rot) m.rotation.set(rot[0] || 0, rot[1] || 0, rot[2] || 0);
    if (scale) m.scale.set(scale[0], scale[1], scale[2]);
    m.castShadow = m.receiveShadow = true;
    grp.add(m);
    return m;
  };
  // a barrel with a muzzle lip: the lip is what stops a gun barrel reading as a grey tube
  const barrel = (grp, len, r, material, x) => {
    const b = put(grp, cyl(r, r, len, 24), material, [x, 0, 0], [0, 0, Math.PI / 2]);
    put(grp, cyl(r * 1.22, r * 1.22, len * 0.08, 24), material, [x + len / 2 - len * 0.04, 0, 0], [0, 0, Math.PI / 2]);
    return b;
  };
  // panel lines, the cheap trick that makes a surface read as manufactured rather than extruded
  const seam = (grp, w, x, y, z, material) => put(grp, bevelBox(w, 0.008, 0.004, 0.002), material || PAL.gunmetal(), [x, y, z]);

  // ------------------------------------------------------------------ the arsenal

  M.ak = (g) => {                                     // AK-47
    const body = PAL.gunmetal(), wood = PAL.wood(), steel = PAL.steel(), blk = PAL.grip();
    put(g, bevelBox(0.62, 0.11, 0.07, 0.014), body, [0, 0, 0]);
    put(g, bevelBox(0.3, 0.075, 0.062, 0.012), wood, [-0.42, -0.03, 0], [0, 0, 0.12]);   // stock
    put(g, bevelBox(0.17, 0.07, 0.06, 0.012), wood, [0.12, -0.075, 0], [0, 0, -0.06]);   // handguard
    barrel(g, 0.44, 0.017, steel, 0.42);
    put(g, cyl(0.028, 0.034, 0.1, 20), body, [0.18, 0.07, 0], [0, 0, -0.25]);            // gas block
    // The banana magazine, the one shape that makes an AK an AK -- and it was not reading at all.
    // The offsets were `t * 0.055` with t = i/4, so all five segments landed inside a single
    // 0.055-wide box: the mag came out a lump the size of the trigger guard, in the SAME gunmetal
    // as the receiver, so it vanished into the black body. On the shelf The Chopper then looked
    // like the Street Sweeper with a longer barrel. Step per SEGMENT, and build it in steel so the
    // curve separates from the body at thumbnail size.
    // A STACK OF BOXES CANNOT BE A BANANA. Overlapping and raking them per segment still left a
    // staircase of corners down the back edge at every spacing tried. The curve has to be one
    // extruded profile, the same way the Fire Axe's bit is built -- then the silhouette is a single
    // clean shape and the bevel does the rest.
    const mp = new THREE.Shape();
    mp.moveTo(0, 0);
    mp.lineTo(0.082, 0);
    mp.quadraticCurveTo(0.133, -0.115, 0.168, -0.236);     // front edge, sweeping toward the muzzle
    mp.lineTo(0.086, -0.262);                              // floorplate
    mp.quadraticCurveTo(0.044, -0.12, 0, 0);               // back edge, parallel to it
    const mg = new THREE.ExtrudeGeometry(mp, { depth: 0.054, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 2, curveSegments: 12 });
    mg.translate(0, 0, -0.027); mg.computeVertexNormals();
    put(g, mg, steel, [-0.036, -0.05, 0]);
    put(g, bevelBox(0.098, 0.022, 0.06, 0.006), PAL.darksteel(), [0.093, -0.318, 0], [0, 0, -0.3]);   // floorplate lip
    put(g, bevelBox(0.055, 0.12, 0.05, 0.012), blk, [-0.16, -0.12, 0], [0, 0, 0.22]);    // pistol grip
    put(g, cyl(0.009, 0.009, 0.05, 10), steel, [-0.02, -0.08, 0], [Math.PI / 2, 0, 0]);  // trigger pin
    put(g, bevelBox(0.02, 0.035, 0.012, 0.004), steel, [0.58, 0.045, 0]);                // front sight
    put(g, bevelBox(0.03, 0.025, 0.04, 0.005), body, [-0.2, 0.07, 0]);                   // rear sight
    seam(g, 0.5, 0.02, 0.045, 0.036, PAL.darksteel());
  };

  M.gloves = (g) => {                                 // boxing gloves
    // Third pass, and the lesson is the same one the boot taught: SIMPLER reads better. A boxing
    // glove is one rounded mitt, a cuff and a white lace stripe -- that is the whole silhouette, and
    // adding a separate "punch face" dome just put a slab on the front of it.
    // The base red is much darker than it looks here on purpose: the render rig was brightened on
    // 15 Oct so cosmetics would stop coming out black, and a mid red under that key washes to pink.
    const red   = mat({ color: 0x6d0d14, metalness: 0.1, roughness: 0.36 });
    const redD  = mat({ color: 0x45070d, metalness: 0.1, roughness: 0.42 });
    const cream = mat({ color: 0xd8d2c2, metalness: 0.05, roughness: 0.6 });
    const dark  = mat({ color: 0x171013, metalness: 0.1, roughness: 0.72 });

    const one = (ox, oy, oz, ry, sc) => {
      const b = new THREE.Group();
      // one mitt: a sphere squashed along the forearm, nothing bolted to the front of it
      put(b, new THREE.SphereGeometry(0.33, 36, 26), red, [0.06, 0.02, 0], null, [1.18, 1, 0.95]);
      // the wrist, tapering back from it
      put(b, cyl(0.21, 0.26, 0.3, 28), red, [-0.3, -0.01, 0], [0, 0, Math.PI / 2]);
      // the single seam over the knuckles, which is all the detail it needs
      put(b, new THREE.TorusGeometry(0.235, 0.016, 12, 30), redD, [0.12, 0.02, 0], [0, Math.PI / 2, 0], [1, 1.04, 1]);
      // the white lace stripe and cuff
      put(b, cyl(0.235, 0.235, 0.075, 30), cream, [-0.33, -0.01, 0], [0, 0, Math.PI / 2]);
      put(b, new THREE.TorusGeometry(0.236, 0.022, 12, 30), cream, [-0.37, -0.01, 0], [0, Math.PI / 2, 0]);
      put(b, cyl(0.19, 0.19, 0.05, 26), dark, [-0.42, -0.01, 0], [0, 0, Math.PI / 2]);
      // the thumb, low and to the front
      put(b, new THREE.SphereGeometry(0.115, 22, 16), red, [0.0, -0.17, 0.19], null, [1.4, 1, 1.05]);
      put(b, new THREE.TorusGeometry(0.1, 0.013, 10, 20), redD, [-0.04, -0.16, 0.17], [0.4, 0, 1.2]);
      b.position.set(ox, oy, oz); b.rotation.y = ry; if (sc) b.scale.setScalar(sc);
      return b;
    };
    g.add(one(-0.12, 0.11, -0.28, -0.3, 0.88));
    g.add(one(0.12, -0.09, 0.26, 0.22, 1));
  };
  M.turret = (g) => {                                 // sentry turret
    // Rebuilt 15 Oct against Team Fortress 2's Level 3 sentry, which Duane asked me to copy from a
    // real game. What makes that thing read as dangerous, in order of how much each contributes:
    //   1. TWIN ROTARY BARREL CLUSTERS -- six barrels in a cage, not one rod;
    //   2. a ROCKET POD on top, so it threatens more than one thing;
    //   3. an AMMO DRUM hanging off the side, which is pure visual mass;
    //   4. a WIDE JOINTED TRIPOD with ball feet, so it is planted rather than perched;
    //   5. EXPOSED CABLE BUNDLES, which is what makes it look field-built instead of moulded.
    const gun   = mat({ color: 0x2a2f37, metalness: 0.9, roughness: 0.4 });
    const dark  = mat({ color: 0x15181d, metalness: 0.8, roughness: 0.46 });
    const steel = PAL.steel(), hot = PAL.plastic(0xc0392b), hazard = PAL.plastic(0xe0892a);
    const wire  = (c) => mat({ color: c, metalness: 0.1, roughness: 0.8 });
    const eye   = PAL.emissive(0xff3b3b, 3.6);

    // ---- tripod: three jointed legs, splayed, with ball feet ----
    for (let i = 0; i < 3; i++) {
      const a = i * Math.PI * 2 / 3 + 0.4;
      const dx = Math.cos(a), dz = Math.sin(a);
      put(g, bevelBox(0.1, 0.07, 0.26, 0.018), gun, [dx * 0.12, -0.3, dz * 0.12], [0, -a, 0]);     // hip
      put(g, cyl(0.035, 0.03, 0.34, 12), gun, [dx * 0.3, -0.42, dz * 0.3], [0, -a, 0.72]);          // thigh
      put(g, new THREE.SphereGeometry(0.05, 16, 12), steel, [dx * 0.45, -0.54, dz * 0.45]);         // knee
      put(g, cyl(0.026, 0.034, 0.3, 12), gun, [dx * 0.56, -0.68, dz * 0.56], [0, -a, -0.38]);       // shin
      put(g, new THREE.SphereGeometry(0.062, 18, 14), dark, [dx * 0.64, -0.83, dz * 0.64]);         // ball foot
      put(g, bevelBox(0.12, 0.03, 0.1, 0.012), steel, [dx * 0.64, -0.86, dz * 0.64], [0, -a, 0]);
    }
    put(g, cyl(0.1, 0.13, 0.3, 24), gun, [0, -0.3, 0]);                                            // column
    for (let i = 0; i < 3; i++) put(g, new THREE.TorusGeometry(0.105, 0.015, 10, 26), dark, [0, -0.22 - i * 0.07, 0], [Math.PI / 2, 0, 0]);

    // ---- turntable and the body it carries ----
    put(g, cyl(0.19, 0.19, 0.07, 30), dark, [0, -0.11, 0]);
    put(g, new THREE.TorusGeometry(0.19, 0.022, 12, 32), steel, [0, -0.09, 0], [Math.PI / 2, 0, 0]);
    put(g, bevelBox(0.34, 0.26, 0.3, 0.035), gun, [0, 0.06, 0]);
    put(g, bevelBox(0.3, 0.05, 0.26, 0.016), hazard, [0, 0.19, 0]);                                 // hazard cap
    for (let i = 0; i < 4; i++) put(g, new THREE.SphereGeometry(0.018, 10, 8), steel, [-0.12 + i * 0.08, 0.215, 0.1]);
    // the sensor, set back in a hood so it reads as an eye
    put(g, bevelBox(0.1, 0.1, 0.13, 0.02), dark, [0.16, 0.12, 0]);
    put(g, new THREE.SphereGeometry(0.042, 20, 14), eye, [0.21, 0.12, 0]);
    put(g, new THREE.TorusGeometry(0.046, 0.012, 8, 20), steel, [0.212, 0.12, 0], [0, Math.PI / 2, 0]);

    // ---- (1) twin rotary barrel clusters ----
    const cluster = (z) => {
      const c = new THREE.Group();
      put(c, cyl(0.072, 0.072, 0.12, 22), dark, [0, 0, 0], [0, 0, Math.PI / 2]);                    // breech
      for (let b = 0; b < 6; b++) {                                                                 // six barrels
        const a = b / 6 * Math.PI * 2;
        put(c, cyl(0.019, 0.019, 0.46, 12), gun, [0.26, Math.cos(a) * 0.042, Math.sin(a) * 0.042], [0, 0, Math.PI / 2]);
        put(c, new THREE.TorusGeometry(0.021, 0.006, 6, 12), steel, [0.47, Math.cos(a) * 0.042, Math.sin(a) * 0.042], [0, Math.PI / 2, 0]);
      }
      put(c, cyl(0.055, 0.055, 0.04, 20), steel, [0.12, 0, 0], [0, 0, Math.PI / 2]);
      for (const x of [0.22, 0.38]) put(c, new THREE.TorusGeometry(0.066, 0.012, 10, 22), dark, [x, 0, 0], [0, Math.PI / 2, 0]);  // the cage rings
      for (let k = 0; k < 4; k++) { const a = k / 4 * Math.PI * 2 + 0.4;
        put(c, cyl(0.008, 0.008, 0.2, 8), dark, [0.3, Math.cos(a) * 0.064, Math.sin(a) * 0.064], [0, 0, Math.PI / 2]); }
      put(c, cyl(0.08, 0.062, 0.06, 20), steel, [0.5, 0, 0], [0, 0, Math.PI / 2]);                  // muzzle ring
      c.position.set(0.13, 0.03, z);
      return c;
    };
    g.add(cluster(-0.11)); g.add(cluster(0.11));

    // ---- (2) rocket pod on top ----
    put(g, bevelBox(0.17, 0.14, 0.26, 0.022), hot, [-0.02, 0.28, 0]);
    for (let i = 0; i < 4; i++) put(g, cyl(0.036, 0.036, 0.05, 16), dark, [0.06, 0.31 - (i % 2) * 0.055, -0.065 + Math.floor(i / 2) * 0.13], [0, 0, Math.PI / 2]);
    put(g, bevelBox(0.03, 0.15, 0.27, 0.01), dark, [-0.1, 0.28, 0]);

    // ---- (3) ammo drum ----
    put(g, cyl(0.17, 0.17, 0.13, 30), hot, [-0.2, 0.0, 0.0], [Math.PI / 2, 0, 0]);
    put(g, new THREE.TorusGeometry(0.17, 0.022, 12, 32), dark, [-0.2, 0, 0], [0, 0, 0]);
    put(g, cyl(0.05, 0.05, 0.145, 20), dark, [-0.2, 0, 0], [Math.PI / 2, 0, 0]);
    for (let i = 0; i < 3; i++) { const a = i / 3 * Math.PI * 2;
      put(g, bevelBox(0.09, 0.03, 0.15, 0.008), dark, [-0.2 + Math.cos(a) * 0.1, Math.sin(a) * 0.1, 0], [0, 0, a]); }

    // ---- (5) cable bundles, the field-built look ----
    const run = (p0, p1, p2, col, r) => put(g, new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3([new THREE.Vector3(...p0), new THREE.Vector3(...p1), new THREE.Vector3(...p2)]), 22, r, 7, false), wire(col), [0, 0, 0]);
    run([-0.16, 0.14, 0.12], [-0.3, 0.02, 0.2], [-0.2, -0.12, 0.14], 0xd06020, 0.013);
    run([-0.16, 0.1, 0.15], [-0.32, -0.04, 0.22], [-0.18, -0.16, 0.16], 0x2f6aff, 0.011);
    run([-0.16, 0.06, -0.13], [-0.3, -0.06, -0.2], [-0.16, -0.18, -0.12], 0xd8d2c0, 0.011);
  };
  M.zip = (g) => {                                    // zip hook
    const steel = PAL.chrome(), body = mat({ color: 0x5d6673, metalness: 0.9, roughness: 0.32 });
    const accent = PAL.hazard(), rope = mat({ color: 0xcdbf9c, metalness: 0, roughness: 0.85 });
    // launcher body, lighter than before so it is not a black hole in the corner of the card
    put(g, bevelBox(0.2, 0.115, 0.095, 0.022), body, [-0.2, 0, 0]);
    put(g, bevelBox(0.07, 0.03, 0.1, 0.008), accent, [-0.2, 0.07, 0]);
    put(g, bevelBox(0.05, 0.115, 0.045, 0.012), PAL.grip(), [-0.25, -0.1, 0], [0, 0, 0.12]);
    put(g, new THREE.TorusGeometry(0.036, 0.009, 8, 20), body, [-0.17, -0.07, 0], [0, Math.PI / 2, 0]);
    put(g, cyl(0.062, 0.062, 0.07, 24), PAL.darksteel(), [-0.2, 0.01, 0], [Math.PI / 2, 0, 0]);
    put(g, new THREE.TorusGeometry(0.062, 0.01, 10, 26), accent, [-0.2, 0.01, 0.038], [0, 0, 0]);
    // the line, drawn taut and visible
    const line = new THREE.CatmullRomCurve3([new THREE.Vector3(-0.11, 0.02, 0), new THREE.Vector3(0.02, 0.07, 0), new THREE.Vector3(0.14, 0.06, 0)]);
    put(g, new THREE.TubeGeometry(line, 30, 0.012, 8, false), rope, [0, 0, 0]);
    // a big, bright, clearly-hooked hook
    const hk = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.14, 0.06, 0), new THREE.Vector3(0.3, 0.07, 0), new THREE.Vector3(0.42, -0.02, 0),
      new THREE.Vector3(0.4, -0.17, 0), new THREE.Vector3(0.26, -0.21, 0), new THREE.Vector3(0.17, -0.13, 0)]);
    put(g, new THREE.TubeGeometry(hk, 60, 0.028, 14, false), steel, [0, 0, 0]);
    put(g, new THREE.ConeGeometry(0.038, 0.1, 18), steel, [0.14, -0.08, 0], [0, 0, 2.3]);     // barb
    put(g, new THREE.TorusGeometry(0.03, 0.009, 8, 20), accent, [0.16, 0.06, 0], [0, Math.PI / 2, 0]);
  };

  M.boots = (g) => {                                  // nitro boots
    // Two things learned the hard way, combined: the BOOT comes from an extruded side profile (two
    // stacked boxes never read as footwear, proved repeatedly on Steel Toes), and everything that
    // says ROCKET comes from TF2's Thermal Thruster -- a pod with a cone tip, checkered hazard
    // bands, a lit pressure gauge and a flared exhaust nozzle.
    const shell = mat({ color: 0xb4461c, metalness: 0.3, roughness: 0.5 });
    const shellD = mat({ color: 0x8a3414, metalness: 0.32, roughness: 0.56 });
    const dark = mat({ color: 0x1b1e23, metalness: 0.5, roughness: 0.52 });
    const steel = PAL.steel(), brass = PAL.brass();
    const check = mat({ color: 0xe8e2d4, metalness: 0.1, roughness: 0.7 });
    const flame = PAL.emissive(0x4fc8ff, 2.8), gauge = PAL.emissive(0xffd24a, 2.2);
    const sole = PAL.rubber();

    const prof = () => {
      const p = new THREE.Shape();
      p.moveTo(-0.3, 0.03);
      p.lineTo(-0.3, 0.42);
      p.quadraticCurveTo(-0.29, 0.5, -0.2, 0.5);
      p.lineTo(-0.1, 0.48);
      p.quadraticCurveTo(-0.02, 0.46, 0.0, 0.32);
      p.quadraticCurveTo(0.04, 0.18, 0.22, 0.11);
      p.quadraticCurveTo(0.36, 0.07, 0.38, 0.03);
      p.lineTo(-0.3, 0.03);
      return p;
    };
    const one = (ox, oz, ry, sc) => {
      const b = new THREE.Group();
      const geo = new THREE.ExtrudeGeometry(prof(), {
        depth: 0.22, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 4, curveSegments: 18 });
      geo.translate(0, 0, -0.11); geo.computeVertexNormals();
      put(b, geo, shell, [0, 0, 0]);
      // toe cap and sole
      put(b, bevelBox(0.17, 0.09, 0.235, 0.02), shellD, [0.28, 0.07, 0]);
      put(b, bevelBox(0.74, 0.055, 0.25, 0.022), sole, [0.03, 0.0, 0]);
      for (let i = 0; i < 6; i++) put(b, bevelBox(0.055, 0.028, 0.26, 0.009), sole, [-0.2 + i * 0.1, -0.03, 0]);
      // ---- the Thruster's checkered hazard band, across the instep where it shows ----
      for (let i = 0; i < 7; i++)
        put(b, bevelBox(0.05, 0.05, 0.236, 0.007), i % 2 ? check : dark, [-0.16 + i * 0.052, 0.3, 0], [0, 0, -0.42]);
      // ---- the rocket pod on the heel ----
      const pod = new THREE.Group();
      put(pod, cyl(0.095, 0.095, 0.3, 24), shellD, [0, 0, 0], [0, 0, Math.PI / 2]);
      put(pod, new THREE.ConeGeometry(0.095, 0.15, 24), shell, [0.21, 0, 0], [0, 0, -Math.PI / 2]);
      for (const x of [-0.09, 0.07]) put(pod, new THREE.TorusGeometry(0.098, 0.015, 10, 26), dark, [x, 0, 0], [0, Math.PI / 2, 0]);
      put(pod, cyl(0.1, 0.08, 0.1, 24), dark, [-0.2, 0, 0], [0, 0, Math.PI / 2]);
      put(pod, new THREE.TorusGeometry(0.084, 0.013, 10, 24), steel, [-0.24, 0, 0], [0, Math.PI / 2, 0]);
      put(pod, new THREE.ConeGeometry(0.066, 0.22, 18, 1, true), flame, [-0.36, 0, 0], [0, 0, Math.PI / 2]);
      for (let i = 0; i < 3; i++) put(pod, bevelBox(0.018, 0.045, 0.028, 0.005), check, [-0.01 + i * 0.028, 0.098, 0]);
      pod.position.set(-0.34, 0.2, 0); pod.rotation.z = 0.14;
      b.add(pod);
      // ---- pressure gauge on the ankle ----
      put(b, cyl(0.06, 0.06, 0.04, 20), dark, [-0.17, 0.44, 0.1], [Math.PI / 2, 0, 0]);
      put(b, cyl(0.046, 0.046, 0.016, 20), gauge, [-0.17, 0.44, 0.124], [Math.PI / 2, 0, 0]);
      put(b, new THREE.TorusGeometry(0.061, 0.011, 10, 22), brass, [-0.17, 0.44, 0.11], [0, 0, 0]);
      put(b, bevelBox(0.035, 0.007, 0.007, 0.002), dark, [-0.163, 0.447, 0.133], [0, 0, 0.8]);
      // straps, buckles, fuel line
      for (const x of [-0.04, 0.14]) {
        put(b, bevelBox(0.045, 0.24, 0.245, 0.01), dark, [x, 0.17, 0]);
        put(b, bevelBox(0.055, 0.055, 0.045, 0.01), steel, [x, 0.17, 0.126]);
      }
      put(b, cyl(0.018, 0.018, 0.24, 12), dark, [-0.08, 0.36, 0], [Math.PI / 2, 0, 0.2]);
      b.position.set(ox, 0, oz); b.rotation.y = ry; if (sc) b.scale.setScalar(sc);
      return b;
    };
    g.add(one(-0.06, -0.3, -0.1, 0.9));
    g.add(one(0.05, 0.3, 0.08, 1));
  };
  M.bat = (g) => {                                    // slugger
    // Audit 15 Oct: read as a cone/horn. A real bat is barely conical -- a thin handle, a long
    // gentle swell, then a nearly PARALLEL barrel and a rounded cap. The old profile flared all the
    // way to the end, which is what made it a traffic cone.
    const wood = mat({ color: 0x8a6334, metalness: 0, roughness: 0.56 });
    const dark = mat({ color: 0x4a3119, metalness: 0, roughness: 0.62 });
    const tape = PAL.grip(), steel = PAL.steel();
    const pts = [];
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      // handle -> knob swell -> taper -> barrel that stays near-parallel
      let r;
      if (t < 0.1) r = 0.034 - t * 0.06;
      else if (t < 0.46) r = 0.028 + Math.pow((t - 0.1) / 0.36, 1.5) * 0.045;
      else r = 0.073 + (t - 0.46) * 0.022;
      pts.push(new THREE.Vector2(Math.max(r, 0.02), -0.46 + t * 0.92));
    }
    pts.push(new THREE.Vector2(0.088, 0.47), new THREE.Vector2(0.07, 0.487), new THREE.Vector2(0, 0.492));
    const lathe = new THREE.LatheGeometry(pts, 40);
    put(g, lathe, wood, [0, 0, 0], [0, 0, -Math.PI / 2]);
    put(g, cyl(0.046, 0.034, 0.05, 22), dark, [-0.47, 0, 0], [0, 0, Math.PI / 2]);        // knob
    for (let i = 0; i < 12; i++) put(g, new THREE.TorusGeometry(0.03 + i * 0.0007, 0.0075, 8, 22), tape, [-0.41 + i * 0.022, 0, 0], [0, Math.PI / 2, 0]);
    for (let i = 0; i < 5; i++) put(g, new THREE.TorusGeometry(0.076 + i * 0.004, 0.003, 6, 26), dark, [0.1 + i * 0.07, 0, 0], [0, Math.PI / 2, 0]);
    put(g, bevelBox(0.1, 0.03, 0.004, 0.002), dark, [0.18, 0.066, 0]);                     // brand stamp
    put(g, new THREE.TorusGeometry(0.047, 0.006, 8, 24), steel, [-0.44, 0, 0], [0, Math.PI / 2, 0]);
  };
  M.blaster = (g) => {                                // blasters (a pair)
    const body = PAL.polymer(0x23272e), accent = PAL.plastic(0xd4541e), dark = PAL.gunmetal();
    const one = (oy, oz, ry, rz) => {
      const p = new THREE.Group();
      put(p, bevelBox(0.24, 0.085, 0.07, 0.018), body, [0, 0, 0]);
      put(p, bevelBox(0.1, 0.03, 0.055, 0.008), accent, [0.02, 0.055, 0]);
      barrel(p, 0.17, 0.021, dark, 0.2);
      put(p, new THREE.TorusGeometry(0.03, 0.008, 10, 22), accent, [0.24, 0, 0], [0, Math.PI / 2, 0]);
      put(p, new THREE.SphereGeometry(0.022, 16, 12), PAL.emissive(0x6fd8ff, 2.6), [0.29, 0, 0]);
      put(p, bevelBox(0.05, 0.11, 0.045, 0.012), PAL.grip(), [-0.07, -0.09, 0], [0, 0, 0.14]);
      put(p, new THREE.TorusGeometry(0.028, 0.007, 8, 18), dark, [-0.01, -0.062, 0], [0, Math.PI / 2, 0]);
      put(p, cyl(0.026, 0.026, 0.05, 18), accent, [-0.08, 0.02, 0], [Math.PI / 2, 0, 0]);   // cell
      p.position.set(0, oy, oz); p.rotation.y = ry; p.rotation.z = rz;
      return p;
    };
    g.add(one(0.09, 0.12, -0.3, 0.1));
    g.add(one(-0.1, -0.11, 0.34, -0.08));
  };


  // M.deagle lived here until 16 Oct and is gone on purpose: the Desert Eagle is a real downloaded
  // model now (assets/item_deagle_glb.wasm, wired in PROP_SPEC) instead of forty hand-placed boxes,
  // and the store card is baked from that same file by dev/itemforge/forge.html.

  M.medkit = (g) => {                                 // med kit
    // The cross goes on the LID as well as the front. At the store's three-quarter angle the front
    // face is barely visible, and a med kit whose cross you cannot see is just a white box -- which
    // is exactly what the first bake produced.
    const white = mat({ color: 0xdfe4ea, metalness: 0, roughness: 0.44 });
    const grey = mat({ color: 0x97a1ad, metalness: 0.1, roughness: 0.5 });
    const green = mat({ color: 0x1f9b50, metalness: 0.05, roughness: 0.4 });
    const dark = PAL.grip();
    put(g, bevelBox(0.4, 0.17, 0.26, 0.03), white, [0, -0.06, 0]);                 // body
    put(g, bevelBox(0.41, 0.11, 0.27, 0.028), grey, [0, 0.07, 0]);                 // lid
    put(g, bevelBox(0.415, 0.02, 0.275, 0.008), dark, [0, 0.012, 0]);              // the seam between them
    // cross on the lid, standing proud so it catches the key light
    put(g, bevelBox(0.07, 0.03, 0.2, 0.01), green, [0, 0.128, 0]);
    put(g, bevelBox(0.2, 0.03, 0.07, 0.01), green, [0, 0.128, 0]);
    // and on the front face, pushed clear of the shell
    put(g, bevelBox(0.055, 0.016, 0.125, 0.006), green, [0, -0.06, 0.138], [Math.PI / 2, 0, 0]);
    put(g, bevelBox(0.125, 0.016, 0.055, 0.006), green, [0, -0.06, 0.138], [Math.PI / 2, 0, 0]);
    put(g, new THREE.TorusGeometry(0.062, 0.017, 10, 24, Math.PI), dark, [0, 0.125, 0], [0, 0, 0]);   // handle
    for (const x of [-0.145, 0.145]) {
      put(g, bevelBox(0.04, 0.06, 0.035, 0.008), grey, [x, 0.02, 0.135]);
      put(g, bevelBox(0.026, 0.02, 0.02, 0.004), dark, [x, 0.0, 0.15]);
    }
    for (const x of [-0.15, 0.15]) put(g, bevelBox(0.02, 0.14, 0.22, 0.006), grey, [x, -0.06, 0]);   // corner ribs
  };

  // Per-item view. The default three-quarter works for most things, but some shapes are only
  // legible from one angle: a boot is its profile, a peel is seen from above. Overrides are in
  // radians and replace the default rotation for that item.
  // ================= THE REPLACEMENTS, 15 OCT =================
  // Street hardware, because Brawl Street is a fight on a street. Industrial materials only: mild
  // steel, rust, galvanised zinc, cast iron, hazard paint. Nothing fantasy, nothing cartoon.

  M.rebar = (g) => {                                  // rebar: Brawlhalla's spear, as site steel
    const rust = mat({ color: 0x8a4a26, metalness: 0.85, roughness: 0.72 });
    const dark = mat({ color: 0x5c3a22, metalness: 0.8, roughness: 0.8 });
    put(g, cyl(0.026, 0.026, 1.0, 20), rust, [0, 0, 0], [0, 0, Math.PI / 2]);
    // the deformed ribs that make rebar rebar: a double helix of short bars up the shaft
    for (let i = 0; i < 34; i++) {
      const x = -0.47 + i * 0.028, a = i * 0.9;
      put(g, bevelBox(0.016, 0.009, 0.062, 0.003), dark, [x, 0, 0], [a, 0, 0]);
    }
    for (const x of [-0.5, 0.5]) put(g, cyl(0.03, 0.026, 0.03, 18), dark, [x, 0, 0], [0, 0, Math.PI / 2]);
    put(g, new THREE.TorusGeometry(0.03, 0.009, 8, 20), PAL.hazard(), [0.3, 0, 0], [0, Math.PI / 2, 0]);  // paint mark
  };

  M.fireaxe = (g) => {                                // fire axe: Brawlhalla's axe, off a stairwell
    const head = mat({ color: 0x4e565f, metalness: 1, roughness: 0.34 });
    const edge = PAL.chrome(), red = mat({ color: 0xa8231c, metalness: 0.1, roughness: 0.5 });
    const grip = PAL.grip();
    // the bit: a wedge, not a box
    const bit = new THREE.Shape();
    bit.moveTo(0, -0.16); bit.lineTo(0.2, -0.2); bit.lineTo(0.26, 0); bit.lineTo(0.2, 0.2); bit.lineTo(0, 0.16);
    const bg = new THREE.ExtrudeGeometry(bit, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 2, curveSegments: 4 });
    bg.translate(0, 0, -0.025); bg.computeVertexNormals();
    put(g, bg, head, [0.14, 0, 0]);
    put(g, bevelBox(0.03, 0.34, 0.052, 0.008), edge, [0.395, 0, 0]);         // the ground edge
    put(g, new THREE.ConeGeometry(0.05, 0.19, 4), head, [0.03, 0, 0], [0, Math.PI / 4, Math.PI / 2]);  // the pick
    put(g, cyl(0.032, 0.038, 0.78, 20), red, [-0.22, 0, 0], [0, 0, Math.PI / 2]);
    for (let i = 0; i < 7; i++) put(g, new THREE.TorusGeometry(0.037, 0.008, 8, 18), grip, [-0.42 - i * 0.03, 0, 0], [0, Math.PI / 2, 0]);
    put(g, cyl(0.042, 0.034, 0.04, 16), head, [-0.61, 0, 0], [0, 0, Math.PI / 2]);
  };

  // M.nailgun was hand-built here and is gone 16 Oct: it is a downloaded model now
  // (PROP_SPEC in src/92_v3_items.mjs), and the card is baked from that same file.

  M.buzzsaw = (g) => {                                // buzzsaw: the blade off a cut-off saw
    // A circular blade is recognised by its TEETH and the slots cut between them, not by being a
    // disc, so both are real geometry: 22 carbide teeth around the rim and six expansion slots,
    // over a worn steel plate with a hub and an arbour hole.
    const steel = mat({ color: 0x9aa4b0, metalness: 1, roughness: 0.3 });
    const plate = mat({ color: 0x7e8794, metalness: 1, roughness: 0.42 });
    const dark = PAL.gunmetal(), rust = mat({ color: 0x7a4426, metalness: 0.8, roughness: 0.78 });
    const carbide = mat({ color: 0xd8dde4, metalness: 1, roughness: 0.16 });
    const R = 0.34;
    put(g, cyl(R, R, 0.022, 48), plate, [0, 0, 0], [Math.PI / 2, 0, 0]);          // the blade body
    put(g, new THREE.TorusGeometry(R * 0.96, 0.012, 8, 48), steel, [0, 0, 0]);    // rim band
    for (let i = 0; i < 22; i++) {                                               // teeth
      const a = (i / 22) * Math.PI * 2;
      put(g, bevelBox(0.055, 0.03, 0.032, 0.004), carbide,
        [Math.cos(a) * (R + 0.012), Math.sin(a) * (R + 0.012), 0], [0, 0, a + 0.42]);
    }
    for (let i = 0; i < 6; i++) {                                                // expansion slots
      const a = (i / 6) * Math.PI * 2 + 0.3;
      put(g, bevelBox(0.11, 0.022, 0.03, 0.003), dark,
        [Math.cos(a) * R * 0.66, Math.sin(a) * R * 0.66, 0], [0, 0, a]);
      put(g, cyl(0.022, 0.022, 0.03, 12), dark, [Math.cos(a) * R * 0.44, Math.sin(a) * R * 0.44, 0], [Math.PI / 2, 0, 0]);
    }
    put(g, cyl(0.1, 0.1, 0.03, 28), steel, [0, 0, 0], [Math.PI / 2, 0, 0]);       // hub
    put(g, new THREE.TorusGeometry(0.095, 0.009, 8, 28), dark, [0, 0, 0]);
    put(g, cyl(0.035, 0.035, 0.04, 18), dark, [0, 0, 0], [Math.PI / 2, 0, 0]);    // arbour hole
    put(g, new THREE.TorusGeometry(0.21, 0.006, 6, 40), rust, [0, 0, 0.012]);     // a worn ring, so it is not factory fresh
  };

  M.chain = (g) => {                                  // chain whip: Brawlhalla's scythe reach
    const steel = mat({ color: 0x6a727c, metalness: 1, roughness: 0.38 });
    const dark = PAL.gunmetal(), brass = PAL.brass();
    for (let i = 0; i < 17; i++) {                    // the links, alternating plane like a real chain
      const x = -0.5 + i * 0.062;
      put(g, new THREE.TorusGeometry(0.036, 0.011, 9, 22), steel, [x, Math.sin(i * 0.4) * 0.012, 0], [i % 2 ? Math.PI / 2 : 0, 0, Math.PI / 2]);
    }
    put(g, bevelBox(0.1, 0.13, 0.05, 0.016), brass, [0.6, 0, 0]);            // a padlock on the end
    put(g, new THREE.TorusGeometry(0.038, 0.012, 9, 22, Math.PI), brass, [0.6, 0.085, 0], [0, 0, 0]);
    put(g, cyl(0.012, 0.012, 0.016, 12), dark, [0.638, 0, 0], [0, 0, Math.PI / 2]);
    put(g, bevelBox(0.07, 0.085, 0.06, 0.018), PAL.grip(), [-0.56, 0, 0]);   // a wrapped handle
  };

  M.pipegun = (g) => {                                // pipe cannon
    // Audit 15 Oct: read as a lightsaber. A cannon needs a WIDE BORE, bracing and something to hold
    // it by, so the muzzle is now much heavier than the shaft and the grip end is a real assembly.
    const zinc = mat({ color: 0x8c949e, metalness: 1, roughness: 0.44 });
    const dark = PAL.gunmetal(), tape = PAL.hazard(), grip = PAL.grip(), steel = PAL.steel();
    put(g, cyl(0.1, 0.085, 0.72, 30), zinc, [0.06, 0, 0], [0, 0, Math.PI / 2]);     // the barrel
    put(g, cyl(0.16, 0.12, 0.17, 30), dark, [0.5, 0, 0], [0, 0, Math.PI / 2]);      // flared muzzle
    put(g, new THREE.TorusGeometry(0.16, 0.022, 12, 30), zinc, [0.57, 0, 0], [0, Math.PI / 2, 0]);
    put(g, cyl(0.105, 0.105, 0.04, 26), dark, [0.59, 0, 0], [0, 0, Math.PI / 2]);   // the bore
    for (let i = 0; i < 4; i++) {                                                    // bracing ribs
      const a = i / 4 * Math.PI * 2 + 0.4;
      put(g, bevelBox(0.5, 0.03, 0.05, 0.01), zinc, [0.12, Math.cos(a) * 0.1, Math.sin(a) * 0.1], [a, 0, 0]);
    }
    for (const x of [0.3, -0.04]) put(g, new THREE.TorusGeometry(0.108, 0.02, 12, 28), dark, [x, 0, 0], [0, Math.PI / 2, 0]);
    for (let i = 0; i < 5; i++) put(g, new THREE.TorusGeometry(0.102, 0.011, 8, 26), tape, [0.1 + i * 0.03, 0, 0], [0, Math.PI / 2, 0]);
    put(g, cyl(0.062, 0.07, 0.3, 22), grip, [-0.4, 0, 0], [0, 0, Math.PI / 2]);      // the shoulder end
    put(g, bevelBox(0.1, 0.19, 0.08, 0.022), grip, [-0.26, -0.14, 0], [0, 0, 0.2]);  // under grip
    put(g, new THREE.TorusGeometry(0.05, 0.012, 8, 20), dark, [-0.17, -0.08, 0], [0, Math.PI / 2, 0]);
    put(g, bevelBox(0.14, 0.05, 0.11, 0.016), steel, [-0.52, 0.02, 0]);              // butt plate
    put(g, bevelBox(0.16, 0.04, 0.05, 0.012), dark, [0.04, 0.12, 0]);                // top rail
  };
  M.pipebomb = (g) => {                               // pipe bomb: Smash's Bob-omb, as street hardware
    const zinc = mat({ color: 0x9aa2ac, metalness: 1, roughness: 0.4 });
    const dark = PAL.gunmetal(), tape = mat({ color: 0x24262a, metalness: 0, roughness: 0.9 });
    const red = PAL.plastic(0xc0392b), fuse = mat({ color: 0xa8894a, metalness: 0, roughness: 0.88 });
    put(g, cyl(0.12, 0.12, 0.44, 28), zinc, [0, 0, 0], [0, 0, Math.PI / 2]);
    for (const x of [-0.22, 0.22]) {                  // threaded end caps
      put(g, cyl(0.135, 0.135, 0.06, 28), dark, [x, 0, 0], [0, 0, Math.PI / 2]);
      put(g, new THREE.TorusGeometry(0.133, 0.012, 10, 26), dark, [x, 0, 0], [0, Math.PI / 2, 0]);
    }
    for (let i = 0; i < 6; i++) put(g, new THREE.TorusGeometry(0.123, 0.016, 10, 26), tape, [-0.08 + i * 0.032, 0, 0], [0, Math.PI / 2, 0]);  // tape
    put(g, bevelBox(0.1, 0.05, 0.03, 0.008), red, [0.02, 0.12, 0]);          // a taped-on timer
    put(g, new THREE.SphereGeometry(0.014, 12, 10), PAL.emissive(0xff2a2a, 3), [0.06, 0.148, 0]);
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.24, 0.04, 0), new THREE.Vector3(0.33, 0.14, 0.03), new THREE.Vector3(0.3, 0.26, -0.02)]);
    put(g, new THREE.TubeGeometry(curve, 24, 0.014, 8, false), fuse, [0, 0, 0]);
  };

  M.mine = (g) => {                                   // detonator
    // A close copy of Half-Life's SLAM, studied at full size 15 Oct. Feature for feature:
    //   * chamfered octagonal case with a stepped skirt (not a plain box)
    //   * a big CONCAVE black dish with concentric rings under a thick rubber rim
    //   * a long rail running across the right side, held by two collars
    //   * a recessed disc with a screwdriver slot
    //   * a black rotary dial with a RED and a GREEN button above it
    //   * side lugs, stencilled text and worn scuffs
    // Plus the one thing CS's C4 owns: the rainbow wire bundle.
    const olive  = mat({ color: 0x55603c, metalness: 0.28, roughness: 0.74 });
    const oliveL = mat({ color: 0x66714a, metalness: 0.26, roughness: 0.78 });
    const oliveD = mat({ color: 0x414a2e, metalness: 0.3, roughness: 0.8 });
    const rubber = mat({ color: 0x1d2024, metalness: 0.15, roughness: 0.82 });
    const dishM  = mat({ color: 0x15181b, metalness: 0.2, roughness: 0.68 });
    const steel  = mat({ color: 0x7b8490, metalness: 1, roughness: 0.38 });
    const red    = PAL.emissive(0xff3a30, 2.8), green = PAL.emissive(0x45e05a, 2.6);
    const scuff  = mat({ color: 0x6b3a28, metalness: 0.2, roughness: 0.88 });
    const stencil = mat({ color: 0x8d9470, metalness: 0, roughness: 0.92 });

    // ---- the case: an octagonal footprint, extruded, with a skirt under it ----
    const caseShape = (w, d, c) => {
      const p = new THREE.Shape();
      p.moveTo(-w + c, -d); p.lineTo(w - c, -d); p.lineTo(w, -d + c);
      p.lineTo(w, d - c);   p.lineTo(w - c, d);  p.lineTo(-w + c, d);
      p.lineTo(-w, d - c);  p.lineTo(-w, -d + c); p.lineTo(-w + c, -d);
      return p;
    };
    const body = new THREE.ExtrudeGeometry(caseShape(0.46, 0.3, 0.07), {
      depth: 0.26, bevelEnabled: true, bevelThickness: 0.022, bevelSize: 0.022, bevelSegments: 3, curveSegments: 2 });
    // rotateX(-90) already maps the extrusion (+Z, 0..depth) onto +Y, so the slab sits at 0..0.26
    // with its top face at 0.26. Translating it again is what buried the dish inside the case.
    body.rotateX(-Math.PI / 2); body.computeVertexNormals();
    put(g, body, olive, [0, 0, 0]);
    const skirt = new THREE.ExtrudeGeometry(caseShape(0.49, 0.33, 0.08), {
      depth: 0.07, bevelEnabled: true, bevelThickness: 0.016, bevelSize: 0.016, bevelSegments: 2, curveSegments: 2 });
    skirt.rotateX(-Math.PI / 2); skirt.computeVertexNormals();
    put(g, skirt, oliveD, [0, 0, 0]);

    // ---- the dish: a concave well with concentric rings, under a thick rim ----
    // The dish is the SLAM's loudest feature. It is built RAISED, sitting on the case's top face at
    // y=0.26 rather than recessed into it: a solid extruded shape has no hole to sink a well into,
    // so every attempt to carve one simply put the geometry inside the box where nothing could see
    // it. On the real thing the rubber rim stands proud anyway.
    const rim = mat({ color: 0x16181c, metalness: 0.1, roughness: 0.78 });
    const face = mat({ color: 0x0f1114, metalness: 0.08, roughness: 0.84 });
    put(g, cyl(0.235, 0.245, 0.055, 48), rim, [-0.14, 0.286, 0]);                   // the body of the dish
    put(g, new THREE.TorusGeometry(0.232, 0.032, 16, 52), rim, [-0.14, 0.306, 0], [Math.PI / 2, 0, 0]);  // the rubber rim
    // a shallow dome pressed INTO the top face, which is what gives the cone its look
    const domePts = [];
    for (let i = 0; i <= 16; i++) { const t = i / 16; domePts.push(new THREE.Vector2(0.205 * (1 - t), 0.312 - Math.sin(t * 1.4) * 0.03)); }
    put(g, new THREE.LatheGeometry(domePts, 48), face, [-0.14, 0, 0]);
    for (let i = 0; i < 3; i++)
      put(g, new THREE.TorusGeometry(0.062 + i * 0.05, 0.007, 10, 44), rim, [-0.14, 0.3 - i * 0.004, 0], [Math.PI / 2, 0, 0]);
    put(g, cyl(0.04, 0.04, 0.012, 24), rim, [-0.14, 0.292, 0]);

    // ---- the raised block on the right of the top face ----
    put(g, bevelBox(0.34, 0.07, 0.4, 0.02), oliveL, [0.25, 0.29, 0.02]);
    put(g, bevelBox(0.3, 0.02, 0.1, 0.008), oliveD, [0.25, 0.33, -0.1]);

    // ---- the rail across the right side, in two collars ----
    put(g, cyl(0.016, 0.016, 0.62, 14), steel, [0.2, 0.345, 0.04], [0, 0.42, Math.PI / 2]);
    for (const t of [-0.22, 0.2]) {
      put(g, bevelBox(0.05, 0.06, 0.07, 0.012), steel, [0.2 + t * 0.9, 0.33, 0.04 + t * 0.4]);
      put(g, new THREE.TorusGeometry(0.026, 0.009, 8, 16), steel, [0.2 + t * 0.9, 0.355, 0.04 + t * 0.4], [0, 0.42, Math.PI / 2]);
    }

    // ---- the recessed slotted disc ----
    put(g, cyl(0.075, 0.075, 0.022, 28), oliveD, [0.35, 0.3, -0.16]);
    put(g, cyl(0.062, 0.062, 0.016, 28), oliveL, [0.35, 0.312, -0.16]);
    put(g, bevelBox(0.014, 0.012, 0.085, 0.004), oliveD, [0.35, 0.322, -0.16]);
    put(g, cyl(0.082, 0.082, 0.018, 28), oliveL, [0.3, 0.3, 0.17]);                  // the embossed circle

    // ---- the control face: a black dial with red and green above it ----
    put(g, bevelBox(0.19, 0.17, 0.03, 0.012), oliveD, [0.14, 0.14, 0.31]);
    put(g, cyl(0.062, 0.062, 0.028, 26), rubber, [0.12, 0.11, 0.325], [Math.PI / 2, 0, 0]);
    put(g, new THREE.TorusGeometry(0.063, 0.011, 10, 24), rubber, [0.12, 0.11, 0.33], [0, 0, 0]);
    put(g, cyl(0.016, 0.016, 0.02, 14), steel, [0.12, 0.11, 0.345], [Math.PI / 2, 0, 0]);
    put(g, bevelBox(0.045, 0.03, 0.02, 0.006), red,   [0.095, 0.2, 0.325]);
    put(g, bevelBox(0.045, 0.03, 0.02, 0.006), green, [0.155, 0.19, 0.325]);

    // ---- side lugs, stencils and scuffs ----
    for (const sz of [-1, 1]) {
      put(g, bevelBox(0.05, 0.05, 0.07, 0.014), oliveL, [-0.47, 0.2, sz * 0.18]);
      put(g, cyl(0.016, 0.016, 0.05, 12), steel, [-0.49, 0.2, sz * 0.18], [0, 0, Math.PI / 2]);
    }
    for (let i = 0; i < 4; i++) put(g, bevelBox(0.03, 0.045, 0.007, 0.002), stencil, [-0.34 + i * 0.045, 0.14, 0.305]);
    for (let i = 0; i < 5; i++) {
      const a = i * 1.7;
      put(g, bevelBox(0.05 + (i % 2) * 0.04, 0.012, 0.008, 0.002), scuff,
          [Math.sin(a) * 0.3, 0.265, Math.cos(a) * 0.2], [0, a, 0]);
    }

    // ---- the C4 wire bundle ----
    const cols = [0xff3b3b, 0xffb020, 0xffe84a, 0x3bd46a, 0x4a9bff, 0xb06ad8];
    cols.forEach((c, i) => {
      const t = i / (cols.length - 1), off = (t - 0.5) * 0.09;
      const cv = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0.3, 0.32, 0.2 + off * 0.3),
        new THREE.Vector3(0.42 + off, 0.56 + t * 0.05, 0.14 + off),
        new THREE.Vector3(0.3 + off, 0.68 + t * 0.04, 0.02 + off),
        new THREE.Vector3(0.14 + off, 0.58, -0.08 + off)]);
      put(g, new THREE.TubeGeometry(cv, 30, 0.014, 7, false), mat({ color: c, metalness: 0.1, roughness: 0.6 }), [0, 0, 0]);
    });
    put(g, cyl(0.045, 0.045, 0.05, 18), rubber, [0.3, 0.33, 0.19], [0.5, 0, 0]);
  };
  M.wreck = (g) => {                                  // wrecking ball
    // Audit 15 Oct: read as a bomb, because the ball was almost all of it. A wrecking ball is
    // recognised by the RIG -- a heavy hook and a run of chain -- so those now take real space.
    const iron = mat({ color: 0x343b43, metalness: 1, roughness: 0.52 });
    const dark = mat({ color: 0x1a1e24, metalness: 1, roughness: 0.58 });
    const steel = mat({ color: 0x8a939f, metalness: 1, roughness: 0.34 });
    put(g, new THREE.SphereGeometry(0.34, 44, 32), iron, [0, -0.3, 0]);
    for (let i = 0; i < 3; i++) put(g, new THREE.TorusGeometry(0.341, 0.022, 10, 44), dark, [0, -0.3, 0], [Math.PI / 2, 0, i * 0.55]);
    for (let i = 0; i < 12; i++) {
      const a = i * 2.3, b = i * 1.1;
      put(g, new THREE.SphereGeometry(0.046, 10, 8), dark,
          [Math.cos(a) * Math.sin(b) * 0.31, -0.3 + Math.cos(b) * 0.31, Math.sin(a) * Math.sin(b) * 0.31]);
    }
    put(g, cyl(0.07, 0.095, 0.1, 24), steel, [0, 0.04, 0]);                        // swivel
    put(g, new THREE.TorusGeometry(0.062, 0.02, 10, 24), steel, [0, 0.11, 0], [Math.PI / 2, 0, 0]);
    // the chain, long enough to be the thing you notice
    for (let i = 0; i < 7; i++)
      put(g, new THREE.TorusGeometry(0.055, 0.018, 10, 24), steel, [0, 0.19 + i * 0.095, 0], [i % 2 ? 0 : Math.PI / 2, 0, 0]);
    // the hook at the top
    put(g, cyl(0.03, 0.03, 0.1, 14), steel, [0, 0.87, 0]);
    const hk = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0.92, 0), new THREE.Vector3(0.1, 1.0, 0),
      new THREE.Vector3(0.02, 1.08, 0), new THREE.Vector3(-0.08, 1.0, 0)]);
    put(g, new THREE.TubeGeometry(hk, 26, 0.028, 10, false), steel, [0, 0, 0]);
    put(g, new THREE.TorusGeometry(0.055, 0.016, 10, 22), dark, [0, 0.9, 0], [Math.PI / 2, 0, 0]);
  };
  M.sweeper = (g) => {                                // street sweeper: the shotgun
    const blued = PAL.blued(), wood = PAL.wood(), dark = PAL.gunmetal(), steel = PAL.steel();
    put(g, bevelBox(0.3, 0.1, 0.075, 0.016), blued, [0.02, 0, 0]);           // receiver
    barrel(g, 0.46, 0.028, blued, 0.22);
    put(g, cyl(0.022, 0.022, 0.42, 18), dark, [0.3, -0.05, 0], [0, 0, Math.PI / 2]);   // magazine tube
    put(g, bevelBox(0.17, 0.062, 0.07, 0.014), wood, [0.26, -0.052, 0]);     // the pump
    for (let i = 0; i < 5; i++) put(g, bevelBox(0.012, 0.064, 0.072, 0.003), dark, [0.2 + i * 0.03, -0.052, 0]);
    put(g, bevelBox(0.26, 0.085, 0.062, 0.016), wood, [-0.25, -0.03, 0], [0, 0, 0.13]); // stock
    put(g, bevelBox(0.04, 0.1, 0.06, 0.012), PAL.rubber(), [-0.38, -0.05, 0], [0, 0, 0.13]);
    put(g, bevelBox(0.05, 0.11, 0.045, 0.012), PAL.grip(), [-0.09, -0.1, 0], [0, 0, 0.2]);
    put(g, new THREE.TorusGeometry(0.03, 0.007, 8, 18), dark, [-0.03, -0.065, 0], [0, Math.PI / 2, 0]);
    put(g, bevelBox(0.02, 0.028, 0.012, 0.003), steel, [0.52, 0.04, 0]);     // bead sight
    put(g, bevelBox(0.07, 0.03, 0.04, 0.008), dark, [-0.06, 0.055, 0]);      // ejection port
  };

  // Explicit angles, only for shapes the automatic profile/chunky choice gets wrong. Rebuilt 15 Oct
  // for the near-profile CS2 rig: these numbers are much flatter than the old three-quarter ones.
  // ---- renamed 15 Oct, so the art had to follow the name ----
  // A weapon called Speargun cannot be a recurve bow and a weapon called Mattress cannot be a
  // pinball bumper. These six were renamed out of fantasy and sci-fi into street objects, and a
  // name the picture contradicts is worse than the name we started with.

  M.bow = (g) => {                                    // speargun
    // Audit 15 Oct: a thin dark line with no mass. A speargun is a CHUNKY stock with a thick spear
    // and heavy rubber bands, so everything here is thicker and the bands are now the silhouette.
    const body = PAL.polymer(0x232831), steel = PAL.chrome(), dark = PAL.gunmetal();
    const band = mat({ color: 0x2a2320, metalness: 0, roughness: 0.9 });
    const accent = PAL.plastic(0xd4541e), grip = PAL.grip();
    put(g, bevelBox(0.78, 0.13, 0.12, 0.028), body, [0.02, 0, 0]);                 // the stock
    put(g, bevelBox(0.5, 0.05, 0.14, 0.016), dark, [0.16, 0.08, 0]);               // the track
    put(g, cyl(0.02, 0.02, 1.05, 16), steel, [0.1, 0.055, 0], [0, 0, Math.PI / 2]); // the spear
    put(g, new THREE.ConeGeometry(0.045, 0.14, 18), steel, [0.68, 0.055, 0], [0, 0, -Math.PI / 2]);
    for (let i = 0; i < 2; i++) put(g, new THREE.ConeGeometry(0.034, 0.1, 10), dark, [0.54 - i * 0.09, 0.055, 0], [0, 0, Math.PI / 2]);
    put(g, bevelBox(0.14, 0.18, 0.13, 0.028), body, [-0.34, 0.03, 0]);             // muzzle block
    for (const z of [-0.075, 0.075]) {                                              // the thick bands
      const c = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-0.38, 0.09, z * 1.6), new THREE.Vector3(-0.12, 0.2, z * 2.4),
        new THREE.Vector3(0.14, 0.09, z)]);
      put(g, new THREE.TubeGeometry(c, 28, 0.03, 10, false), band, [0, 0, 0]);
      put(g, new THREE.TorusGeometry(0.034, 0.012, 8, 18), steel, [-0.38, 0.09, z * 1.6], [0, 0, 0]);
    }
    put(g, bevelBox(0.09, 0.2, 0.1, 0.022), grip, [-0.2, -0.16, 0], [0, 0, 0.18]); // pistol grip
    put(g, new THREE.TorusGeometry(0.042, 0.01, 8, 18), dark, [-0.12, -0.1, 0], [0, Math.PI / 2, 0]);
    put(g, bevelBox(0.1, 0.04, 0.08, 0.012), accent, [-0.2, -0.05, 0]);
    put(g, bevelBox(0.22, 0.06, 0.1, 0.018), body, [-0.47, -0.03, 0], [0, 0, 0.12]); // butt
    put(g, cyl(0.045, 0.045, 0.05, 18), dark, [0.3, -0.07, 0], [Math.PI / 2, 0, 0]); // line reel
  };
  M.aegis = (g) => {                                  // riot drone
    // Third pass. Pass two scattered the "barrier" as nine loose hexes floating beside the drone,
    // which read as debris. The barrier now sits ON the shield face as a lit hex lattice, so the
    // shield IS the effect rather than having an effect parked next to it.
    const armour = mat({ color: 0x39414c, metalness: 0.6, roughness: 0.42 });
    const plate  = mat({ color: 0x4a545f, metalness: 0.78, roughness: 0.34 });
    const dark   = mat({ color: 0x1b1f26, metalness: 0.55, roughness: 0.48 });
    const steel  = PAL.steel(), hazard = PAL.plastic(0xe06020);
    const poly   = phys({ color: 0x8fd0ff, metalness: 0, roughness: 0.06, transmission: 0.74, thickness: 0.22, ior: 1.46 });
    const field  = PAL.emissive(0x4fc8ff, 3.4);
    const lampB  = PAL.emissive(0x3f7cff, 4), lampR = PAL.emissive(0xff3550, 4);

    // ---- chassis ----
    put(g, bevelBox(0.46, 0.14, 0.34, 0.05), armour, [0, 0, 0]);
    put(g, bevelBox(0.36, 0.06, 0.27, 0.03), plate, [0, 0.09, 0]);
    for (let i = 0; i < 5; i++) put(g, bevelBox(0.016, 0.034, 0.22, 0.006), dark, [0.03 + i * 0.03, 0.122, 0]);
    put(g, bevelBox(0.5, 0.045, 0.1, 0.016), hazard, [0, -0.055, 0]);
    for (const sx of [-1, 1]) put(g, bevelBox(0.055, 0.11, 0.36, 0.018), plate, [sx * 0.2, 0, 0]);
    put(g, bevelBox(0.18, 0.04, 0.055, 0.014), dark, [-0.02, 0.135, 0]);
    put(g, new THREE.SphereGeometry(0.028, 14, 10), lampB, [-0.07, 0.152, 0]);
    put(g, new THREE.SphereGeometry(0.028, 14, 10), lampR, [0.03, 0.152, 0]);

    // ---- arms, motors, props ----
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + i * Math.PI / 2, ax = Math.cos(a) * 0.42, az = Math.sin(a) * 0.42;
      put(g, cyl(0.03, 0.045, 0.3, 14), armour, [ax * 0.56, 0.012, az * 0.56], [Math.PI / 2, 0, a + Math.PI / 2]);
      for (let k = 0; k < 3; k++) put(g, new THREE.TorusGeometry(0.036, 0.009, 8, 16), dark,
        [ax * (0.4 + k * 0.1), 0.012, az * (0.4 + k * 0.1)], [0, -a, Math.PI / 2]);
      put(g, cyl(0.058, 0.066, 0.09, 20), plate, [ax, 0.045, az]);
      put(g, new THREE.TorusGeometry(0.062, 0.013, 10, 22), steel, [ax, 0.09, az], [Math.PI / 2, 0, 0]);
      put(g, new THREE.TorusGeometry(0.175, 0.016, 10, 34), armour, [ax, 0.1, az], [Math.PI / 2, 0, 0]);
      for (let k = 0; k < 3; k++) { const b = k / 3 * Math.PI * 2 + a;
        put(g, cyl(0.01, 0.01, 0.12, 8), dark, [ax + Math.cos(b) * 0.12, 0.1, az + Math.sin(b) * 0.12], [0, -b, Math.PI / 2]); }
      for (let b = 0; b < 2; b++) put(g, bevelBox(0.31, 0.009, 0.055, 0.003), steel, [ax, 0.112, az], [0, b * Math.PI / 2 + a, 0.08]);
      put(g, cyl(0.17, 0.17, 0.004, 32), mat({ color: 0xc4cedb, metalness: 0.3, roughness: 0.3, transparent: true, opacity: 0.2 }), [ax, 0.112, az]);
    }

    // ---- gimbal camera ----
    put(g, cyl(0.055, 0.055, 0.055, 20), dark, [0.1, -0.095, 0]);
    put(g, new THREE.SphereGeometry(0.078, 24, 18), plate, [0.12, -0.15, 0]);
    put(g, cyl(0.046, 0.052, 0.05, 20), dark, [0.2, -0.162, 0], [0, 0, -1.25]);
    put(g, new THREE.SphereGeometry(0.036, 20, 14), PAL.glass(0x3f7cff), [0.225, -0.17, 0]);
    put(g, new THREE.TorusGeometry(0.038, 0.009, 8, 20), steel, [0.22, -0.168, 0], [0, 1.25, 0]);

    // ---- the curved riot shield, with the barrier lattice ON its face ----
    const sh = new THREE.Group();
    const R = 0.62, arc = 1.1, H = 0.56;
    put(sh, new THREE.CylinderGeometry(R, R, H, 44, 1, true, -arc / 2, arc), poly, [0, 0, 0]);
    for (const yy of [H / 2, -H / 2]) put(sh, new THREE.CylinderGeometry(R + 0.014, R + 0.014, 0.06, 44, 1, true, -arc / 2, arc), armour, [0, yy, 0]);
    for (const e of [-arc / 2, arc / 2]) put(sh, bevelBox(0.04, H + 0.06, 0.045, 0.012), armour, [Math.sin(e) * R, 0, Math.cos(e) * R], [0, e, 0]);
    put(sh, new THREE.CylinderGeometry(R + 0.009, R + 0.009, 0.08, 44, 1, true, -arc / 2, arc), hazard, [0, 0.07, 0]);
    for (let i = 0; i < 7; i++) { const e = -arc / 2 + arc * (0.08 + i * 0.14);
      put(sh, bevelBox(0.025, 0.055, 0.06, 0.006), dark, [Math.sin(e) * (R + 0.014), 0.07, Math.cos(e) * (R + 0.014)], [0, e, 0]); }
    // Pass 2 and 3 both put a hex "barrier" lattice on this face and both times it detached and read
    // as debris. Dropped. A lit rim down the shield edge says "powered" without floating geometry.
    for (const e of [-arc / 2, arc / 2]) put(sh, cyl(0.016, 0.016, H, 10), field, [Math.sin(e) * (R + 0.025), 0, Math.cos(e) * (R + 0.025)]);
    put(sh, new THREE.CylinderGeometry(R + 0.022, R + 0.022, 0.03, 44, 1, true, -arc / 2, arc), field, [0, -0.2, 0]);
    put(sh, new THREE.TorusGeometry(0.09, 0.019, 10, 22, Math.PI), steel, [0, -0.06, R - 0.1], [Math.PI / 2, 0, 0]);
    // The curved panel's visible face sits R away from the cylinder's own axis, so positioning the
    // GROUP put the panel a shield-radius off from where I meant it. Re-centre the panel on the
    // group origin first, then place it; otherwise it floats away from its own mount.
    sh.position.z = -R;
    const mount = new THREE.Group();
    mount.add(sh);
    mount.rotation.set(0, Math.PI / 2, -0.16);
    mount.position.set(0.17, -0.44, 0);
    mount.scale.setScalar(0.68);
    g.add(mount);
    put(g, cyl(0.028, 0.028, 0.26, 12), armour, [0.14, -0.26, 0], [0, 0, -0.5]);   // the arm it hangs from
  };
  M.manhole = (g) => {                                // bear trap (was a manhole cover)
    const steel = mat({ color: 0x5a636d, metalness: 1, roughness: 0.46 });
    const dark = PAL.gunmetal(), rust = mat({ color: 0x6b4226, metalness: 0.8, roughness: 0.76 });
    put(g, new THREE.TorusGeometry(0.3, 0.035, 12, 40), steel, [0, 0, 0], [Math.PI / 2, 0, 0]);   // the ring
    put(g, cyl(0.1, 0.1, 0.05, 24), dark, [0, 0.01, 0]);                      // the pan you step on
    put(g, new THREE.TorusGeometry(0.1, 0.018, 10, 24), steel, [0, 0.03, 0], [Math.PI / 2, 0, 0]);
    // the two jaws, open, teeth up: the whole read of the object
    for (const side of [-1, 1]) {
      const jaw = new THREE.Group();
      put(jaw, new THREE.TorusGeometry(0.29, 0.028, 10, 26, Math.PI), steel, [0, 0, 0], [0, 0, 0]);
      for (let i = 0; i < 8; i++) {
        const a = Math.PI * (0.07 + i * 0.124);
        put(jaw, new THREE.ConeGeometry(0.03, 0.12, 4), steel,
            [Math.cos(a) * 0.29, Math.sin(a) * 0.29, 0], [0, Math.PI / 4, a - Math.PI / 2]);
      }
      jaw.rotation.set(-Math.PI / 2 + side * 0.85, 0, 0);
      jaw.position.y = 0.02;
      g.add(jaw);
    }
    put(g, bevelBox(0.26, 0.05, 0.07, 0.014), rust, [0, 0.0, 0.3]);           // the spring
    for (let i = 0; i < 5; i++) put(g, new THREE.TorusGeometry(0.045, 0.012, 8, 18), steel, [0, 0.01, 0.26 + i * 0.03], [0, 0, Math.PI / 2]);
    put(g, cyl(0.012, 0.012, 0.3, 10), rust, [0, -0.01, -0.33], [Math.PI / 2, 0, 0]);   // the chain stake
    put(g, new THREE.ConeGeometry(0.03, 0.09, 10), dark, [0, -0.01, -0.5], [Math.PI / 2, 0, 0]);
  };

  M.well = (g) => {                                   // vortex grenade
    // Audit 15 Oct: read as a battery or a speaker. A grenade is recognised by the SPOON and PIN,
    // so those lead now, and the emitter bands are secondary rather than the whole object.
    const shell = mat({ color: 0x2f3640, metalness: 0.85, roughness: 0.42 });
    const dark = mat({ color: 0x15181d, metalness: 0.9, roughness: 0.5 });
    const steel = PAL.steel(), glow = PAL.emissive(0xb06ad8, 3);
    // a rounded body, not a can
    put(g, new THREE.SphereGeometry(0.26, 34, 24), shell, [0, -0.02, 0], null, [1, 1.18, 1]);
    for (let i = 0; i < 4; i++) put(g, new THREE.TorusGeometry(0.262, 0.016, 10, 36), dark, [0, -0.14 + i * 0.09, 0], [Math.PI / 2, 0, 0]);
    for (let i = 0; i < 6; i++) {                        // emitter vents
      const a = i / 6 * Math.PI * 2;
      put(g, bevelBox(0.05, 0.1, 0.03, 0.008), glow, [Math.cos(a) * 0.255, 0.0, Math.sin(a) * 0.255], [0, -a, 0]);
    }
    // neck, fuse head, spoon and pin: the grenade language
    put(g, cyl(0.1, 0.12, 0.09, 24), dark, [0, 0.3, 0]);
    put(g, cyl(0.075, 0.075, 0.07, 20), steel, [0, 0.37, 0]);
    put(g, new THREE.TorusGeometry(0.078, 0.012, 10, 22), dark, [0, 0.4, 0], [Math.PI / 2, 0, 0]);
    // the spoon down one side
    const sp = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.07, 0.4, 0), new THREE.Vector3(0.16, 0.26, 0),
      new THREE.Vector3(0.18, 0.05, 0), new THREE.Vector3(0.15, -0.12, 0)]);
    put(g, new THREE.TubeGeometry(sp, 26, 0.028, 4, false), steel, [0, 0, 0]);
    put(g, bevelBox(0.05, 0.3, 0.07, 0.014), steel, [0.165, 0.12, 0], [0, 0, 0.06]);
    // the ring pull
    put(g, new THREE.TorusGeometry(0.06, 0.012, 10, 22), steel, [-0.12, 0.42, 0], [0, 0.4, 0.3]);
    put(g, cyl(0.009, 0.009, 0.09, 10), steel, [-0.06, 0.4, 0], [0, 0, 1.2]);
  };
  // M.freeze was hand-built here and is gone 16 Oct: it is a downloaded model now
  // (PROP_SPEC in src/92_v3_items.mjs), and the card is baked from that same file.

  M.flamer = (g) => {                                 // flamethrower (was a blowtorch)
    const body = PAL.polymer(0x232830), tank = mat({ color: 0x5a6350, metalness: 0.7, roughness: 0.5 });
    const dark = PAL.gunmetal(), steel = PAL.steel(), hose = mat({ color: 0x14161a, metalness: 0, roughness: 0.9 });
    put(g, bevelBox(0.46, 0.11, 0.1, 0.022), body, [0.06, 0, 0]);              // the gun body
    put(g, cyl(0.035, 0.035, 0.34, 20), dark, [0.34, 0.02, 0], [0, 0, Math.PI / 2]);   // the barrel
    put(g, cyl(0.05, 0.042, 0.07, 22), steel, [0.52, 0.02, 0], [0, 0, Math.PI / 2]);   // the nozzle
    put(g, new THREE.TorusGeometry(0.048, 0.009, 8, 22), dark, [0.5, 0.02, 0], [0, Math.PI / 2, 0]);
    put(g, new THREE.ConeGeometry(0.03, 0.1, 16), PAL.emissive(0xff8a2a, 2.8), [0.6, 0.02, 0], [0, 0, -Math.PI / 2]);  // pilot flame
    put(g, cyl(0.014, 0.014, 0.1, 12), steel, [0.44, 0.075, 0], [0, 0, Math.PI / 2]);  // pilot line
    put(g, bevelBox(0.06, 0.15, 0.055, 0.016), PAL.grip(), [-0.02, -0.12, 0], [0, 0, 0.16]);
    put(g, new THREE.TorusGeometry(0.032, 0.008, 8, 18), dark, [0.05, -0.075, 0], [0, Math.PI / 2, 0]);
    put(g, bevelBox(0.07, 0.11, 0.055, 0.014), PAL.grip(), [0.2, -0.085, 0], [0, 0, -0.12]);   // fore grip
    // the fuel tanks on the back, which is the silhouette of a flamethrower
    for (const z of [-0.07, 0.07]) {
      put(g, cyl(0.085, 0.085, 0.32, 24), tank, [-0.26, -0.02, z], [0, 0, Math.PI / 2]);
      put(g, new THREE.SphereGeometry(0.085, 22, 14), tank, [-0.42, -0.02, z], null, [0.6, 1, 1]);
      put(g, new THREE.SphereGeometry(0.085, 22, 14), tank, [-0.1, -0.02, z], null, [0.6, 1, 1]);
      put(g, new THREE.TorusGeometry(0.087, 0.012, 8, 24), dark, [-0.3, -0.02, z], [0, Math.PI / 2, 0]);
    }
    const h = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.06, 0.02, 0.07), new THREE.Vector3(0.02, 0.1, 0.04), new THREE.Vector3(-0.02, 0.05, 0)]);
    put(g, new THREE.TubeGeometry(h, 20, 0.018, 8, false), hose, [0, 0, 0]);
  };

  // ================= THE LOCKER: wearable gear =================
  // 27 pieces across six body slots, because Dota sells by slot and Roblox sells the cap separately
  // from the shades separately from the chain. Same rig, same palette and same bake as the weapons,
  // so a hat and a hammer sit on one shelf without looking like they came from two games.
  // `shoe()` is shared by every boot: a boot is a SILHOUETTE, and three attempts at stacked boxes
  // proved that the hard way.
  const shoe = (g, opt) => {
    const { upper, cap, sole, lace, hi, toeCap } = opt;
    const p = new THREE.Shape();
    p.moveTo(-0.3, 0.02);
    p.lineTo(-0.3, hi);
    p.quadraticCurveTo(-0.29, hi + 0.08, -0.2, hi + 0.08);
    p.lineTo(-0.1, hi + 0.06);
    p.quadraticCurveTo(-0.02, hi + 0.04, 0.0, hi * 0.72);
    p.quadraticCurveTo(0.04, 0.2, 0.22, 0.12);
    p.quadraticCurveTo(0.36, 0.08, 0.38, 0.03);
    p.lineTo(0.36, 0.02); p.lineTo(-0.3, 0.02);
    const one = (ox, oz, ry, sc) => {
      const b = new THREE.Group();
      const geo = new THREE.ExtrudeGeometry(p, { depth: 0.2, bevelEnabled: true, bevelThickness: 0.013, bevelSize: 0.013, bevelSegments: 3, curveSegments: 14 });
      geo.translate(0, 0, -0.1); geo.computeVertexNormals();
      put(b, geo, upper, [0, 0, 0]);
      if (toeCap) {
        const c = new THREE.Shape();
        c.moveTo(0.08, 0.02); c.lineTo(0.105, 0.175);
        c.quadraticCurveTo(0.26, 0.145, 0.385, 0.038);
        c.lineTo(0.37, 0.02); c.lineTo(0.08, 0.02);
        const cg = new THREE.ExtrudeGeometry(c, { depth: 0.208, bevelEnabled: true, bevelThickness: 0.016, bevelSize: 0.016, bevelSegments: 3, curveSegments: 14 });
        cg.translate(0, 0, -0.104); cg.computeVertexNormals();
        put(b, cg, cap, [0.004, 0.004, 0]);
      }
      put(b, bevelBox(0.74, 0.055, 0.225, 0.022), sole, [0.04, -0.012, 0]);
      put(b, bevelBox(0.17, 0.07, 0.225, 0.02), sole, [-0.24, -0.06, 0]);
      for (let i = 0; i < 6; i++) put(b, bevelBox(0.055, 0.022, 0.23, 0.007), sole, [-0.12 + i * 0.09, -0.042, 0]);
      for (let i = 0; i < 4; i++) {
        const t = i / 3;
        put(b, cyl(0.009, 0.009, 0.18, 10), lace, [-0.14 + t * 0.13, hi - 0.02 - t * 0.17, 0], [Math.PI / 2, 0, 0.75]);
        for (const z of [-0.085, 0.085]) put(b, new THREE.TorusGeometry(0.016, 0.005, 6, 12), cap, [-0.14 + t * 0.13, hi - 0.02 - t * 0.17, z], [0, Math.PI / 2, 0]);
      }
      b.position.set(ox, 0, oz); b.rotation.y = ry; if (sc) b.scale.setScalar(sc);
      return b;
    };
    g.add(one(-0.1, -0.3, -0.13, 0.92)); g.add(one(0.08, 0.3, 0.1, 1));
  };
  // a pair of anything worn on both hands, laid out so you read two of them
  const pair = (g, make, spread) => {
    const a = new THREE.Group(); make(a); a.position.set(-0.06, 0.06, -(spread || 0.26)); a.rotation.y = -0.24; a.scale.setScalar(0.93);
    const b = new THREE.Group(); make(b); b.position.set(0.06, -0.06, (spread || 0.26)); b.rotation.y = 0.2;
    g.add(a); g.add(b);
  };

  // ---- HEAD ----
  M.g_visor = (g) => {
    const shell = PAL.plastic(0xc0392b), band = PAL.grip(), trim = PAL.chrome();
    const brim = new THREE.Shape();
    brim.moveTo(-0.34, 0); brim.quadraticCurveTo(0, 0.42, 0.34, 0);
    brim.quadraticCurveTo(0, 0.1, -0.34, 0);
    const bg = new THREE.ExtrudeGeometry(brim, { depth: 0.035, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 2, curveSegments: 18 });
    bg.computeVertexNormals();
    put(g, bg, shell, [0, 0.03, 0], [-1.35, 0, 0]);
    put(g, new THREE.TorusGeometry(0.33, 0.045, 12, 40, Math.PI * 1.25), band, [0, 0.04, -0.03], [Math.PI / 2, 0, -0.4]);
    put(g, new THREE.TorusGeometry(0.33, 0.016, 10, 40, Math.PI * 1.25), trim, [0, 0.1, -0.03], [Math.PI / 2, 0, -0.4]);
  };
  M.g_snapback = (g) => {
    const shell = PAL.polymer(0x1b2b45), brimM = PAL.polymer(0x121a28), trim = PAL.plastic(0xd4541e);
    put(g, new THREE.SphereGeometry(0.33, 36, 24, 0, Math.PI * 2, 0, Math.PI / 2), shell, [0, 0, 0]);
    put(g, bevelBox(0.62, 0.035, 0.46, 0.014), brimM, [0.3, 0.015, 0], [0, 0, -0.06]);   // the flat brim
    put(g, new THREE.TorusGeometry(0.33, 0.028, 10, 40), brimM, [0, 0.01, 0], [Math.PI / 2, 0, 0]);
    put(g, new THREE.SphereGeometry(0.032, 14, 10), trim, [0, 0.33, 0]);                  // button
    put(g, bevelBox(0.14, 0.09, 0.012, 0.004), trim, [0.3, 0.17, 0.0], [0, 0, 0.1]);      // front panel badge
    for (let i = 0; i < 5; i++) put(g, bevelBox(0.02, 0.06, 0.012, 0.003), brimM, [-0.3, 0.06 + i * 0.02, -0.14 + i * 0.07]);  // snap strap
  };
  M.g_fedora = (g) => {
    const felt = mat({ color: 0x3a2b22, metalness: 0, roughness: 0.84 });
    const band = mat({ color: 0x14171c, metalness: 0.1, roughness: 0.7 });
    const pin = PAL.gold();
    const br = new THREE.Shape();
    br.absarc(0, 0, 0.52, 0, Math.PI * 2, false);
    br.holes.push(new THREE.Path().absarc(0, 0, 0.3, 0, Math.PI * 2, true));
    const bg = new THREE.ExtrudeGeometry(br, { depth: 0.035, bevelEnabled: true, bevelThickness: 0.014, bevelSize: 0.018, bevelSegments: 3, curveSegments: 40 });
    bg.computeVertexNormals();
    put(g, bg, felt, [0, 0, 0], [-Math.PI / 2, 0, 0]);
    put(g, cyl(0.29, 0.31, 0.3, 36), felt, [0, 0.16, 0]);                 // crown
    put(g, new THREE.SphereGeometry(0.3, 36, 18, 0, Math.PI * 2, 0, Math.PI / 2), felt, [0, 0.29, 0], null, [1, 0.42, 1]);
    put(g, bevelBox(0.1, 0.1, 0.24, 0.03), felt, [0, 0.34, 0]);           // the pinch
    put(g, cyl(0.315, 0.315, 0.09, 36), band, [0, 0.07, 0]);              // hatband
    put(g, bevelBox(0.05, 0.05, 0.03, 0.008), pin, [0.3, 0.09, 0.08]);
  };
  M.g_cans = (g) => {
    const shell = PAL.polymer(0x1d2127), pad = PAL.rubber(), steel = PAL.chrome(), accent = PAL.plastic(0xd4541e);
    put(g, new THREE.TorusGeometry(0.33, 0.028, 12, 32, Math.PI), steel, [0, 0.02, 0], [0, 0, 0]);  // the band
    put(g, new THREE.TorusGeometry(0.33, 0.045, 12, 32, Math.PI * 0.8), pad, [0, 0.02, 0], [0, 0, 0.32]);
    for (const z of [-0.34, 0.34]) {
      put(g, cyl(0.17, 0.19, 0.11, 28), shell, [0, 0.0, z], [Math.PI / 2, 0, 0]);
      put(g, cyl(0.15, 0.15, 0.05, 28), pad, [0, 0.0, z * 0.78], [Math.PI / 2, 0, 0]);
      put(g, new THREE.TorusGeometry(0.175, 0.02, 10, 30), accent, [0, 0, z], [0, 0, 0]);
      put(g, cyl(0.05, 0.05, 0.02, 20), steel, [0, 0, z * 1.1], [Math.PI / 2, 0, 0]);
    }
  };
  M.g_pilot = (g) => {
    // First bake was a mess of overlapping spheres. Simpler: a close leather cap, two flaps, and the
    // goggles pushed up on the crown, which is the only detail that says "pilot".
    const leather = mat({ color: 0x4a3322, metalness: 0.05, roughness: 0.78 });
    const dark = mat({ color: 0x2e2015, metalness: 0.05, roughness: 0.82 });
    const fur = mat({ color: 0x9a8a70, metalness: 0, roughness: 0.96 });
    const glass = PAL.glass(0x9ad8ff), frame = PAL.gunmetal(), strap = PAL.grip();
    put(g, new THREE.SphereGeometry(0.33, 36, 24, 0, Math.PI * 2, 0, Math.PI * 0.56), leather, [0, 0, 0]);
    put(g, new THREE.TorusGeometry(0.325, 0.05, 12, 40), fur, [0, 0.01, 0], [Math.PI / 2, 0, 0]);   // the fur rim
    for (const z of [-0.29, 0.29]) {                                                                // ear flaps
      put(g, bevelBox(0.2, 0.26, 0.09, 0.05), leather, [0.0, -0.1, z], [0, 0, 0]);
      put(g, new THREE.SphereGeometry(0.06, 14, 10), fur, [0, -0.21, z]);
      put(g, cyl(0.016, 0.016, 0.2, 10), strap, [0.02, -0.26, z * 0.7], [0, 0.4 * Math.sign(z), 1.3]);
    }
    put(g, new THREE.TorusGeometry(0.338, 0.038, 10, 40), strap, [0, 0.12, 0], [Math.PI / 2, 0, 0]);  // goggle strap
    for (const z of [-0.15, 0.15]) {
      put(g, cyl(0.115, 0.115, 0.08, 26), frame, [0.15, 0.25, z], [Math.PI / 2, 0, 0.55]);
      put(g, cyl(0.095, 0.095, 0.022, 26), glass, [0.185, 0.285, z], [Math.PI / 2, 0, 0.55]);
      put(g, new THREE.TorusGeometry(0.118, 0.016, 10, 26), dark, [0.15, 0.25, z], [0, 0.55, 0]);
    }
    put(g, bevelBox(0.07, 0.04, 0.1, 0.014), frame, [0.17, 0.27, 0], [0, 0, 0.55]);                  // goggle bridge
  };
  M.g_wreath = (g) => {
    const gold = PAL.gold(), dark = PAL.brass();
    put(g, new THREE.TorusGeometry(0.32, 0.018, 10, 44), dark, [0, 0, 0], [Math.PI / 2, 0, 0]);
    for (let i = 0; i < 26; i++) {                     // the leaves
      const a = i / 26 * Math.PI * 2, lean = (i % 2 ? 1 : -1);
      const leaf = new THREE.SphereGeometry(0.075, 14, 10);
      put(g, leaf, gold, [Math.cos(a) * 0.32, Math.sin(a * 2) * 0.012, Math.sin(a) * 0.32],
          [0, -a, lean * 0.5], [0.34, 0.22, 1]);
    }
    for (const a of [0.1, Math.PI - 0.1]) put(g, new THREE.SphereGeometry(0.03, 12, 10), dark, [Math.cos(a) * 0.32, 0.02, Math.sin(a) * 0.32]);
  };

  // ---- EYES ----
  M.g_aviators = (g) => {
    const frame = PAL.gold(), lens = PAL.glass(0x2a2a2e);
    for (const z of [-0.17, 0.17]) {
      put(g, cyl(0.15, 0.15, 0.018, 28), lens, [0, 0, z], [Math.PI / 2, 0.08, 0], [1, 1, 1.15]);
      put(g, new THREE.TorusGeometry(0.152, 0.015, 10, 32), frame, [0, 0, z], [0, 0, 0], [1, 1.15, 1]);
    }
    put(g, new THREE.TorusGeometry(0.06, 0.012, 8, 18, Math.PI), frame, [0, 0.06, 0], [0, Math.PI / 2, 0]);  // bridge
    put(g, bevelBox(0.03, 0.02, 0.1, 0.006), frame, [0, 0.1, 0]);
    for (const z of [-0.3, 0.3]) put(g, cyl(0.012, 0.012, 0.36, 10), frame, [-0.17, 0.05, z], [0, 0.2 * Math.sign(z), Math.PI / 2]);  // arms
  };
  M.g_shutter = (g) => {
    // First bake was an orange slab: the slats were inside the frame instead of cut through it.
    // Build the frame as a ring of bars with GAPS, which is the whole look.
    const frame = PAL.plastic(0xd4541e), dark = PAL.gunmetal();
    for (const z of [-0.2, 0.2]) {
      put(g, bevelBox(0.055, 0.26, 0.015, 0.006), frame, [0, 0, z + (z > 0 ? 0.17 : -0.17)]);  // outer uprights
      for (let i = 0; i < 6; i++) put(g, bevelBox(0.06, 0.028, 0.34, 0.008), frame, [0, 0.1 - i * 0.042, z]);  // the slats
      put(g, bevelBox(0.05, 0.015, 0.36, 0.005), dark, [0, 0.128, z]);
      put(g, bevelBox(0.05, 0.015, 0.36, 0.005), dark, [0, -0.128, z]);
    }
    put(g, bevelBox(0.05, 0.05, 0.06, 0.012), frame, [0, 0.1, 0]);     // bridge
    for (const z of [-0.39, 0.39]) {
      put(g, cyl(0.013, 0.013, 0.34, 10), frame, [-0.16, 0.08, z], [0, 0.22 * Math.sign(z), Math.PI / 2]);
      put(g, bevelBox(0.07, 0.03, 0.03, 0.008), dark, [-0.3, 0.05, z * 1.06]);
    }
  };
  M.g_patch = (g) => {
    const cloth = mat({ color: 0x15171b, metalness: 0, roughness: 0.92 });
    const strap = mat({ color: 0x1d2026, metalness: 0, roughness: 0.88 });
    const stitch = mat({ color: 0x8a7a52, metalness: 0, roughness: 0.9 });
    put(g, new THREE.SphereGeometry(0.2, 26, 18), cloth, [0, 0, 0], null, [1, 1.15, 0.42]);
    put(g, new THREE.TorusGeometry(0.2, 0.014, 10, 34), stitch, [0, 0, 0.055], [0, 0, 0], [1, 1.15, 1]);
    const c = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.19, 0.14, 0.0), new THREE.Vector3(-0.45, 0.2, -0.3),
      new THREE.Vector3(-0.3, -0.15, -0.5), new THREE.Vector3(0.18, -0.16, -0.02)]);
    put(g, new THREE.TubeGeometry(c, 36, 0.022, 8, false), strap, [0, 0, 0]);
  };
  M.g_monocle = (g) => {
    const gold = PAL.gold(), lens = PAL.glass(0xd8e8ff), chain = PAL.brass();
    put(g, cyl(0.19, 0.19, 0.012, 34), lens, [0, 0, 0], [Math.PI / 2, 0, 0]);
    put(g, new THREE.TorusGeometry(0.195, 0.022, 12, 38), gold, [0, 0, 0], [0, 0, 0]);
    put(g, new THREE.TorusGeometry(0.195, 0.008, 8, 38), gold, [0, 0, 0.02], [0, 0, 0]);
    put(g, bevelBox(0.05, 0.04, 0.03, 0.008), gold, [0.2, -0.08, 0], [0, 0, -0.5]);
    for (let i = 0; i < 12; i++) {
      const t = i / 11;
      put(g, new THREE.TorusGeometry(0.022, 0.007, 8, 16), chain,
          [0.26 + t * 0.26, -0.14 - Math.sin(t * 2.4) * 0.26, 0], [i % 2 ? 0 : Math.PI / 2, 0, 0.5]);
    }
  };

  // ---- NECK ----
  M.g_chain = (g) => {
    const gold = PAL.gold(), dark = PAL.brass();
    for (let i = 0; i < 34; i++) {                     // a rope chain, hanging in a V
      const t = i / 33, a = -Math.PI * 0.86 + t * Math.PI * 1.72;
      const x = Math.sin(a) * 0.34, y = -Math.abs(Math.cos(a)) * 0.2 - Math.pow(Math.abs(Math.sin(a)), 3) * 0.3;
      put(g, new THREE.TorusGeometry(0.038, 0.014, 9, 18), i % 2 ? gold : dark, [x, y + 0.2, 0], [i % 2 ? 0.5 : -0.5, 0, a]);
    }
    put(g, bevelBox(0.14, 0.16, 0.05, 0.02), gold, [0, -0.36, 0]);            // the pendant
    put(g, new THREE.TorusGeometry(0.04, 0.012, 8, 20), gold, [0, -0.26, 0], [0, Math.PI / 2, 0]);
    put(g, bevelBox(0.07, 0.085, 0.015, 0.006), dark, [0, -0.36, 0.03]);
  };
  M.g_scarf = (g) => {
    // Two attempts read as a stool, because tubes are round and a scarf is FLAT. This is a ribbon:
    // flat segments following a curve, draped round the neck with one tail over the shoulder.
    const wool = mat({ color: 0x8c2f2a, metalness: 0, roughness: 0.95 });
    const dark = mat({ color: 0x5c1f1c, metalness: 0, roughness: 0.95 });
    const ribbon = (curve, n, w, th, twist) => {
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1), pt = curve.getPoint(t), tan = curve.getTangent(t);
        const ang = Math.atan2(tan.y, tan.x);
        put(g, bevelBox(0.075, w, th, 0.012), i % 3 === 2 ? dark : wool,
            [pt.x, pt.y, pt.z], [twist * t, 0, ang]);
      }
    };
    // the loop round the neck, seen as a flat band
    const loop = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.3, 0.2, -0.1), new THREE.Vector3(-0.16, 0.34, 0.18),
      new THREE.Vector3(0.16, 0.34, 0.18), new THREE.Vector3(0.3, 0.2, -0.1)], false);
    ribbon(loop, 16, 0.2, 0.075, 0.2);
    // the long tail down the front
    const tail = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.22, 0.18, 0.14), new THREE.Vector3(0.26, -0.1, 0.2),
      new THREE.Vector3(0.18, -0.4, 0.16), new THREE.Vector3(0.2, -0.64, 0.1)]);
    ribbon(tail, 18, 0.22, 0.07, 0.5);
    // the short one tucked behind it
    const tail2 = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.2, 0.18, 0.12), new THREE.Vector3(-0.24, -0.04, 0.16),
      new THREE.Vector3(-0.2, -0.3, 0.1)]);
    ribbon(tail2, 12, 0.2, 0.065, -0.3);
    for (let i = 0; i < 6; i++) put(g, cyl(0.013, 0.009, 0.14, 8), dark, [0.13 + i * 0.027, -0.72, 0.1], [0, 0, 0.1]);   // fringe
    for (let i = 0; i < 5; i++) put(g, cyl(0.013, 0.009, 0.12, 8), dark, [-0.26 + i * 0.027, -0.38, 0.1], [0, 0, 0.1]);
  };
  M.g_tags = (g) => {
    const steel = PAL.chrome(), ball = PAL.steel(), rub = PAL.rubber();
    for (let i = 0; i < 40; i++) {
      const t = i / 39, a = -Math.PI * 0.88 + t * Math.PI * 1.76;
      const x = Math.sin(a) * 0.32, y = -Math.abs(Math.cos(a)) * 0.18 - Math.pow(Math.abs(Math.sin(a)), 3) * 0.28;
      put(g, new THREE.SphereGeometry(0.021, 10, 8), ball, [x, y + 0.2, 0]);
    }
    for (const [dx, dz, rz] of [[-0.035, 0.02, 0.1], [0.035, -0.02, -0.08]]) {
      put(g, bevelBox(0.13, 0.21, 0.016, 0.028), steel, [dx, -0.38, dz], [0, 0, rz]);
      put(g, cyl(0.016, 0.016, 0.02, 12), rub, [dx, -0.3, dz], [Math.PI / 2, 0, 0]);
      for (let i = 0; i < 4; i++) put(g, bevelBox(0.075, 0.009, 0.004, 0.002), rub, [dx, -0.34 - i * 0.025, dz + 0.009], [0, 0, rz]);
    }
  };
  M.g_ice = (g) => {
    const plat = PAL.chrome(), ice = PAL.glass(0xdff2ff), dark = PAL.gunmetal();
    for (let i = 0; i < 30; i++) {
      const t = i / 29, a = -Math.PI * 0.86 + t * Math.PI * 1.72;
      const x = Math.sin(a) * 0.34, y = -Math.abs(Math.cos(a)) * 0.2 - Math.pow(Math.abs(Math.sin(a)), 3) * 0.3;
      put(g, bevelBox(0.055, 0.05, 0.05, 0.012), plat, [x, y + 0.2, 0], [0, 0, a]);
      put(g, new THREE.OctahedronGeometry(0.026, 0), ice, [x, y + 0.2, 0.03], [0.4, a, 0]);
    }
    put(g, bevelBox(0.19, 0.19, 0.05, 0.016), plat, [0, -0.38, 0], [0, 0, Math.PI / 4]);
    for (let i = 0; i < 9; i++) {
      const cx = -0.05 + (i % 3) * 0.05, cy = -0.43 + Math.floor(i / 3) * 0.05;
      put(g, new THREE.OctahedronGeometry(0.03, 0), ice, [cx, cy, 0.035], [0.3, 0.4, 0]);
    }
  };

  // ---- HANDS ----
  M.g_tape = (g) => {
    // Third attempt. Separate modelled fingers kept reading as machinery, so this is the honest
    // object instead of the pose: a part-used roll of tape next to a wrapped fist. A shop tile is
    // 200 px and the roll is what makes it instantly a WRAP rather than a glove.
    const wrap = mat({ color: 0xdcd6c8, metalness: 0, roughness: 0.93 });
    const dirt = mat({ color: 0xa2998b, metalness: 0, roughness: 0.96 });
    // the roll
    put(g, cyl(0.26, 0.26, 0.2, 40), wrap, [-0.3, 0, 0], [0, 0, Math.PI / 2]);
    put(g, cyl(0.1, 0.1, 0.21, 28), dirt, [-0.3, 0, 0], [0, 0, Math.PI / 2]);
    for (let i = 0; i < 7; i++) put(g, new THREE.TorusGeometry(0.262, 0.012, 8, 40), i % 2 ? dirt : wrap, [-0.39 + i * 0.03, 0, 0], [0, Math.PI / 2, 0]);
    // the loose end coming off it
    const c = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.3, -0.26, 0), new THREE.Vector3(-0.05, -0.34, 0.03), new THREE.Vector3(0.18, -0.22, 0.02)]);
    for (let i = 0; i < 12; i++) {
      const t = i / 11, pt = c.getPoint(t), tan = c.getTangent(t);
      put(g, bevelBox(0.07, 0.2, 0.022, 0.006), wrap, [pt.x, pt.y, pt.z], [0, 0, Math.atan2(tan.y, tan.x)]);
    }
    // the wrapped fist beside it
    const fist = new THREE.Group();
    put(fist, bevelBox(0.3, 0.3, 0.26, 0.085), wrap, [0, 0, 0]);
    for (let i = 0; i < 4; i++) put(fist, new THREE.TorusGeometry(0.052, 0.022, 10, 20), dirt, [0.13, 0.11 - i * 0.07, 0], [0, Math.PI / 2, 0]);  // knuckle ridges
    for (let i = 0; i < 3; i++) put(fist, bevelBox(0.31, 0.05, 0.27, 0.014), i === 1 ? dirt : wrap, [0.004, 0.09 - i * 0.09, 0], [0, 0, 0.1 * (i % 2 ? -1 : 1)]);
    put(fist, new THREE.SphereGeometry(0.085, 18, 12), wrap, [0.06, -0.17, 0.11], null, [1, 1.25, 1]);   // thumb
    for (let i = 0; i < 4; i++) put(fist, new THREE.TorusGeometry(0.155, 0.032, 12, 30), i % 2 ? wrap : dirt, [-0.2 - i * 0.05, -0.02, 0], [0, Math.PI / 2, 0.05]);
    fist.position.set(0.42, 0.1, 0); fist.rotation.y = -0.3;
    g.add(fist);
  };
  M.g_mitts = (g) => pair(g, (b) => {
    const leather = mat({ color: 0x1a1d22, metalness: 0.05, roughness: 0.8 });
    const trim = PAL.plastic(0xd4541e), steel = PAL.steel();
    put(b, bevelBox(0.3, 0.26, 0.18, 0.055), leather, [0, 0, 0]);
    for (let i = 0; i < 4; i++) put(b, cyl(0.035, 0.035, 0.1, 14), leather, [0.14, 0.11 - i * 0.055, -0.055 + i * 0.037], [0, 0, 1.2]);  // cut fingers
    put(b, bevelBox(0.09, 0.26, 0.19, 0.02), trim, [-0.13, 0, 0]);                 // cuff
    put(b, new THREE.TorusGeometry(0.03, 0.008, 8, 16), steel, [-0.13, 0.1, 0.1], [0, Math.PI / 2, 0]);
    put(b, bevelBox(0.1, 0.09, 0.012, 0.004), trim, [0.02, 0.0, 0.095]);
  }, 0.3);
  M.g_rings = (g) => pair(g, (b) => {
    const gold = PAL.gold(), dark = PAL.gunmetal(), ice = PAL.glass(0xdff2ff);
    for (let i = 0; i < 4; i++) {
      const y = 0.11 - i * 0.075, z = -0.08 + i * 0.053;
      put(b, cyl(0.055, 0.055, 0.085, 20), dark, [0.06, y, z], [0, 0, Math.PI / 2]);  // the finger
      put(b, new THREE.TorusGeometry(0.058, 0.019, 10, 22), gold, [0.06, y, z], [0, Math.PI / 2, 0]);
      if (i % 2 === 0) put(b, new THREE.OctahedronGeometry(0.028, 0), ice, [0.06, y + 0.07, z]);
    }
    put(b, bevelBox(0.14, 0.26, 0.18, 0.04), dark, [-0.08, 0, 0]);
  }, 0.3);
  M.g_watch = (g) => {
    const gold = PAL.gold(), face = PAL.plastic(0x12161c), glass = PAL.glass(0xeaf4ff), dark = PAL.brass();
    put(g, cyl(0.21, 0.21, 0.07, 36), gold, [0, 0, 0], [Math.PI / 2, 0, 0]);
    put(g, cyl(0.17, 0.17, 0.02, 36), face, [0, 0, 0.04], [Math.PI / 2, 0, 0]);
    put(g, cyl(0.175, 0.175, 0.012, 36), glass, [0, 0, 0.055], [Math.PI / 2, 0, 0]);
    put(g, new THREE.TorusGeometry(0.2, 0.022, 12, 40), gold, [0, 0, 0.03], [0, 0, 0]);
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; put(g, bevelBox(0.025, 0.012, 0.01, 0.003), gold, [Math.cos(a) * 0.14, Math.sin(a) * 0.14, 0.05], [0, 0, a]); }
    put(g, bevelBox(0.11, 0.014, 0.012, 0.004), gold, [0.04, 0.02, 0.06], [0, 0, 0.5]);
    put(g, bevelBox(0.075, 0.014, 0.012, 0.004), gold, [-0.02, -0.03, 0.06], [0, 0, 2.1]);
    put(g, cyl(0.03, 0.03, 0.05, 16), dark, [0.22, 0, 0], [0, 0, Math.PI / 2]);        // crown
    for (let i = 0; i < 6; i++) {                                                       // the bracelet
      const s = i < 3 ? 1 : -1, k = i % 3;
      put(g, bevelBox(0.11, 0.085, 0.055, 0.016), gold, [0, s * (0.22 + k * 0.1), -0.01], [0, 0, 0]);
      put(g, bevelBox(0.03, 0.085, 0.06, 0.012), dark, [0, s * (0.27 + k * 0.1), -0.01]);
    }
  };
  M.g_gaunt = (g) => pair(g, (b) => {
    const steel = mat({ color: 0x6a727c, metalness: 1, roughness: 0.34 });
    const dark = PAL.gunmetal(), gold = PAL.brass();
    put(b, bevelBox(0.3, 0.27, 0.2, 0.045), steel, [0, 0, 0]);
    for (let i = 0; i < 4; i++) put(b, bevelBox(0.075, 0.055, 0.21, 0.014), dark, [0.1 - i * 0.055, 0.1 - i * 0.012, 0]);   // knuckle plates
    for (let i = 0; i < 4; i++) put(b, new THREE.SphereGeometry(0.03, 12, 10), gold, [0.13, 0.12 - i * 0.06, -0.07 + i * 0.047]);  // studs
    for (let i = 0; i < 3; i++) put(b, bevelBox(0.055, 0.27, 0.215, 0.018), steel, [-0.12 - i * 0.06, -0.01 * i, 0]);       // vambrace
    put(b, new THREE.TorusGeometry(0.14, 0.022, 10, 26), gold, [-0.18, 0, 0], [0, Math.PI / 2, 0]);
  }, 0.32);

  // ---- FEET ----
  M.g_hitops = (g) => shoe(g, { hi: 0.56, toeCap: true,
    upper: mat({ color: 0xb8322e, metalness: 0.05, roughness: 0.72 }),
    cap: mat({ color: 0xe8e4dc, metalness: 0, roughness: 0.6 }),
    sole: mat({ color: 0xe8e4dc, metalness: 0, roughness: 0.7 }),
    lace: mat({ color: 0xf2efe8, metalness: 0, roughness: 0.9 }) });
  M.g_sliders = (g) => {
    const strap = PAL.plastic(0x1d2026), sole = mat({ color: 0x2a2e35, metalness: 0, roughness: 0.82 });
    const trim = PAL.plastic(0xd4541e);
    const one = (ox, oz, ry) => {
      const b = new THREE.Group();
      put(b, bevelBox(0.72, 0.085, 0.3, 0.05), sole, [0, 0, 0]);
      put(b, bevelBox(0.66, 0.05, 0.26, 0.04), trim, [0, 0.06, 0]);
      put(b, new THREE.TorusGeometry(0.17, 0.055, 12, 28, Math.PI), strap, [0.12, 0.06, 0], [0, 0, 0], [1, 0.7, 1.08]);
      put(b, bevelBox(0.07, 0.03, 0.26, 0.01), trim, [0.12, 0.18, 0]);
      for (let i = 0; i < 4; i++) put(b, bevelBox(0.07, 0.03, 0.3, 0.008), sole, [-0.22 + i * 0.12, -0.05, 0]);
      b.position.set(ox, 0, oz); b.rotation.y = ry;
      return b;
    };
    g.add(one(-0.08, -0.26, -0.14)); g.add(one(0.08, 0.26, 0.12));
  };
  M.g_steels = (g) => shoe(g, { hi: 0.56, toeCap: true,
    upper: mat({ color: 0x1a1512, metalness: 0.05, roughness: 0.82 }),
    cap: mat({ color: 0xccd4de, metalness: 1, roughness: 0.15 }),
    sole: PAL.rubber(),
    lace: mat({ color: 0x8a7a52, metalness: 0, roughness: 0.88 }) });
  M.g_golds = (g) => shoe(g, { hi: 0.42, toeCap: true,
    upper: mat({ color: 0xc8991f, metalness: 1, roughness: 0.26 }),
    cap: mat({ color: 0xeedb8a, metalness: 1, roughness: 0.14 }),
    sole: mat({ color: 0x2a2419, metalness: 0.2, roughness: 0.6 }),
    lace: mat({ color: 0xeedb8a, metalness: 0.8, roughness: 0.3 }) });

  // ---- BACK ----
  M.g_pack = (g) => {
    const canvas = mat({ color: 0x2b3a2a, metalness: 0, roughness: 0.88 });
    const strap = mat({ color: 0x1a1d22, metalness: 0.05, roughness: 0.82 });
    const buckle = PAL.steel(), trim = PAL.plastic(0xd4541e);
    put(g, bevelBox(0.5, 0.62, 0.3, 0.07), canvas, [0, 0, 0]);
    put(g, bevelBox(0.46, 0.22, 0.28, 0.06), canvas, [0, 0.26, 0.02]);          // lid
    put(g, bevelBox(0.38, 0.2, 0.1, 0.035), canvas, [0, -0.12, 0.17]);          // front pocket
    put(g, bevelBox(0.4, 0.03, 0.03, 0.01), trim, [0, -0.02, 0.21]);            // zip
    for (const x of [-0.14, 0.14]) {
      put(g, bevelBox(0.07, 0.07, 0.05, 0.014), buckle, [x, 0.14, 0.17]);
      put(g, bevelBox(0.055, 0.3, 0.04, 0.012), strap, [x, 0.26, 0.16]);
      put(g, bevelBox(0.06, 0.56, 0.05, 0.015), strap, [x, -0.02, -0.17]);      // shoulder straps
    }
    put(g, new THREE.TorusGeometry(0.07, 0.016, 10, 20, Math.PI), strap, [0, 0.4, -0.04], [0, 0, 0]);
  };
  M.g_cape = (g) => {
    const cloth = mat({ color: 0x7a1220, metalness: 0, roughness: 0.9, side: THREE.DoubleSide });
    const lining = mat({ color: 0x2a0a10, metalness: 0, roughness: 0.92, side: THREE.DoubleSide });
    const clasp = PAL.gold();
    // a cloth that falls and flares, built from a lathe-like sweep so it is not a flat plane
    const pts = [];
    for (let i = 0; i <= 24; i++) { const t = i / 24; pts.push(new THREE.Vector2(0.16 + Math.pow(t, 1.7) * 0.42, 0.44 - t * 0.98)); }
    const lathe = new THREE.LatheGeometry(pts, 40, -0.6, 2.5);
    put(g, lathe, cloth, [0, 0, 0]);
    const lathe2 = new THREE.LatheGeometry(pts.map(v => new THREE.Vector2(v.x * 0.96, v.y)), 40, -0.56, 2.42);
    put(g, lathe2, lining, [0, 0, 0]);
    put(g, new THREE.TorusGeometry(0.2, 0.035, 12, 30, Math.PI * 1.4), clasp, [0, 0.44, 0], [Math.PI / 2, 0, -0.3]);
    put(g, new THREE.SphereGeometry(0.06, 18, 14), clasp, [0.2, 0.44, 0]);
    put(g, new THREE.SphereGeometry(0.06, 18, 14), clasp, [-0.2, 0.44, 0]);
  };
  M.g_katana = (g) => {
    const steel = PAL.chrome(), dark = PAL.gunmetal(), wrap = mat({ color: 0x1d2228, metalness: 0, roughness: 0.88 });
    const gold = PAL.brass(), saya = mat({ color: 0x14171c, metalness: 0.25, roughness: 0.42 });
    put(g, cyl(0.055, 0.045, 0.98, 20), saya, [0, 0, 0], [0, 0, Math.PI / 2 - 0.16]);     // scabbard
    put(g, cyl(0.05, 0.05, 0.05, 20), gold, [0.42, 0.08, 0], [0, 0, Math.PI / 2 - 0.16]);
    put(g, new THREE.TorusGeometry(0.06, 0.012, 10, 24), gold, [-0.3, -0.05, 0], [0, Math.PI / 2 - 0.16, 0]);
    put(g, cyl(0.05, 0.055, 0.3, 20), wrap, [0.62, 0.12, 0], [0, 0, Math.PI / 2 - 0.16]);  // the handle out of the top
    for (let i = 0; i < 7; i++) put(g, bevelBox(0.03, 0.055, 0.055, 0.008), gold, [0.52 + i * 0.038, 0.1 + i * 0.006, 0], [0, 0, 0.5 - 0.16]);
    put(g, cyl(0.1, 0.1, 0.022, 26), dark, [0.47, 0.09, 0], [0, 0, Math.PI / 2 - 0.16]);   // tsuba
    put(g, new THREE.TorusGeometry(0.1, 0.01, 8, 26), gold, [0.47, 0.09, 0], [0, Math.PI / 2 - 0.16, 0]);
    const c = new THREE.CatmullRomCurve3([new THREE.Vector3(-0.3, -0.05, 0.05), new THREE.Vector3(0, 0.3, 0.14), new THREE.Vector3(0.3, 0.02, 0.05)]);
    put(g, new THREE.TubeGeometry(c, 24, 0.014, 8, false), wrap, [0, 0, 0]);               // the sling
  };
  M.g_wings = (g) => {
    const feather = mat({ color: 0xe4e8ef, metalness: 0.1, roughness: 0.56 });
    const inner = mat({ color: 0xb8c0cc, metalness: 0.1, roughness: 0.6 });
    const bone = mat({ color: 0x8a93a0, metalness: 0.4, roughness: 0.46 });
    const one = (s) => {
      const w = new THREE.Group();
      const spine = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.3 * s, 0.3, -0.04),
        new THREE.Vector3(0.66 * s, 0.34, -0.1), new THREE.Vector3(0.92 * s, 0.1, -0.16)]);
      put(w, new THREE.TubeGeometry(spine, 30, 0.028, 8, false), bone, [0, 0, 0]);
      for (let i = 0; i < 13; i++) {
        const t = i / 12, p = spine.getPoint(t * 0.94);
        const len = 0.18 + Math.sin(t * Math.PI) * 0.4;
        put(w, new THREE.SphereGeometry(len * 0.5, 12, 8), i % 3 ? feather : inner,
            [p.x, p.y - len * 0.42, p.z - 0.01 * i],
            [0, 0, s * (0.5 - t * 1.25)], [0.19, 1, 0.5]);
      }
      return w;
    };
    g.add(one(1)); g.add(one(-1));
  };

  // ---- the two things the case economy is actually made of ----
  // These were emoji on the first pass, which is why they looked like garbage next to 27 baked
  // renders. A crate key is not a house key: it is a short, heavy, stamped thing you would find on
  // a loading dock, and the crate is a scuffed road case, not a cardboard box.
  M.g_key = (g) => {
    const brass = mat({ color: 0xb8892a, metalness: 1, roughness: 0.26 });
    const worn = mat({ color: 0x8a6520, metalness: 1, roughness: 0.42 });
    const dark = PAL.gunmetal(), accent = PAL.plastic(0xd4541e);
    // the bow: a thick hex plate with a stamped face, not a loop
    const hex = new THREE.CylinderGeometry(0.3, 0.3, 0.07, 6);
    put(g, hex, brass, [-0.28, 0, 0], [Math.PI / 2, 0, 0]);
    put(g, new THREE.CylinderGeometry(0.21, 0.21, 0.085, 6), worn, [-0.28, 0, 0], [Math.PI / 2, 0, 0]);
    put(g, new THREE.TorusGeometry(0.3, 0.022, 10, 6), dark, [-0.28, 0, 0], [0, 0, 0]);
    put(g, cyl(0.055, 0.055, 0.1, 20), dark, [-0.28, 0, 0], [Math.PI / 2, 0, 0]);          // the hole
    put(g, bevelBox(0.16, 0.05, 0.016, 0.005), accent, [-0.28, -0.1, 0.04]);               // stamped bar
    // the shank: short and fat
    put(g, cyl(0.062, 0.062, 0.46, 22), brass, [0.14, 0, 0], [0, 0, Math.PI / 2]);
    for (let i = 0; i < 3; i++) put(g, new THREE.TorusGeometry(0.066, 0.014, 10, 22), worn, [-0.02 + i * 0.07, 0, 0], [0, Math.PI / 2, 0]);
    // the bit: square teeth, cut like a tubular key
    put(g, bevelBox(0.2, 0.17, 0.05, 0.012), brass, [0.4, -0.07, 0]);
    for (let i = 0; i < 3; i++) put(g, bevelBox(0.045, 0.07, 0.055, 0.008), dark, [0.33 + i * 0.062, -0.14 - (i % 2) * 0.04, 0]);
    put(g, cyl(0.05, 0.035, 0.07, 18), worn, [0.52, 0, 0], [0, 0, Math.PI / 2]);           // the tip
  };

  M.g_crate = (g) => {
    const shell = PAL.polymer(0x2a3038), edge = mat({ color: 0x4a525c, metalness: 1, roughness: 0.4 });
    const hazard = PAL.hazard(), dark = PAL.gunmetal(), steel = PAL.steel();
    put(g, bevelBox(0.78, 0.56, 0.5, 0.035), shell, [0, 0, 0]);
    put(g, bevelBox(0.8, 0.07, 0.52, 0.02), edge, [0, 0.19, 0]);                            // lid seam
    // corner protectors, the thing that says road case rather than cardboard
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      put(g, bevelBox(0.1, 0.6, 0.06, 0.016), edge, [sx * 0.37, 0, sz * 0.25]);
      put(g, bevelBox(0.06, 0.6, 0.1, 0.016), edge, [sx * 0.39, 0, sz * 0.23]);
    }
    for (const sx of [-1, 1]) {                                                             // latches
      put(g, bevelBox(0.09, 0.11, 0.05, 0.014), steel, [sx * 0.18, 0.19, 0.26]);
      put(g, bevelBox(0.05, 0.05, 0.03, 0.008), dark, [sx * 0.18, 0.15, 0.29]);
    }
    put(g, new THREE.TorusGeometry(0.09, 0.022, 10, 24, Math.PI), dark, [0, 0.3, 0], [0, 0, 0]);  // handle
    // hazard stripes down one face and a stencilled panel, so it reads as cargo
    for (let i = 0; i < 5; i++) put(g, bevelBox(0.055, 0.2, 0.012, 0.004), hazard, [-0.24 + i * 0.1, -0.16, 0.251], [0, 0, 0.6]);
    put(g, bevelBox(0.3, 0.14, 0.012, 0.005), dark, [0.12, 0.02, 0.251]);
    put(g, bevelBox(0.26, 0.03, 0.014, 0.004), hazard, [0.12, 0.05, 0.254]);
    put(g, bevelBox(0.2, 0.03, 0.014, 0.004), hazard, [0.09, 0.0, 0.254]);
    for (let i = 0; i < 4; i++) put(g, new THREE.SphereGeometry(0.018, 10, 8), steel, [-0.3 + i * 0.2, -0.26, 0.25]);  // rivets
  };

  M.bolt = (g) => {                                   // captive bolt
    // Anton Chigurh's cattle stunner from No Country for Old Men: a captive bolt pistol fed by a
    // compressed air tank on a hose. It is a real abattoir tool, so it is built like one -- a plain
    // steel cylinder with a muzzle shroud, a rubber grip, and an industrial tank with a gauge.
    const steel = mat({ color: 0x8d949e, metalness: 1, roughness: 0.3 });
    const dark  = mat({ color: 0x1b1f25, metalness: 0.9, roughness: 0.44 });
    const tankM = mat({ color: 0x9aa3ad, metalness: 1, roughness: 0.34 });
    const tankD = mat({ color: 0x5b646e, metalness: 1, roughness: 0.42 });
    const grip  = mat({ color: 0x17191d, metalness: 0.1, roughness: 0.84 });
    const hose  = mat({ color: 0x14161a, metalness: 0, roughness: 0.9 });
    const brass = PAL.brass(), gauge = PAL.emissive(0xdfe8f2, 1.6);

    // ---- the stunner itself ----
    put(g, cyl(0.085, 0.085, 0.44, 28), steel, [0.24, 0.1, 0], [0, 0, Math.PI / 2]);     // the barrel body
    for (const x of [0.09, 0.3]) put(g, new THREE.TorusGeometry(0.088, 0.016, 10, 28), dark, [x, 0.1, 0], [0, Math.PI / 2, 0]);
    put(g, cyl(0.07, 0.06, 0.1, 24), dark, [0.5, 0.1, 0], [0, 0, Math.PI / 2]);          // the muzzle shroud
    put(g, new THREE.TorusGeometry(0.063, 0.012, 10, 24), steel, [0.54, 0.1, 0], [0, Math.PI / 2, 0]);
    put(g, cyl(0.016, 0.016, 0.1, 14), steel, [0.57, 0.1, 0], [0, 0, Math.PI / 2]);      // the bolt, just proud
    put(g, bevelBox(0.1, 0.075, 0.09, 0.018), dark, [0.04, 0.1, 0]);                      // breech block
    put(g, bevelBox(0.07, 0.2, 0.075, 0.02), grip, [-0.02, -0.04, 0], [0, 0, 0.2]);       // pistol grip
    for (let i = 0; i < 4; i++) put(g, bevelBox(0.075, 0.016, 0.08, 0.006), dark, [-0.03 - i * 0.012, -0.02 - i * 0.04, 0], [0, 0, 0.2]);
    put(g, new THREE.TorusGeometry(0.042, 0.011, 8, 18), dark, [0.08, 0.02, 0], [0, Math.PI / 2, 0]);  // trigger guard
    put(g, bevelBox(0.03, 0.05, 0.02, 0.006), steel, [0.08, 0.03, 0], [0, 0, 0.3]);
    put(g, bevelBox(0.12, 0.03, 0.03, 0.008), steel, [0.2, 0.19, 0]);                     // top rib

    // ---- the air tank it runs off ----
    const tank = new THREE.Group();
    put(tank, cyl(0.14, 0.14, 0.52, 30), tankM, [0, 0, 0]);
    put(tank, new THREE.SphereGeometry(0.14, 28, 18), tankM, [0, 0.26, 0], null, [1, 0.6, 1]);
    put(tank, new THREE.SphereGeometry(0.14, 28, 18), tankM, [0, -0.26, 0], null, [1, 0.6, 1]);
    for (const y of [0.17, -0.17]) put(tank, new THREE.TorusGeometry(0.142, 0.018, 10, 32), tankD, [0, y, 0], [Math.PI / 2, 0, 0]);
    put(tank, bevelBox(0.19, 0.12, 0.03, 0.01), tankD, [0, 0.02, 0.14]);                  // label plate
    put(tank, cyl(0.045, 0.045, 0.09, 20), tankD, [0, 0.36, 0]);                          // the valve
    put(tank, new THREE.TorusGeometry(0.05, 0.014, 10, 20), brass, [0, 0.4, 0], [Math.PI / 2, 0, 0]);
    put(tank, cyl(0.055, 0.055, 0.03, 20), dark, [0.09, 0.33, 0], [0, 0, Math.PI / 2]);   // the gauge
    put(tank, cyl(0.042, 0.042, 0.014, 20), gauge, [0.11, 0.33, 0], [0, 0, Math.PI / 2]);
    put(tank, new THREE.TorusGeometry(0.056, 0.01, 8, 20), brass, [0.1, 0.33, 0], [0, Math.PI / 2, 0]);
    tank.position.set(-0.46, 0.0, -0.06); tank.rotation.z = 0.22;
    g.add(tank);

    // ---- the hose, the detail that makes it this weapon and not a drill ----
    const h = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.07, 0.02, 0.02), new THREE.Vector3(-0.22, -0.16, 0.06),
      new THREE.Vector3(-0.42, -0.1, 0.0), new THREE.Vector3(-0.42, 0.3, -0.04)]);
    put(g, new THREE.TubeGeometry(h, 40, 0.028, 10, false), hose, [0, 0, 0]);
    for (let i = 0; i < 9; i++) { const pt = h.getPoint(0.08 + i * 0.1);
      put(g, new THREE.TorusGeometry(0.031, 0.008, 8, 16), dark, [pt.x, pt.y, pt.z], [1.2, 0.4 * i, 0]); }
    put(g, cyl(0.036, 0.036, 0.05, 16), brass, [-0.06, 0.03, 0.02], [0, 0, 1.1]);
  };

  M.thunder = (g) => {                                // thunderbolt
    // QUAKE's Thunderbolt. The silhouette everyone remembers is the THREE-PRONG emitter at the
    // muzzle with the arc jumping between the tips, over a boxy slab of a receiver and a big
    // cylindrical battery underneath.
    const body  = mat({ color: 0x2b3038, metalness: 0.85, roughness: 0.36 });
    const plate = mat({ color: 0x3c434d, metalness: 0.9, roughness: 0.3 });
    const dark  = mat({ color: 0x14171c, metalness: 0.8, roughness: 0.44 });
    const steel = PAL.steel(), brass = PAL.brass();
    const arc   = PAL.emissive(0x8fd8ff, 3.6), core = PAL.emissive(0x4fa8ff, 3);

    put(g, bevelBox(0.58, 0.17, 0.16, 0.03), body, [0.02, 0.12, 0]);                      // receiver
    put(g, bevelBox(0.4, 0.05, 0.17, 0.014), plate, [0.06, 0.21, 0]);                     // top rail
    for (let i = 0; i < 6; i++) put(g, bevelBox(0.016, 0.04, 0.175, 0.005), dark, [-0.08 + i * 0.045, 0.235, 0]);
    put(g, cyl(0.1, 0.1, 0.3, 26), plate, [-0.02, -0.02, 0], [0, 0, Math.PI / 2]);        // the battery drum
    for (const x of [-0.14, 0.1]) put(g, new THREE.TorusGeometry(0.102, 0.016, 10, 28), dark, [x, -0.02, 0], [0, Math.PI / 2, 0]);
    for (let i = 0; i < 3; i++) put(g, new THREE.TorusGeometry(0.104, 0.009, 8, 28), core, [-0.07 + i * 0.05, -0.02, 0], [0, Math.PI / 2, 0]);
    // ---- the three-prong emitter ----
    put(g, cyl(0.075, 0.09, 0.12, 24), dark, [0.36, 0.12, 0], [0, 0, Math.PI / 2]);
    put(g, new THREE.TorusGeometry(0.085, 0.014, 10, 26), steel, [0.4, 0.12, 0], [0, Math.PI / 2, 0]);
    const tips = [];
    for (let i = 0; i < 3; i++) {
      const a = i / 3 * Math.PI * 2 - Math.PI / 2;
      const y = 0.12 + Math.cos(a) * 0.075, z = Math.sin(a) * 0.075;
      put(g, cyl(0.016, 0.01, 0.26, 12), steel, [0.55, y, z], [0, 0, Math.PI / 2]);
      put(g, new THREE.ConeGeometry(0.022, 0.07, 12), brass, [0.7, y, z], [0, 0, -Math.PI / 2]);
      tips.push([0.71, y, z]);
    }
    // the arc jumping between the tips
    for (let i = 0; i < 3; i++) {
      const a = tips[i], b = tips[(i + 1) % 3];
      const mid = new THREE.Vector3((a[0] + b[0]) / 2 + 0.07, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
      const c = new THREE.CatmullRomCurve3([new THREE.Vector3(...a), mid, new THREE.Vector3(...b)]);
      put(g, new THREE.TubeGeometry(c, 16, 0.009, 6, false), arc, [0, 0, 0]);
    }
    put(g, new THREE.SphereGeometry(0.045, 20, 14), core, [0.62, 0.12, 0]);               // the core between them
    // grip, trigger, stock
    put(g, bevelBox(0.08, 0.21, 0.08, 0.02), dark, [-0.08, -0.02, 0], [0, 0, 0.16]);
    put(g, new THREE.TorusGeometry(0.045, 0.012, 8, 18), dark, [0.0, 0.03, 0], [0, Math.PI / 2, 0]);
    put(g, bevelBox(0.2, 0.09, 0.09, 0.022), body, [-0.32, 0.1, 0], [0, 0, 0.1]);
    put(g, bevelBox(0.05, 0.14, 0.1, 0.018), dark, [-0.42, 0.08, 0], [0, 0, 0.1]);
    put(g, cyl(0.02, 0.02, 0.2, 12), core, [-0.24, 0.05, 0.07], [0, 0, Math.PI / 2 + 0.3]); // power lead
  };

  // Explicit angles, only for the shapes the automatic profile/chunky choice gets wrong.
  M.__VIEW = {
    well:    { y: -0.3, x: 0.16, z: 0 },
    medkit:  { y: -0.46, x: 0.40, z: 0 },      // tipped forward so the cross on the lid leads
    turret:  { y: -0.52, x: 0.16, z: 0 },
    aegis:   { y: -0.52, x: 0.2, z: 0 },   // three-quarter from slightly above: shows the props AND the shield
    gloves:  { y: -0.42, x: 0.16, z: 0 },
    blaster: { y: -0.20, x: 0.24, z: -0.08 },
    bow:     { y: -0.16, x: 0.12, z: -0.06 },  // profile: a speargun is its length
    manhole: { y: -0.36, x: 0.38, z: 0 },      // angled, so both open jaws read
    mine:    { y: -0.62, x: 0.42, z: 0 },
    bolt:    { y: -0.2, x: 0.14, z: 0 },      // profile: the tank and hose are the silhouette
    // a pistol IS its side profile. The Deagle measures 1.7:1, under the 2.1 that picks PROFILE
    // automatically, so it was getting the chunky three-quarter: that foreshortened the slide,
    // hid the rail teeth and the ejection port, and turned the most recognisable pistol ever made
    // into a gold box. Near side-on, with just enough turn to keep the top rib readable.
    deagle:  { y: -0.15, x: 0.10, z: -0.03 },
    thunder: { y: -0.18, x: 0.12, z: 0 },     // profile: the three-prong emitter has to read     // the SLAM's own three-quarter-from-above
    boots:   { y: -0.12, x: 0.1, z: 0 },      // profile: a boot is its silhouette, and the pod sits at the heel
    wreck:   { y: -0.30, x: 0.12, z: 0 },
    // gear: a shoe reads from the side, a hat from a low three-quarter, a chain dead on
    g_hitops:{ y: -0.10, x: 0.08, z: 0 }, g_steels:{ y: -0.10, x: 0.08, z: 0 },
    g_golds: { y: -0.10, x: 0.08, z: 0 }, g_sliders:{ y: -0.16, x: 0.26, z: 0 },
    g_visor: { y: -0.5, x: 0.2, z: 0 },  g_snapback:{ y: -0.6, x: 0.16, z: 0 },
    g_fedora:{ y: -0.4, x: 0.26, z: 0 }, g_cans:  { y: -0.5, x: 0.14, z: 0 },
    g_pilot: { y: -0.5, x: 0.16, z: 0 }, g_wreath:{ y: -0.3, x: 0.46, z: 0 },
    g_chain: { y: -0.12, x: 0.1, z: 0 }, g_tags:  { y: -0.12, x: 0.1, z: 0 },
    g_scarf: { y: -0.22, x: 0.08, z: 0 },
    g_key:   { y: -0.2, x: 0.3, z: 0 }, g_crate: { y: -0.52, x: 0.18, z: 0 }, g_tape:  { y: -0.3, x: 0.18, z: 0 },
    g_ice:   { y: -0.12, x: 0.1, z: 0 },
    g_aviators:{ y: -0.4, x: 0.2, z: 0 }, g_shutter:{ y: -0.45, x: 0.18, z: 0 },
    g_patch: { y: -0.5, x: 0.16, z: 0 }, g_monocle:{ y: -0.3, x: 0.16, z: 0 },
    g_watch: { y: -0.3, x: 0.14, z: 0 }, g_wings: { y: -0.16, x: 0.12, z: 0 },
    g_cape:  { y: -0.3, x: 0.14, z: 0 }, g_katana:{ y: -0.2, x: 0.12, z: -0.05 },
    g_pack:  { y: -0.45, x: 0.16, z: 0 },      // a boot reads from the SIDE: profile, like the rocket boots
  };
  return M;
}
