// ===== 3D: procedural poses laid over the clips: a real crouch, a round hammer swing, gun aiming =====
// Visual only: reads Game / fighter state, never writes it, never touches the seeded fight RNG.
// V3.decorate (92_v3_items.mjs) calls V3.poseFrame(av) once the mixer has written this frame's clip pose,
// so everything here bends the bones the clip produced and the held prop (placed right after) follows.
// Wrapped in a block so its names can't collide with the other .mjs files (they share one module scope).
{
  const PZ_UP = new THREE.Vector3(0, 1, 0);
  const pzQP = new THREE.Quaternion(), pzQI = new THREE.Quaternion(), pzQR = new THREE.Quaternion();
  const pzQD = new THREE.Quaternion(), pzQA = new THREE.Quaternion(), pzQ1 = new THREE.Quaternion();
  const pzA = new THREE.Vector3(), pzB = new THREE.Vector3(), pzC = new THREE.Vector3(), pzD = new THREE.Vector3();
  const pzFw = new THREE.Vector3(), pzLat = new THREE.Vector3(), pzP = new THREE.Vector3();
  const pzSt = new WeakMap();     // avatar  -> smoothed pose weights
  const pzAimOf = new WeakMap();  // fighter -> the aim direction the pose used this frame ([x, y], y up)

  // ---- undo log ----
  // A clip only writes the bones it has tracks for, so anything this file rotates that the clip leaves
  // alone would pile up frame after frame (the fighter slowly folds in half). Every change is logged with
  // the value it started from and the value it left; next frame, any bone still holding exactly what we
  // wrote (so the mixer did not refresh it) is put back before the new pose goes on.
  const pzLog = new WeakMap();   // avatar -> { rec: [...], n }
  let pzRec = null;
  // -1 while posing a mirrored (left-facing) avatar. A mirror image negates rotations about the forward and
  // up axes and keeps pitches (about the lateral axis), so pzOut / pzYaw multiply by it and pzSpin does not.
  let pzMir = 1;
  function pzBegin(av) {
    let M = pzLog.get(av); if (!M) { M = { rec: [], n: 0 }; pzLog.set(av, M); }
    for (let i = M.n - 1; i >= 0; i--) {     // reverse: undo the last change first
      const r = M.rec[i];
      if (r.pos) { if (r.b.position.equals(r.wp)) r.b.position.copy(r.bp); }
      else if (r.b.quaternion.equals(r.wq)) r.b.quaternion.copy(r.bq);
    }
    M.n = 0; pzRec = M;
  }
  function pzMark(bone) {
    const M = pzRec; if (!M) return null;
    let r = M.rec[M.n];
    if (!r) r = M.rec[M.n] = { b: null, pos: false, bq: new THREE.Quaternion(), wq: new THREE.Quaternion(), bp: new THREE.Vector3(), wp: new THREE.Vector3() };
    M.n++; r.b = bone; return r;
  }

  // ---- bone maths: apply a WORLD-space rotation to a bone, written into its parent's space ----
  // newLocal = (qParent^-1 * R * qParent) * oldLocal, so the bone's whole chain swings rigidly with it.
  function pzApply(bone, qWorld) {
    if (!bone) return;
    const p = bone.parent;
    // getWorldQuaternion already does updateWorldMatrix(true, false) itself; calling it first walked the
    // whole parent chain twice per bone, and this now runs on every bone of every fighter every frame
    if (p) p.getWorldQuaternion(pzQP); else pzQP.identity();
    pzQI.copy(pzQP).invert();
    pzQD.copy(pzQI).multiply(qWorld).multiply(pzQP);
    // mirrored fighter (91_v3_render Avatar.mirror): the parent's world matrix is R * diag(-1,1,1) * s, and
    // decompose() only returns R, so conjugate by the reflection too: (x, y, z, w) -> (x, -y, -z, w)
    if (pzMir < 0 && p && p.matrixWorld.determinant() < 0) { pzQD.y = -pzQD.y; pzQD.z = -pzQD.z; }
    pzRecord(bone, pzQD);
    const r = pzMark(bone); if (r) { r.pos = false; r.bq.copy(bone.quaternion); }
    bone.quaternion.premultiply(pzQD);
    if (r) r.wq.copy(bone.quaternion);
  }
  // HITLAG FREEZE (audit #21): the gait layer (stance, lean, the strike commitment) used to switch off for the
  // hit freeze, so at the exact frame of contact attacker and victim snapped back to the raw clip and snapped
  // again when the freeze ended. Its local rotations are recorded every frame and replayed during hitlag instead.
  let pzGRec = null;
  function pzRecord(bone, q) {
    const G = pzGRec; if (!G) return;
    if (!G.q[G.n]) G.q[G.n] = new THREE.Quaternion();
    G.b[G.n] = bone; G.q[G.n].copy(q); G.n++;
  }
  function pzReplay(G) {
    for (let i = 0; i < G.n; i++) {
      const bone = G.b[i]; if (!bone) continue;
      const r = pzMark(bone); if (r) { r.pos = false; r.bq.copy(bone.quaternion); }
      bone.quaternion.premultiply(G.q[i]);
      if (r) r.wq.copy(bone.quaternion);
    }
  }
  const pzGLog = new WeakMap();
  const pzSpin = (bone, axis, ang) => { if (bone && Math.abs(ang) > 1e-4) pzApply(bone, pzQR.setFromAxisAngle(axis, ang)); };
  // the direction this fighter faces in the world (the models face their own +Z; the root only ever yaws)
  function pzForward(av) {
    av.root.getWorldQuaternion(pzQA);
    return pzFw.set(0, 0, 1).applyQuaternion(pzQA).setY(0).normalize();
  }
  // sideways axis: rotating a bone by +angle about it pitches that bone FORWARD (toward the opponent)
  const pzLateral = av => pzLat.crossVectors(PZ_UP, pzForward(av)).normalize();
  function pzWorldY(bone) { if (!bone) return null; bone.getWorldPosition(pzP); return pzP.y; }
  // lowest point of the feet, so a bent leg can be paid for by dropping the hips
  const pzLow = (a, b) => (a == null ? b : b == null ? a : Math.min(a, b));
  function pzFeetY(B) {
    const toes = pzLow(pzWorldY(B.LeftToeBase), pzWorldY(B.RightToeBase));   // the contact point
    return toes != null ? toes : pzLow(pzWorldY(B.LeftFoot), pzWorldY(B.RightFoot));
  }
  // move the hips `dy` world units down, whatever the rig's local axes are
  function pzDropHips(B, dy) {
    const h = B.Hips, p = h && h.parent; if (!h || !p || !(Math.abs(dy) > 1e-6)) return;
    p.updateWorldMatrix(true, false);
    pzP.copy(h.position); p.localToWorld(pzP); pzP.y -= dy; p.worldToLocal(pzP);
    const r = pzMark(h); if (r) { r.pos = true; r.bp.copy(h.position); }
    h.position.copy(pzP);
    if (r) r.wp.copy(h.position);
  }

  // ---- 1. crouch: bend the knees, drop the hips, fold the torso, keep the head up ----
  const PZ_CR = { hip: 1.38, knee: 2.2, ankle: 0.85, spine: 0.2, head: 0.42, arm: 0.34 };
  function pzCrouch(av, k) {
    const B = av.bones; if (!B.RightUpLeg || !B.RightLeg) return;
    const lat = pzLateral(av);
    const y0 = pzFeetY(B);
    const a = PZ_CR.hip * k;
    pzSpin(B.LeftUpLeg, lat, -a); pzSpin(B.RightUpLeg, lat, -a);                       // thighs up and forward
    pzSpin(B.LeftLeg, lat, a * PZ_CR.knee); pzSpin(B.RightLeg, lat, a * PZ_CR.knee);   // knees fold
    pzSpin(B.LeftFoot, lat, -a * PZ_CR.ankle); pzSpin(B.RightFoot, lat, -a * PZ_CR.ankle);   // soles stay on the deck
    pzSpin(B.Spine, lat, PZ_CR.spine * k); pzSpin(B.Spine01, lat, PZ_CR.spine * k); pzSpin(B.Spine02, lat, PZ_CR.spine * 0.7 * k);
    pzSpin(B.neck, lat, -PZ_CR.head * k); pzSpin(B.Head, lat, -PZ_CR.head * k);        // still looking at the opponent
    pzSpin(B.LeftArm, lat, -PZ_CR.arm * k); pzSpin(B.RightArm, lat, -PZ_CR.arm * k);   // guard tucks in
    const y1 = pzFeetY(B);
    if (y0 != null && y1 != null) pzDropHips(B, y1 - y0);
  }

  // ---- 2. two-handed swings: the arms follow the weapon round its arc ----
  // `ang` is measured from straight up, positive = swung forward, so the weapon direction is
  // (face*sin, cos): the same convention the mallet fx in 94_v3_moves.mjs uses.
  function pzSwingArms(av, ang, offHand) {
    const f = av.f, B = av.bones;
    if (!B.RightArm || !B.RightForeArm || !B.RightHand) return;
    B.RightHand.getWorldPosition(pzA); B.RightForeArm.getWorldPosition(pzB);
    pzC.subVectors(pzA, pzB); if (pzC.lengthSq() < 1e-8) return;
    pzD.set(f.face * Math.sin(ang), Math.cos(ang), 0).normalize();
    pzQA.setFromUnitVectors(pzC.normalize(), pzD);
    pzApply(B.RightArm, pzQA);
    if (offHand && B.LeftArm && B.LeftForeArm && B.LeftHand) {   // the off hand comes along for a two-handed grip
      B.LeftHand.getWorldPosition(pzA); B.LeftForeArm.getWorldPosition(pzB);
      pzC.subVectors(pzA, pzB);
      if (pzC.lengthSq() > 1e-8) {
        pzQA.setFromUnitVectors(pzC.normalize(), pzD);
        pzQ1.identity(); pzQA.slerp(pzQ1, 1 - offHand);
        pzApply(B.LeftArm, pzQA);
      }
    }
  }
  // The item hammer's cycle is 18 frames (HAMMER_DEF): the up hit lands around frame 5 and the forward
  // hit around frame 12, so one constant revolution per cycle puts the head where each hit is, with no
  // snap at the loop - instead of the clip's vertical chop three times a second.
  function pzHammer(av) {
    const f = av.f, B = av.bones, mv = f.move;
    const T = Math.max(6, (mv && mv.def && mv.def.total) || 18), t = mv ? mv.t : 0;
    const ph = (t / T) * Math.PI * 2 - 2.1;   // 0 = overhead
    const s = Math.sin(ph), c = Math.cos(ph), under = Math.max(0, -c);
    const lat = pzLateral(av);
    // body rides the swing: into it as the head comes round the front, back out of the way as it passes underneath
    pzSpin(B.Spine01, lat, 0.18 * s - 0.26 * under); pzSpin(B.Spine02, lat, 0.1 * s - 0.1 * under);
    pzSpin(B.LeftUpLeg, lat, -0.1 * (1 - c)); pzSpin(B.RightUpLeg, lat, -0.1 * (1 - c));
    pzSpin(B.LeftLeg, lat, 0.16 * (1 - c)); pzSpin(B.RightLeg, lat, 0.16 * (1 - c));
    pzSwingArms(av, ph, 0.65);
  }
  // MOCHI's mallet (and anyone else's `fx: 'mallet'` move): rear up over the head, heave it through,
  // let the weight drag. 94_v3_moves.mjs owns the arc so the hands and the hammer agree exactly.
  function pzMallet(av) {
    const f = av.f, B = av.bones, mv = f.move, d = mv && mv.def;
    if (!d || !V3.malletAng) return;
    const ang = V3.malletAng(f, d, mv.t), lat = pzLateral(av);
    const s = Math.sin(ang), c = Math.cos(ang);
    if (d.charge) {
      const w = (d.hits && d.hits[0] && d.hits[0].f) || [16, 20];
      // lean back under the weight on the wind-up, drive through it on the way down, then get hauled forward
      const lean = mv.t <= d.charge.at ? -0.3 * (mv.t / Math.max(1, d.charge.at)) : mv.t < w[0] ? -0.3 + 0.75 * ((mv.t - d.charge.at) / Math.max(1, w[0] - d.charge.at)) : 0.45 - 0.2 * Math.min(1, (mv.t - w[1]) / 12);
      pzSpin(B.Spine01, lat, lean * 0.55); pzSpin(B.Spine02, lat, lean * 0.35);
      pzSpin(B.LeftUpLeg, lat, -Math.max(0, lean) * 0.3); pzSpin(B.RightUpLeg, lat, -Math.max(0, lean) * 0.3);
      pzSpin(B.LeftLeg, lat, Math.max(0, lean) * 0.5); pzSpin(B.RightLeg, lat, Math.max(0, lean) * 0.5);
    } else {
      pzSpin(B.Spine01, lat, 0.12 * s); pzSpin(B.Spine02, lat, 0.08 * s);
    }
    pzSwingArms(av, ang, 0.7);
  }

  // ---- 3. swallowed: the holder puffs up around whoever is inside, and the victim shrinks into the mouth ----
  const pzCol = new THREE.Color();
  function pzSwell(av, k, mv) {
    const f = av.f, B = av.bones, t = mv ? mv.t : 0;
    const mash = mv ? Math.min(1, (mv.mash || 0) / 14) : 0;
    const wob = Math.sin(t * 0.36) * 0.05 * k + (mash ? (Math.random() - 0.5) * 0.1 * mash : 0);   // belly jiggle + the struggle
    const R = av.root.scale;
    R.set(R.x * (1 + 0.36 * k + wob), R.y * (1 + 0.15 * k - wob * 0.5), R.z * (1 + 0.36 * k + wob));
    if (B.Head) B.Head.scale.setScalar(1 + 0.24 * k);                          // cheeks bulge
    if (B.Spine02) pzSpin(B.Spine02, pzLateral(av), -0.14 * k);                // leans back around the belly
    const v = f.grabbed;                                                       // and wears their colour
    if (v && av.mats) { pzCol.set(v.color); for (const m of av.mats) m.emissive.setRGB(pzCol.r * 0.2 * k, pzCol.g * 0.2 * k, pzCol.b * 0.2 * k); }
  }
  function pzSwallowed(av) {
    const f = av.f, g = f.grabber;
    if (!(f.state === 'grabbed' && g && g.move && g.move.def.swallow)) return;
    const t = g.move.t; if (t >= 14) return;
    const k = 1 - t / 14, s = Math.max(0.07, k * k);
    av.root.visible = true;                                                    // shrink in instead of vanishing
    av.root.scale.multiplyScalar(s);
    av.root.position.y += g.h * SC * 0.5 * (1 - s);
    av.root.rotation.z = (1 - k) * 1.1 * f.face;
  }

  // ---- 4. guns: plant and aim along the shot ----
  // Launch velocities per weapon, so the wind-up already points where the shot will go. The live shot
  // overrides this the moment it exists, so a change to the fight code's aim carries into the pose by
  // itself; [forward, up-per-aim-step] mirrors 55_items.js / 56_items2.js.
  const PZ_GUN = { bazooka: [12.5, 5], shotgun: [19, 4], mgun: [22, 3], sniper: [58, 9], raygun: [26, 0], pistol: [26, 0], revolver: [26, 0], smg: [26, 0] };
  const pzIsGun = f => !!(f.item && PZ_GUN[f.item.kind]);
  // the direction the shot goes, in world terms ([x, y], y up, facing already in it)
  function pzAimDir(f) {
    // gunplay (6e_guns.js): a gun move carries the fight's own 8-way aim; holding a gun with Up (or Down
    // in the air, or the local mouse aim) raises it before the shot. Exact, not inferred.
    const gm = f.move;
    if (f.state === 'move' && gm && gm.def && gm.def.gun && gm.gnAx != null) return [gm.gnAx, -gm.gnAy];
    if (typeof GUNS !== 'undefined' && GUNS.on() && f.item && GUNS.isGun(f.item.kind) && (f.state === 'ground' || f.state === 'air' || f.state === 'land' || f.state === 'jumpsquat')) {
      if (GUNS.mouseOk(f) || f.in.up || (f.in.down && f.air)) { const A = GUNS.aimVec(f); return [A[0], -A[1]]; }
      return null;
    }
    const firing = f.state === 'move' && f.move && f.move.def.gunAnim;
    if (!firing && !(pzIsGun(f) && (f.in.up || f.in.down) && (f.state === 'ground' || f.state === 'air' || f.state === 'land'))) return null;
    // what actually came out of the barrel wins
    let sx = 0, sy = 0, n = 0;
    for (const p of Game.projs) { if (p.owner === f && p.age <= 3 && !p.anchor && !p.len) { sx += p.vx; sy += p.vy; n++; } }
    if (n) { const L = Math.hypot(sx, sy); if (L > 0.001) return [sx / L, -sy / L]; }
    const mv = f.move, kind = f.item ? f.item.kind : 'raygun', g = PZ_GUN[kind] || PZ_GUN.raygun;
    // `move.aim` (radians, + = up) is the hook for the fight code once guns aim on a full stick
    const aim = mv && mv.aim;
    const u = mv && typeof mv.up === 'number' ? mv.up : (f.in.up ? 1 : f.in.down ? -1 : 0);
    const el = typeof aim === 'number' ? aim : Math.atan2(u * g[1], g[0]);
    return [f.face * Math.cos(el), Math.sin(el)];
  }
  // ---- 4b. CARRYING a shop weapon ----------------------------------------------------------
  // 15 Oct, Duane: *"some of the weapons are off and he's not gripping them right"*. He was looking
  // at the right thing. The prop sits on the hand BONE, and in the idle guard that bone is up at the
  // chin, so a shotgun lay across the fighter's muzzle, the fire axe ran down through his forearm
  // and the manhole cover sat on his face. Moving the prop off the hand would only break the grip;
  // what was missing is the ARM. A carried weapon now aims the arm the way the weapon points, and
  // `pzAimPose` braces the off hand onto it, which is the two-handed grip the guns already had.
  // `armK` per weapon decides how far: a rifle goes right out, a bat only lifts to the shoulder.
  // WHICH HAND. The props rode the right hand, which in this side-on view is usually the FAR hand:
  // the torso drew over the top of the weapon and the near fist stayed up in its guard in front of
  // it, so the axe looked like it was floating past the chest with nobody holding it. The weapon
  // goes in whichever hand is nearest the camera, and that arm is the one that gets posed.
  const pzCarryHand = new WeakMap();
  V3.carryHand = f => pzCarryHand.get(f) || 'R';
  function pzCarryDir(av) {
    const f = av.f, B = av.bones;
    if (typeof FORGE_HOLD === 'undefined' || !f.item) { pzCarryHand.delete(f); return null; }
    const sp = FORGE_HOLD[f.item.kind];
    if (!sp || sp.limb || !sp.armK) { pzCarryHand.delete(f); return null; }   // worn, not carried
    if (f.state === 'move' || f.state === 'hammer' || f.state === 'final' || f.hitstun > 0) return null;
    let near = 'R';
    if (B.RightHand && B.LeftHand) {
      B.RightHand.getWorldPosition(pzA); B.LeftHand.getWorldPosition(pzB);
      near = pzA.z >= pzB.z ? 'R' : 'L';
    }
    pzCarryHand.set(f, near);
    return [f.face * Math.cos(sp.c), Math.sin(sp.c), sp.armK, near];
  }
  function pzAimPose(av, aim, k) {
    const f = av.f, B = av.bones;
    // `aim[3]` picks the holding side (the carry pose above). A gun aim never sets it and keeps the
    // right hand, which is what every gun pose in the game was built against.
    const H = aim[3] === 'L' ? 'Left' : 'Right', O = aim[3] === 'L' ? 'Right' : 'Left';
    const mainArm = B[H + 'Arm'], mainFore = B[H + 'ForeArm'], mainHand = B[H + 'Hand'];
    const offArm = B[O + 'Arm'], offFore = B[O + 'ForeArm'], offHand = B[O + 'Hand'];
    if (!mainArm || !mainFore || !mainHand) return;
    const lat = pzLateral(av);
    const el = Math.atan2(aim[1], Math.abs(aim[0]) || 1e-6);
    // recoil: the muzzle climbs for a couple of frames after anything leaves the barrel
    let rec = 0;
    for (const p of Game.projs) if (p.owner === f && p.age <= 3) rec = Math.max(rec, 1 - p.age / 3.5);
    if (V3.gnRecoil) rec = Math.max(rec, V3.gnRecoil(f));
    // torso and head line up behind the shot, feet stay planted (the clip is `guard`, not `punch`)
    pzSpin(B.Spine01, lat, (-el * 0.2 - rec * 0.1) * k); pzSpin(B.Spine02, lat, -el * 0.16 * k);
    pzSpin(B.neck, lat, -el * 0.32 * k); pzSpin(B.Head, lat, -el * 0.3 * k);
    pzD.set(aim[0], aim[1], 0).normalize();
    if (rec > 0) { pzQR.setFromAxisAngle(lat, -rec * 0.34 * k); pzD.applyQuaternion(pzQR); }
    // a gun is aimed with the arm OUT: straighten the elbow toward the upper arm's line first, so the
    // alignment below points the whole arm down the barrel instead of a forearm tucked at the chest
    // straightening the elbow is for a GUN being aimed; a carried weapon keeps its natural bend
    if ((pzIsGun(f) || aim[3]) && mainArm) {
      mainFore.getWorldPosition(pzB); mainArm.getWorldPosition(pzP); pzA.subVectors(pzB, pzP);
      mainHand.getWorldPosition(pzC); pzC.sub(pzB);
      if (pzA.lengthSq() > 1e-8 && pzC.lengthSq() > 1e-8) {
        pzQA.setFromUnitVectors(pzC.normalize(), pzA.normalize()); pzQ1.identity();
        pzQA.slerp(pzQ1, 1 - (aim[3] ? 0.5 : 0.8) * k);
        pzApply(mainFore, pzQA);
      }
    }
    mainHand.getWorldPosition(pzA); mainFore.getWorldPosition(pzB);
    pzC.subVectors(pzA, pzB); if (pzC.lengthSq() < 1e-8) return;
    pzQA.setFromUnitVectors(pzC.normalize(), pzD);
    if (k < 0.999) { pzQ1.identity(); pzQA.slerp(pzQ1, 1 - k); }
    pzApply(mainArm, pzQA);
    // the off hand braces the weapon
    if (offArm && offFore && offHand) {
      offHand.getWorldPosition(pzA); offFore.getWorldPosition(pzB);
      pzC.subVectors(pzA, pzB);
      if (pzC.lengthSq() > 1e-8) {
        pzQA.setFromUnitVectors(pzC.normalize(), pzD);
        pzQ1.identity(); pzQA.slerp(pzQ1, 1 - 0.55 * k);
        pzApply(offArm, pzQA);
      }
    }
    pzAimOf.set(f, [pzD.x, pzD.y]);
  }

  // ---- 4b. STRIKE REACH: the limb that swings goes where the hitbox is ----
  //
  // Audit A4/A5 (dev/aaa/reach3d.mjs): hits connected 2.4-3x further out than any fist or foot, and at a
  // different height (the jab's hitbox sits at the waist while the clip's fist is at head height), so a
  // hit read as a phantom: the other fighter flew away from a punch that visibly stopped short. Duane has
  // always wanted MORE reach, so the hitboxes stay exactly where they are and the body goes out to them:
  //
  //   * the limb is picked once per move (whichever hand or foot the clip already brings closest to the
  //     hitbox, so a jab punches with the jabbing hand and a sweep with the sweeping foot)
  //   * over the hit window the body leans into the strike, the elbow / knee straightens and the whole
  //     chain is aimed from the shoulder / hip at the hitbox that reaches furthest
  //   * wind-in over 4 frames before the window, recover over 6 after, held through hitlag (move.t stops)
  //   * V3.strikeTip(f) gives 92_v3_items the striking limb and a point out toward the hitbox, so the
  //     swoosh trail comes off the right limb and sweeps the area the hit actually covers (Smash's smears)
  //
  // Visual only: activeHits() is read (pure: move.t is set and restored inside one synchronous call for
  // the wind-in frames), nothing in the fight is written.
  const PZ_CHAINS = [['RightArm', 'RightForeArm', 'RightHand'], ['LeftArm', 'LeftForeArm', 'LeftHand'],
    ['RightUpLeg', 'RightLeg', 'RightFoot'], ['LeftUpLeg', 'LeftLeg', 'LeftFoot']];
  const pzStk = new WeakMap();   // fighter -> { mv, chain, w, tx, ty, tip: Vector3 }
  const pzWin = new WeakMap();   // move def -> [first active frame, last active frame] | null
  const pzT = new THREE.Vector3(), pzE = new THREE.Vector3(), pzU = new THREE.Vector3(), pzM = new THREE.Vector3();
  const pzV1 = new THREE.Vector3(), pzV2 = new THREE.Vector3();
  function pzHitWin(d) {
    if (pzWin.has(d)) return pzWin.get(d);
    let lo = 1e9, hi = -1e9;
    if (d.hits) for (const h of d.hits) if (h.f) { lo = Math.min(lo, h.f[0]); hi = Math.max(hi, h.f[1]); }
    const v = hi >= lo ? [lo, hi] : null;
    pzWin.set(d, v); return v;
  }
  // skip what already has its own posing or owns its own motion
  function pzStrikeable(f) {
    if (f.state !== 'move' || !f.move) return false;
    const d = f.move.def;
    return !!(d.hits && d.hits.length) && !d.gunAnim && !d.throwAnim && !d.swallow && d.fx !== 'mallet' && !d.counter && !pzIsGun(f);
  }
  // the live hitbox that reaches furthest from the body; during the wind-in, the one the move is about to put out
  function pzTarget(f, lo) {
    let out = f.activeHits();
    const mv = f.move;
    if (!out.length && mv) { const t0 = mv.t; mv.t = lo; try { out = f.activeHits(); } finally { mv.t = t0; } }
    let best = null, far = -1;
    const cy = f.y - f.h * 0.5;
    for (const h of out) {
      if (h.hb && h.hb.grab && out.length > 1) continue;
      const e = Math.hypot(h.x - f.x, h.y - cy) + h.r * 0.5;
      if (e > far) { far = e; best = h; }
    }
    return best;
  }
  function pzRise(f, hb) {
    const d = f.move && f.move.def, b = d && (d.base || d);
    return !!b && !V3.noRise && b === f.m.ub && !b.clip && !b.fx && hb.y < f.y - f.h * 0.3 && Math.abs(hb.x - f.x) < f.w * 0.5;
  }
  function pzStrike(av) {
    const f = av.f, B = av.bones;
    let S = pzStk.get(f);
    if (!pzStrikeable(f)) { if (S) S.w = 0; return; }
    const mv = f.move, win = pzHitWin(mv.def);
    if (!win) { if (S) S.w = 0; return; }
    const t = mv.t, lo = win[0], hi = win[1];
    const w = t < lo - 4 || t > hi + 6 ? 0 : t < lo ? (t - (lo - 4)) / 4 : t <= hi ? 1 : 1 - (t - hi) / 6;
    if (!S) { S = { mv: null, chain: null, w: 0, tip: new THREE.Vector3(), tgt: new THREE.Vector3() }; pzStk.set(f, S); }
    if (w <= 0.001) { S.w = 0; return; }
    const hb = pzTarget(f, lo);
    if (!hb) { S.w = 0; return; }
    const z = av.root.position.z;
    pzT.set(hb.x * SC, -hb.y * SC, z);
    // the stock up special: its hitbox is a ball round the body, which gave the arm nowhere to go (the fighter rose
    // in guard). The fist goes up over the head instead, a little forward, the way a rising uppercut reads.
    const rise = pzRise(f, hb);
    if (rise) pzT.set((f.x + f.face * f.w * 0.3) * SC, -(f.y - f.h * 1.62) * SC, z);
    // pick the limb once per move: the one the clip already carries closest to the hitbox
    if (S.mv !== mv) {
      S.mv = mv; S.chain = null;
      // a held sword / beam / hammer is in the right hand (92_v3_items): that arm swings it, whatever the clip does
      if (f.item && (f.item.kind === 'blade' || f.item.kind === 'beam' || f.item.kind === 'hammer') && B.RightArm && B.RightForeArm && B.RightHand) S.chain = PZ_CHAINS[0];
      let bd = S.chain ? -1 : 1e9;
      // the rising fist: the arm nearer the camera, so a big head never hides it
      if (!S.chain && pzRise(f, hb) && B.RightArm && B.LeftArm && B.RightForeArm && B.LeftForeArm && B.RightHand && B.LeftHand) {
        B.RightArm.getWorldPosition(pzE); const zr = pzE.z; B.LeftArm.getWorldPosition(pzE);
        S.chain = zr >= pzE.z ? PZ_CHAINS[0] : PZ_CHAINS[1]; bd = -1;
      }
      for (const ch of PZ_CHAINS) {
        const e = B[ch[2]]; if (!B[ch[0]] || !B[ch[1]] || !e) continue;
        e.getWorldPosition(pzE); pzE.z = z;
        const dd = pzE.distanceToSquared(pzT);
        if (dd < bd) { bd = dd; S.chain = ch; }
      }
    }
    // ...and it stays the near arm: the body turns when the clip changes at lift-off (ground uppercut -> jump)
    if ((S.chain === PZ_CHAINS[0] || S.chain === PZ_CHAINS[1]) && pzRise(f, hb) && B.RightArm && B.LeftArm) {
      B.RightArm.getWorldPosition(pzE); const zr = pzE.z; B.LeftArm.getWorldPosition(pzE);
      if (Math.abs(zr - pzE.z) > 0.05) S.chain = zr > pzE.z ? PZ_CHAINS[0] : PZ_CHAINS[1];
    }
    const ch = S.chain; if (!ch) { S.w = 0; return; }
    const U = B[ch[0]], L = B[ch[1]], E = B[ch[2]];
    const k = w * w * (3 - 2 * w);   // smoothstep: no pop at either end of the window
    // aim in the limb's own depth plane so the arm never swings through the torso
    E.getWorldPosition(pzE); pzT.z = pzE.z;
    // the rising fist: straight up from the shoulder, ~18 degrees forward, a little toward the camera (clear of a big head)
    if (rise) {
      U.getWorldPosition(pzU); L.getWorldPosition(pzM);
      const al = pzU.distanceTo(pzM) + pzM.distanceTo(pzE);
      pzT.set(pzU.x + f.face * al * 0.4, pzU.y + al * 1.2, pzU.z + 0.1);
    }
    // 1. lean into it: pitch the spine toward a target in front that the straight limb cannot reach
    U.getWorldPosition(pzU); L.getWorldPosition(pzM);
    const len = pzU.distanceTo(pzM) + pzM.distanceTo(pzE);
    const toT = pzV1.subVectors(pzT, pzU);
    const ahead = toT.x * f.face > 0 && Math.abs(toT.y) < Math.abs(toT.x) * 1.2;
    const short = toT.length() - len;
    if (ahead && short > 0 && ch[0].includes('Arm') && B.Spine01) {
      const lat = pzLateral(av), lean = Math.min(0.42, short / Math.max(0.05, len)) * k;
      pzSpin(B.Spine01, lat, lean * 0.55); if (B.Spine02) pzSpin(B.Spine02, lat, lean * 0.45);
    }
    // 2. straighten the elbow / knee (not quite locked: a dead-straight limb reads as a stick)
    U.getWorldPosition(pzU); L.getWorldPosition(pzM); E.getWorldPosition(pzE);
    pzV1.subVectors(pzM, pzU); pzV2.subVectors(pzE, pzM);
    if (pzV1.lengthSq() > 1e-8 && pzV2.lengthSq() > 1e-8) {
      pzQA.setFromUnitVectors(pzV2.normalize(), pzV1.normalize());
      pzQ1.identity(); pzQA.slerp(pzQ1, 1 - 0.88 * k);
      pzApply(L, pzQA);
    }
    // 3. aim the whole chain from the shoulder / hip at the hitbox
    U.getWorldPosition(pzU); E.getWorldPosition(pzE);
    pzV1.subVectors(pzE, pzU); pzV2.subVectors(pzT, pzU);
    if (pzV1.lengthSq() > 1e-8 && pzV2.lengthSq() > 1e-8) {
      pzQA.setFromUnitVectors(pzV1.normalize(), pzV2.normalize());
      pzQ1.identity(); pzQA.slerp(pzQ1, 1 - k);
      pzApply(U, pzQA);
    }
    // the smear point: out from the limb toward the far side of the hitbox, what the swoosh draws
    E.getWorldPosition(pzE);
    pzV2.subVectors(pzT, pzE); const gap = pzV2.length();
    S.tip.copy(pzE); if (gap > 1e-4) S.tip.addScaledVector(pzV2, Math.min(1, (gap + hb.r * SC * 0.6) / gap) * 0.85);
    S.tgt.copy(pzT); S.w = k;
    if (V3._strikeDbgOn) { U.getWorldPosition(pzU); S.dbg = 'sh' + [pzU.x, pzU.y, pzU.z].map(v => v.toFixed(2)) + ' hand' + [pzE.x, pzE.y, pzE.z].map(v => v.toFixed(2)) + ' tgt' + [pzT.x, pzT.y].map(v => v.toFixed(2)); }
  }
  // 92_v3_items: which bone swings (for the trail) and where the swoosh reaches. null = not striking.
  V3.strikeTip = function (f) {
    const S = pzStk.get(f);
    return S && S.w > 0.05 ? S.tip : null;
  };
  V3._strikeDbg = f => { const S = pzStk.get(f); return S ? (S.chain ? S.chain[0] : 'none') + ' w' + (S.w || 0).toFixed(2) + ' ' + (S.dbg || '') : '-'; };   // dev inspection
  V3.strikeTarget = function (f) {
    const S = pzStk.get(f);
    return S && S.w > 0.05 ? S.tgt : null;
  };

  // ---- 5. MOTION IDENTITY: every fighter moves like itself ----
  //
  // 46 fighters share 18 clips on one 24-bone rig, so out of the box they all move identically and the
  // only thing telling them apart is colour. This layer gives each one a body language that is DERIVED
  // FROM ITS OWN STAT LINE rather than hand-authored 46 times: `66_traits.js` already says how heavy,
  // how fast, how strong and how floaty each fighter is, and which single passive it owns, and that is
  // exactly the information a animator would use. A 134 kg shell-plated kaiju stands wide and settles
  // its weight; a 74 kg Pop Off popcat is never quite still; a Drifter wisp sways like it is underwater.
  //
  // Everything is a small offset laid over the shared clip through the same undo log as the rest of this
  // file, so it costs a dozen quaternions per fighter per frame and no new animation data.
  // PURELY VISUAL: src/*.mjs is page-only, it never enters SIM_FILES, nothing here writes fight state,
  // and the only randomness is a stable hash of the fighter's id (never Rng, never Math.random in a way
  // that could differ between two frames of the same pose).
  const pzGz = new Map();
  const pz01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
  function pzIdentity(c) {
    const id = (c.baseOf ? c.baseOf.id : c.id) || 'x';
    let G = pzGz.get(id); if (G) return G;
    const P = (typeof PROFILE !== 'undefined' && PROFILE[id]) || {};
    const T = (typeof TRAIT !== 'undefined' && TRAIT[id]) || {};
    const W = P.weight || c.weight || 100, walk = P.walk || c.walk || 6;
    const pw = P.power || c.power || 1, grav = P.grav || c.grav || 0.62, jumps = c.jumps || 1;
    // six independent, stable draws off the id, so two fighters with the same stat line still differ
    let h = 2166136261;
    for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    const r = n => (((h >>> (n * 5)) & 31) / 31);
    const heavy = pz01((W - 74) / 62), quick = pz01((walk - 4.6) / 3), brawn = pz01((pw - 0.9) / 0.3);
    const floaty = pz01(pz01((0.66 - grav) / 0.24) * 0.55 + pz01((jumps - 1) / 4) * 0.3 + (T.airc ? 0.35 : 0));
    // the one passive each fighter owns is the clearest personality signal on the roster
    const A = T.kb ? 'tank' : T.dmg ? 'bruiser' : T.rage ? 'rager' : T.run ? 'runner'
      : T.airc ? 'drifter' : T.shield ? 'guard' : T.burn ? 'stoic' : T.land ? 'springy' : T.fall ? 'plummet' : 'plain';
    G = {
      id, arch: A, heavy, quick, brawn, floaty,
      // --- standing silhouette: the part you read with the colours turned off ---
      stance: 0.04 + heavy * 0.30 + (A === 'tank' ? 0.10 : 0) + (A === 'runner' ? -0.03 : 0) + r(0) * 0.05,
      armGap: 0.05 + brawn * 0.32 + heavy * 0.14 + (A === 'bruiser' ? 0.12 : 0) + r(1) * 0.05,
      hunch: -0.08 + heavy * 0.20 + (A === 'rager' ? 0.14 : A === 'guard' ? 0.08 : A === 'drifter' ? -0.12 : 0) - brawn * 0.06 + (r(2) - 0.5) * 0.10,
      chest: brawn * 0.15 + (A === 'bruiser' ? 0.07 : 0) + (A === 'rager' ? 0.05 : 0),
      cant: (r(3) - 0.5) * 0.30 + (A === 'drifter' ? 0.10 : 0),
      guard: A === 'guard' ? 0.5 : A === 'rager' ? 0.3 : A === 'tank' ? 0.2 : 0,
      // --- tempo: how often it moves, and how far ---
      rate: 0.052 + quick * 0.055 + floaty * 0.012 + (A === 'runner' ? 0.014 : 0) - heavy * 0.016,
      bob: 0.010 + quick * 0.016 + (A === 'springy' ? 0.012 : 0) + (A === 'runner' ? 0.008 : 0) - heavy * 0.004,
      settle: heavy * 0.016 + (A === 'tank' ? 0.008 : 0),           // weight dropping onto the hips
      sway: 0.03 + floaty * 0.20 + quick * 0.05 + (A === 'drifter' ? 0.12 : 0),
      breathe: 0.03 + heavy * 0.06 + brawn * 0.04,
      phase: r(4) * Math.PI * 2,
      // --- locomotion ---
      stepRate: 0.30 + quick * 0.16 - heavy * 0.05,
      stomp: 0.010 + heavy * 0.026 + (A === 'plummet' ? 0.008 : 0),
      // the run clip already pitches the body; this is only the DIFFERENCE between fighters, so it stays
      // small - the first pass at 0.06 + quick*0.24 put everyone face-down (dev/anim2/H_gaitrun.png)
      lean: 0.02 + quick * 0.11 + (A === 'runner' ? 0.05 : 0) - heavy * 0.03 - floaty * 0.03,
      roll: 0.06 + heavy * 0.22 + brawn * 0.10,                      // shoulder counter-rotation
      armSwing: 0.10 + quick * 0.26 - heavy * 0.05 + (A === 'runner' ? 0.08 : 0),
      // --- air ---
      spread: floaty * 0.5 + (A === 'drifter' ? 0.18 : 0) - heavy * 0.16,
      tuck: heavy * 0.3 + brawn * 0.1,
      // --- how hard it commits to a swing ---
      commit: 0.08 + heavy * 0.20 + brawn * 0.16 - quick * 0.06,
      snap: 0.05 + quick * 0.22 + (A === 'runner' ? 0.06 : 0),
    };
    pzGz.set(id, G);
    return G;
  }
  // rotating a bone about the FORWARD axis swings it sideways (abduction), which is what opens a stance
  // and lifts the arms away from the body: the two biggest silhouette levers on this rig
  const pzOut = (bone, fwd, ang) => { if (bone && Math.abs(ang) > 1e-4) pzApply(bone, pzQR.setFromAxisAngle(fwd, ang * pzMir)); };
  const pzYaw = (bone, ang) => { if (bone && Math.abs(ang) > 1e-4) pzApply(bone, pzQR.setFromAxisAngle(PZ_UP, ang * pzMir)); };

  const pzFwd = new THREE.Vector3();
  function pzGait(av) {
    const f = av.f, B = av.bones, G = pzIdentity(f.c);
    const st = f.state;
    if (st === 'dead' || st === 'respawn' || st === 'hammer' || st === 'grabbed' || st === 'dizzy' || f.hitlag > 0) return;
    let S = pzSt.get(av); if (!S) { S = { crouch: 0, aim: 0, swell: 0, swellOn: false }; pzSt.set(av, S); }
    if (S.step == null) { S.step = G.phase; S.spd = 0; S.airT = 0; }
    const lat = pzLateral(av); pzFwd.copy(pzFw);        // pzLateral fills pzFw with the facing direction
    const fwd = pzFwd;
    const t = f.t + G.phase * 9;
    const spd = Math.abs(f.vx), fast = pz01(spd / Math.max(1, f.c.walk));
    S.spd += (fast - S.spd) * 0.25;
    const ground = st === 'ground' || st === 'land' || st === 'jumpsquat' || st === 'shield';
    const air = st === 'air' || st === 'airdodge' || st === 'helpless' || st === 'ledge';
    S.airT = air ? Math.min(1, S.airT + 0.12) : Math.max(0, S.airT - 0.2);
    // whatever this layer does to the legs also lifts or drops the feet; measure before and after and
    // pay for it with the hips at the end, so nobody ever floats or sinks into the deck
    const y0 = ground ? pzFeetY(B) : null;
    let drop = 0;

    // ---- the standing silhouette, always on: stance width, how far the arms hang from the body,
    // how much the fighter hunches, where the head sits. This is what you read in a blacked-out frame.
    const post = 1 - S.crouch * 0.7;
    pzOut(B.LeftUpLeg, fwd, G.stance * post); pzOut(B.RightUpLeg, fwd, -G.stance * post);
    pzOut(B.LeftArm, fwd, -G.armGap * post); pzOut(B.RightArm, fwd, G.armGap * post);
    pzSpin(B.Spine01, lat, G.hunch * post); pzSpin(B.Spine02, lat, -G.chest * post);
    pzSpin(B.neck, lat, (-G.hunch * 0.75 + G.chest * 0.4) * post);
    pzOut(B.Head, fwd, G.cant * post);
    if (G.guard > 0.01) {                              // the shield archetypes carry their hands up
      pzSpin(B.LeftArm, lat, -0.30 * G.guard * post); pzSpin(B.RightArm, lat, -0.24 * G.guard * post);
      pzSpin(B.LeftForeArm, lat, 0.55 * G.guard * post); pzSpin(B.RightForeArm, lat, 0.45 * G.guard * post);
    }

    if (ground && S.spd < 0.22) {
      // ---- idle: breath, weight settling, and a sway whose speed and size are the fighter's own
      const w = t * G.rate, s = Math.sin(w), c = Math.cos(w * 2);
      pzSpin(B.Spine02, lat, G.breathe * s * 0.5); pzSpin(B.Spine01, lat, G.breathe * s * 0.25);
      pzOut(B.LeftArm, fwd, -G.breathe * 0.5 * s); pzOut(B.RightArm, fwd, G.breathe * 0.5 * s);
      pzYaw(B.Hips, G.sway * 0.45 * Math.sin(w * 0.55));
      pzYaw(B.Spine02, -G.sway * 0.35 * Math.sin(w * 0.55 + 0.7));
      pzSpin(B.Head, lat, -G.breathe * 0.4 * s);
      // heavy fighters drop into the hips and come back up slowly; light ones ride up
      drop = -G.bob * s + G.settle * (0.5 - 0.5 * c);
    } else if (ground) {
      // ---- walking / running: step cadence, stomp, lean, shoulder counter-rotation
      S.step += (0.16 + spd * 0.055) * G.stepRate;
      const p = S.step, sp = Math.sin(p), k = S.spd;
      // the shared `run` clip pitches the whole roster almost face-down (A/B: dev/anim2/I_gaitrun.png
      // vs I_gaitrun_nogait.png, the layer was not the cause). Stand everyone back up a little, and let
      // the speedsters keep more of the forward drive than the heavies.
      pzSpin(B.Spine01, lat, (-0.24 + G.lean) * k); pzSpin(B.neck, lat, (0.18 - G.lean * 0.55) * k);
      pzYaw(B.Spine02, G.roll * sp * k); pzYaw(B.Hips, -G.roll * 0.6 * sp * k);
      pzSpin(B.LeftArm, lat, G.armSwing * sp * k); pzSpin(B.RightArm, lat, -G.armSwing * sp * k);
      drop = G.stomp * Math.abs(sp) * k * (1 + G.heavy);
    }

    if (S.airT > 0.02) {
      // ---- in the air: a floaty fighter opens out and hangs, a heavy one tucks and drops
      const a = S.airT, rise = f.vy < 0 ? 1 : -1;
      pzSpin(B.LeftArm, lat, (-G.spread * 0.8 + G.tuck * 0.5) * a);
      pzSpin(B.RightArm, lat, (-G.spread * 0.8 + G.tuck * 0.5) * a);
      pzOut(B.LeftArm, fwd, -G.spread * 0.55 * a); pzOut(B.RightArm, fwd, G.spread * 0.55 * a);
      pzSpin(B.LeftUpLeg, lat, (-G.tuck * 0.5 + G.spread * 0.18) * a); pzSpin(B.RightUpLeg, lat, (-G.tuck * 0.35) * a);
      pzSpin(B.LeftLeg, lat, G.tuck * 0.7 * a); pzSpin(B.RightLeg, lat, G.tuck * 0.45 * a);
      pzSpin(B.Spine01, lat, (G.tuck * 0.22 - G.spread * 0.16 * rise) * a);
      pzYaw(B.Spine02, G.sway * 0.6 * Math.sin(t * G.rate * 0.8) * a);
    }

    // ---- attacks: same clip, different commitment. A heavy fighter winds up further and is carried
    // through by its own mass; a quick one snaps and is already back on guard.
    if (st === 'move' && f.move && f.move.def) {
      const d = f.move.def, total = Math.max(1, d.total || 1);
      let mid = 0.45, lo = Infinity, hi = -Infinity;
      if (d.hits) for (const hb of d.hits) if (hb.f) { if (hb.f[0] < lo) lo = hb.f[0]; if (hb.f[1] > hi) hi = hb.f[1]; }
      if (hi >= lo) mid = Math.min(0.9, Math.max(0.1, (lo + hi) / 2 / total));
      const k = Math.min(1, f.move.t / total);
      const drive = k < mid ? -(1 - k / mid) : (k - mid) / (1 - mid);   // -1 wound up, 0 contact, +1 followed through
      const sgn = drive < 0 ? -1 : 1, mag = Math.abs(drive);
      pzSpin(B.Spine01, lat, sgn * mag * G.commit);
      pzSpin(B.Spine02, lat, sgn * mag * G.commit * 0.5);
      pzYaw(B.Spine02, -sgn * mag * G.snap);   // pzYaw mirrors it for a left-facing fighter (was * f.face)
      pzOut(B.RightArm, fwd, G.armGap * 0.5 * mag * sgn);
    }

    if (y0 != null) { const y1 = pzFeetY(B); pzDropHips(B, drop + (y1 != null ? y1 - y0 : 0)); }
  }

  // ---- 4c. TUMBLE: a real launch spins ----
  // Audit B4: every launch played the `hit` flinch clip slowed down, so a fighter sent flying by a smash
  // drifted off stage standing upright with a sore face. Smash tumbles anyone launched hard enough (knockback
  // over 80 = our f.tumble). The body now cartwheels in the screen plane about its own middle, faster the
  // faster it is flying, and eases back upright when the tumble ends. Visual only: root transform, which
  // 91_v3_render rewrites from scratch every frame, so nothing accumulates.
  const pzTum = new WeakMap(), pzQz = new THREE.Quaternion(), PZ_Z = new THREE.Vector3(0, 0, 1);
  function pzTumble(av) {
    const f = av.f;
    let T = pzTum.get(av); if (!T) { T = { a: 0, w: 0 }; pzTum.set(av, T); }
    const on = f.state === 'hitstun' && f.tumble && f.air;
    if (on) {
      const sp = Math.hypot(f.vx, f.vy), dir = f.vx >= 0 ? -1 : 1;             // spin the way it is thrown
      if (f.hitlag <= 0) T.a += dir * Math.min(0.55, 0.05 + sp * 0.022);
      T.w = Math.min(1, T.w + 0.35);
    } else {
      // settle: to the nearest upright, quickly
      const up = Math.round(T.a / (Math.PI * 2)) * Math.PI * 2;
      T.a += (up - T.a) * 0.35; T.w = Math.max(0, T.w - 0.2);
      if (Math.abs(T.a - up) < 0.01) { T.a = 0; }
    }
    if (Math.abs(T.a) < 1e-3) return;
    const hh = f.h * SC * 0.66;                                                   // about the middle of the drawn body
    const p = av.root.position, cy = p.y + hh;
    pzQz.setFromAxisAngle(PZ_Z, T.a);
    av.root.quaternion.premultiply(pzQz);
    const s = Math.sin(T.a), c = Math.cos(T.a);
    p.x += -(-hh) * s * 1; p.y = cy + (-hh) * c;                                  // rotate the feet about the centre
    av.root.updateMatrixWorld(true);
  }

  // ---- per-avatar entry point (called from V3.decorate, after the mixer) ----
  V3.poseFrame = function (av) {
    const f = av.f, B = av.bones;
    if (!B || !B.Hips) return;
    pzBegin(av);                                       // take last frame's pose back off first
    pzMir = av.mirror && av.mirror.scale.x < 0 ? -1 : 1;
    try { pzTumble(av); } catch (e) { V3.fxErr(e, '97_v3_pose:596'); /* visual only */ }
    if (f.state === 'dead') { pzAimOf.delete(f); return; }
    let S = pzSt.get(av); if (!S) { S = { crouch: 0, aim: 0, swell: 0, swellOn: false }; pzSt.set(av, S); }
    // motion identity first, so everything below (crouch, hammer, aim) layers on top of a body that is
    // already standing and moving like this particular fighter
    let GL = pzGLog.get(av); if (!GL) { GL = { b: [], q: [], n: 0 }; pzGLog.set(av, GL); }
    if (!V3.noGait && f.hitlag > 0 && GL.n && !V3.noHitlagFreeze) { try { pzReplay(GL); } catch (e) { V3.fxErr(e, '97 replay'); } }
    else if (!V3.noGait) { GL.n = 0; pzGRec = GL; try { pzGait(av); } catch (e) { V3.fxErr(e, '97_v3_pose:601'); /* a pose layer must never take the frame down */ } pzGRec = null; }
    pzGRec = null;
    // swallowed someone / been swallowed
    const mvS = f.state === 'move' && f.move && f.move.def.swallow ? f.move : null;
    const wantSwell = mvS ? Math.min(1, mvS.t / 13) : 0;
    S.swell += (wantSwell - S.swell) * (wantSwell > S.swell ? 0.5 : 0.22);
    if (S.swell > 0.02) { pzSwell(av, S.swell, mvS); S.swellOn = true; }
    else if (S.swellOn) { if (B.Head) B.Head.scale.setScalar(1); S.swellOn = false; }
    pzSwallowed(av);
    // crouch (holding Down on the ground; the spot dodge keeps its own spin clip)
    const wantCrouch = !f.air && f.crouch && f.state !== 'move' ? 1 : 0;
    S.crouch += (wantCrouch - S.crouch) * (wantCrouch ? 0.42 : 0.3);
    if (S.crouch > 0.01) pzCrouch(av, Math.min(1, S.crouch));
    // hammer windmill, and the big mallet swings
    if (f.state === 'hammer') pzHammer(av);
    else if (f.state === 'move' && f.move && f.move.def.fx === 'mallet') pzMallet(av);
    // gun aim, then the carry pose for anything else held out of the shop
    const aim = pzAimDir(f);
    const carry = aim ? null : pzCarryDir(av);
    const want = aim || carry;
    S.aim += ((want ? 1 : 0) - S.aim) * (want ? 0.55 : 0.3);
    if (aim && S.aim > 0.02) pzAimPose(av, aim, Math.min(1, S.aim));
    else if (carry && S.aim > 0.02) pzAimPose(av, carry, Math.min(1, S.aim) * carry[2]);
    else pzAimOf.delete(f);
    // strikes reach their hitboxes (last: it bends the bones the clip, gait and crouch left)
    if (!V3.noStrike) { try { pzStrike(av); } catch (e) { V3.fxErr(e, '97_v3_pose:622'); /* a pose layer must never take the frame down */ } }
    // FEET ON THE FLOOR (audit #18): the shared clips were made for one rig, so on some fighters a grounded move
    // lifts the whole body - DOGE's and BONK's down smash floated the lowest toe 0.17 above the floor against 0.04
    // standing (dev probe hitf_<move>_sink). Each fighter's own standing offset is learned once, then any grounded
    // frame that drifts from it pulls the root back by the difference (eased, clamped): visual only.
    // OFF by default (9/23): it plants DOGE's and BONK's down smash, but on other moves it fights clips that leave the
    // ground on purpose, and at 01:30 I could not show it looks better. V3.grounding = true to try it.
    if (V3.grounding) { try { pzGround(av); } catch (e) { V3.fxErr(e, '97 pzGround'); } }
  };
  const PZ_GROUNDED = { ground: 1, move: 1, shield: 1, land: 1, jumpsquat: 1, dizzy: 1, grabbing: 1 };
  const pzFootV = new THREE.Vector3();
  function pzGround(av) {
    const f = av.f, B = av.bones;
    if (f.air || !PZ_GROUNDED[f.state] || f.hitlag > 0) { av.gDy = (av.gDy || 0) * 0.6; if (Math.abs(av.gDy) > 1e-4) av.root.position.y -= av.gDy; return; }
    let lo = 1e9;
    for (const n of ['LeftToeBase', 'RightToeBase', 'LeftFoot', 'RightFoot']) { const b = B[n]; if (!b) continue; b.getWorldPosition(pzFootV); if (pzFootV.y < lo) lo = pzFootV.y; }
    if (lo > 1e8) return;
    const floor = -f.y * SC, off = lo - floor;
    // learn the reference from STANDING frames only, averaged over 30 of them (one sample from a run frame put the
    // reference where a lifted foot was, and every other move then got pushed the wrong way)
    if (av.gN == null) { av.gN = 0; av.gSum = 0; }
    if (f.state === 'ground' && !f.move && Math.abs(f.vx) < 0.2 && av.gN < 30) { av.gSum += off; av.gN++; av.gRef = av.gSum / av.gN; }
    if (av.gN < 8) return;
    const d = av.gRef - off;
    const want = Math.abs(d) < 0.03 ? 0 : Math.max(-0.14, Math.min(0.06, d));   // dead-band: only real float
    av.gDy = (av.gDy || 0) + (want - (av.gDy || 0)) * 0.35;
    av.root.position.y += av.gDy;
  }
  // 91_v3_render.mjs asks these two, per frame: which clip this fighter rests in, and how fast its
  // looping clips run. Cheapest per-fighter differentiation there is — no new animation data at all.
  const PZ_IDLE = { tank: 'block', guard: 'block', rager: 'guard', bruiser: 'guard', drifter: 'idle', stoic: 'idle', springy: 'idle', runner: 'guard', plummet: 'guard', plain: 'guard' };
  V3.gaitIdleClip = function (f) {
    const G = pzIdentity(f.c);
    return f.state === 'shield' ? 'block' : (PZ_IDLE[G.arch] || 'guard');
  };
  V3.gaitRate = function (f) {
    const G = pzIdentity(f.c);
    return Math.max(0.6, Math.min(1.4, 0.80 + G.quick * 0.45 - G.heavy * 0.22 + (G.arch === 'runner' ? 0.08 : 0) + (G.arch === 'tank' ? -0.05 : 0)));
  };
  // how a fighter spends the time inside its own swing (91_v3_render strikeSync). >1 loads up and is
  // dragged through contact, <1 snaps out and holds the follow-through. Contact is untouched.
  V3.gaitEase = function (f) {
    const G = pzIdentity(f.c);
    return Math.max(0.68, Math.min(1.5, 1 + G.heavy * 0.42 + G.brawn * 0.16 - G.quick * 0.38 - G.floaty * 0.08));
  };
  V3.gaitOf = f => pzIdentity(f.c ? f.c : f);   // dev inspection (dev/anim_probe.js scene `gait`)
  // 92_v3_items.mjs asks this where the held prop should point: a gun lies along the shot
  V3.aimCarry = function (f, kind) {
    if (!PZ_GUN[kind]) return null;
    return pzAimOf.get(f) || null;
  };
}
