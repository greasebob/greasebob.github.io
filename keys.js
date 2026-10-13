// Piano keys falling behind the page. The cursor pushes them aside, and each key it touches plays the
// song's next step, as QuartzMIDI's Tap does. The notes are Salamander Grand Piano samples
// (notes/CREDITS.txt), cut from P2Piano's bank; the songs are in songs/ (tools/build-songs.py).
(() => {
  const canvas = document.getElementById('keys');
  const ctx = canvas.getContext('2d');
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  const dark = matchMedia('(prefers-color-scheme: dark)');
  const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  const BLACK = [1, 3, 6, 8, 10];
  const LO = 36, HI = 96; // the Roblox piano's 61 keys, C2 to C7
  const REACH = 18;       // how far from the cursor a key is touched, px
  const ROOTS = [];       // the sampled notes, A0 to C8 a minor third apart
  for (let n = 21; n <= 108; n += 3) ROOTS.push(n);
  // the velocity layers sampled (tools/cut-samples.py), each for velocities up to its top
  const LAYERS = [{ name: 'v4', top: 48 }, { name: 'v8', top: 72 }, { name: 'v12', top: 100 }, { name: 'v16', top: 127 }];

  let W = 0, H = 0, keys = [], colors = {}, last = 0;
  const cursor = { x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0, on: false, fresh: true };

  // ---- sound ----
  let ac = null, out = null, muted = false;
  const buffers = new Map(), voices = [];
  const soundBtn = document.getElementById('sound');

  function startAudio() {
    if (!ac) {
      // A slightly larger buffer than the default, so a busy page does not starve it (a crackle); the keys'
      // light waits out its delay. No compressor, so soft and loud stay apart; a pedalled chord can sum past
      // full scale, so a limiter touches only those peaks, where it would clip.
      ac = new AudioContext({ latencyHint: 'balanced' });
      ac.onstatechange = showSound;
      const limit = ac.createDynamicsCompressor();
      limit.threshold.value = -3;
      limit.knee.value = 0;
      limit.ratio.value = 20;
      limit.attack.value = 0.001;
      limit.release.value = 0.1;
      out = ac.createGain();
      out.gain.value = 1.2;
      out.connect(limit).connect(ac.destination);
      // the middle layer first, so a note sounds soon; the others follow one after another
      (async () => {
        for (const i of [1, 2, 0, 3]) {
          await Promise.all(ROOTS.map(n => fetch(`notes/${LAYERS[i].name}/${n}.mp3`).then(r => r.arrayBuffer())
            .then(b => ac.decodeAudioData(b)).then(buf => buffers.set(`${i}:${n}`, buf)).catch(() => {})));
        }
      })();
    }
    if (ac.state !== 'running') ac.resume().then(showSound, () => {});
    showSound();
  }
  const heard = () => !muted && ac && ac.state === 'running';

  // Crossed out when muted. Before the browser lets the page sound (until the first click or key) it is also
  // crossed out and lit in the accent, pulsing, and a click on it then starts the sound rather than muting it.
  function showSound() {
    const waiting = !muted && !heard();
    soundBtn.querySelector('use').setAttribute('href', muted || waiting ? '#volume-x' : '#volume-2');
    soundBtn.setAttribute('aria-pressed', muted || waiting ? 'false' : 'true');
    soundBtn.classList.toggle('wake', waiting);
  }

  // A song: [[time_s, [[note, velocity, length_s], ...]], ...], one step per chord. One is picked at random
  // from songs/index.json, and the next is fetched while it plays, to follow it when it ends.
  let list = [], song = null, next = null, at = 0, prev = -1;
  function pick() {
    if (!list.length) return Promise.resolve(null);
    let i = Math.floor(Math.random() * list.length);
    if (i === prev && list.length > 1) i = (i + 1) % list.length;
    prev = i;
    return fetch(`songs/${list[i].file}`).then(r => r.json()).then(s => ({ name: list[i].name, steps: s }))
      .catch(() => null);
  }
  // For trying the finale: ?steps=10 cuts every song to its first ten steps.
  const cut = parseInt(new URLSearchParams(location.search).get('steps'), 10);
  function begin(s) {
    if (!s) return;
    song = cut > 0 ? s.steps.slice(0, cut) : s.steps;
    at = 0;
    soundBtn.title = `Sound: ${s.name}`;
    next = pick();
  }
  fetch('songs/index.json').then(r => r.json()).then(l => { list = l; return pick(); }).then(begin).catch(() => {});

  // Plays the song's next step, and lets up the notes whose written end it has passed. Each note sounds at
  // its velocity in the MIDI file, however fast the cursor hits. Before the page may sound (or muted) the
  // song still moves on and its keys still light, so the first hits are never lost.
  function strike(fallback) {
    if (auto || performance.now() < quiet) return; // the song plays itself, or the finale rings
    if (!song) { play(fallback, 76); light(fallback, 600); return; }
    const notes = playStep();
    if (at) return;
    celebrate(notes); // played to the end: a finale, then on to the next song
    if (next) next.then(s => { if (s) begin(s); });
  }

  // The keys lit: each note sounding, from when it is heard (the sound card's delay after the call) to its end.
  const lit = [];
  const delay = () => (heard() ? ((ac.outputLatency || 0) + (ac.baseLatency || 0)) * 1000 : 0);
  function light(note, ms) {
    const on = performance.now() + delay();
    for (const e of lit) if (e.note === note) e.off = Math.min(e.off, on); // struck again
    const e = { note, on, off: on + ms };
    lit.push(e);
    return e;
  }
  function unlight(e, after = 0) { e.off = Math.min(e.off, performance.now() + delay() + after); }

  // Plays the step at `at` and moves on, back to 0 at the song's end; returns the step's notes. Played by
  // hand, a note rings until a later step passes its written end, as Tap's do; played by Play, it ends there.
  let held = []; // the song's notes sounding: { end (song time), v (voice, if heard), e (lit) }
  function playStep() {
    const [time, notes] = song[at];
    held = held.filter(h => {
      if (h.end > time + 0.001) return true;
      if (h.v) stop(h.v, ac.currentTime);
      unlight(h.e);
      return false;
    });
    for (const [note, vel, len] of notes) {
      const v = play(note, vel);
      if (v && auto) {
        const t = ac.currentTime + len;
        v.g.gain.setTargetAtTime(0, t, 0.08);
        v.src.stop(t + 0.6);
      }
      held.push({ end: time + len, v, e: light(note, auto ? len * 1000 : 3000) });
    }
    at = (at + 1) % song.length;
    return notes;
  }

  // Lets every note go, `after` ms from now.
  function releaseAll(after = 0) {
    if (ac) for (const v of voices) stop(v, ac.currentTime + after / 1000);
    for (const e of lit) unlight(e, after);
    held = [];
  }

  // Play: the song plays itself in time from where it stands, its notes lighting the keys of their name,
  // and goes on to the next song at its end. A key touched meanwhile is pushed aside but plays nothing.
  let auto = false, autoAt = 0, autoTimer = 0;
  const autoBtn = document.getElementById('autoplay');
  function showAuto() {
    autoBtn.querySelector('use').setAttribute('href', auto ? '#pause' : '#play');
    autoBtn.setAttribute('aria-pressed', auto ? 'true' : 'false');
    autoBtn.setAttribute('aria-label', auto ? 'Pause' : 'Play');
    autoBtn.title = auto ? 'Pause' : 'Play';
  }
  function autoTick() {
    autoTimer = 0;
    if (!auto) return;
    if (!song) { autoTimer = setTimeout(autoTick, 100); return; }
    const now = performance.now();
    // the song's clock: a step more than a quarter second late (a tab in the background) starts it afresh
    if (!autoAt || now - (autoAt + song[at][0] * 1000) > 250) autoAt = now - song[at][0] * 1000;
    while (song && now >= autoAt + song[at][0] * 1000) {
      const notes = playStep();
      if (at === 0) { // the end: the next song, from its start
        releaseAll(400);
        autoAt = 0;
        if (next) next.then(s => { if (s) begin(s); }); // fetched while this one played
        autoTimer = setTimeout(autoTick, 1200);
        return;
      }
    }
    autoTimer = setTimeout(autoTick, Math.max(0, autoAt + song[at][0] * 1000 - performance.now()));
  }
  autoBtn.addEventListener('click', () => {
    auto = !auto;
    showAuto();
    clearTimeout(autoTimer);
    autoAt = 0;
    if (!auto) { releaseAll(); return; }
    if (muted) { muted = false; showSound(); }
    startAudio();
    autoTick();
  });

  // The finale: the last chord rings and runs up the keyboard, the keys burst away from the cursor in every
  // colour, and notes fly out like confetti. Keys touched while it lasts stay quiet.
  let quiet = 0, party = 0;
  const confetti = [];
  function celebrate(chord) {
    const now = performance.now();
    quiet = now + 1900;
    party = 1;
    setTimeout(() => releaseAll(), 1800);
    const pcs = [...new Set(chord.map(([n]) => n % 12))];
    const low = Math.min(...chord.map(([n]) => n));
    const run = [];
    for (let n = low; n <= 108 && run.length < 14; n++) if (pcs.includes(n % 12)) run.push(n);
    run.forEach((n, i) => setTimeout(() => { play(n, Math.round(50 + 50 * i / run.length)); light(n, 1550 - i * 55); }, 250 + i * 55));
    const cx = cursor.on ? cursor.x : W / 2, cy = cursor.on ? cursor.y : H / 2;
    if (still.matches) return;
    for (const k of keys) {
      const dx = k.x - cx, dy = k.y - cy, d = Math.hypot(dx, dy) || 1;
      const push = 2200 * Math.exp(-d / 500);
      k.vx += (dx / d) * push;
      k.vy += (dy / d) * push;
      k.va += (Math.random() - 0.5) * 16;
    }
    for (let i = 0; i < 140; i++) {
      const a = Math.random() * Math.PI * 2, v = 300 + Math.random() * 700;
      confetti.push({
        x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 350, a: Math.random() * 6, va: (Math.random() - 0.5) * 10,
        hue: Math.random() * 360, size: 12 + Math.random() * 12, glyph: '♪♫♩♬'[i % 4], life: 0, end: 1.8 + Math.random() * 1.2,
      });
    }
  }

  // Plays a note at a MIDI velocity: the layer recorded at that strength (or the nearest yet loaded), so a soft
  // note is mellow and a loud one bright, at the SoundFont standard's level, (velocity / 127)², as P2Piano's
  // synth plays the same bank (its recordings are each brought to one level).
  function play(note, vel) {
    if (!ac || muted || ac.state !== 'running') return null;
    const root = ROOTS.reduce((a, b) => Math.abs(b - note) < Math.abs(a - note) ? b : a);
    const want = LAYERS.findIndex(l => vel <= l.top);
    let buf = null, li = -1;
    for (const i of [want, want + 1, want - 1, want + 2, want - 2, want + 3, want - 3])
      if (i >= 0 && i < LAYERS.length && buffers.has(`${i}:${root}`)) { buf = buffers.get(`${i}:${root}`); li = i; break; }
    if (!buf) return null;
    const gain = (vel / 127) ** 2;
    const t = ac.currentTime;
    // A key struck again is damped first, as a piano's is.
    for (const v of voices) if (v.note === note) stop(v, t);
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = 2 ** ((note - root) / 12);
    const g = ac.createGain();
    g.gain.value = gain;
    src.connect(g).connect(out);
    src.start(t);
    const v = { note, src, g, done: false };
    src.onended = () => { const i = voices.indexOf(v); if (i >= 0) voices.splice(i, 1); };
    voices.push(v);
    const live = voices.filter(x => !x.done);
    if (live.length > 24) stop(live[0], t);
    return v;
  }

  function stop(v, t) {
    if (v.done) return;
    v.done = true;
    v.g.gain.setTargetAtTime(0, t, 0.08); // the damper
    v.src.stop(t + 0.6);
  }

  // The browser lets sound start only from a click or a key, so the first one anywhere starts it.
  addEventListener('pointerdown', e => { if (!muted && !e.target.closest('#sound')) startAudio(); }, true);
  addEventListener('keydown', () => { if (!muted) startAudio(); }, true);
  soundBtn.addEventListener('click', () => {
    if (!muted && !heard()) { startAudio(); return; } // crossed out only because the browser held it back
    muted = !muted;
    if (muted) releaseAll();
    showSound();
    if (!muted) startAudio();
  });
  showSound();
  startAudio(); // plays at once where the browser allows it, as for a site visited before

  // ---- keys ----
  function readColors() {
    const s = getComputedStyle(document.documentElement);
    for (const k of ['white', 'white-edge', 'white-label', 'black', 'black-face', 'black-edge', 'black-label', 'black-lit-ink', 'shadow'])
      colors[k] = s.getPropertyValue(`--key-${k}`).trim();
    colors.accent = s.getPropertyValue('--accent').trim();
    colors['on-accent'] = s.getPropertyValue('--on-accent').trim();
  }

  function spawn(k, above) {
    const note = LO + Math.floor(Math.random() * (HI - LO + 1));
    const black = BLACK.includes(note % 12);
    const s = 0.6 + Math.random() * 0.4; // nearer keys are bigger and fall faster
    k.note = note;
    k.name = NAMES[note % 12] + (Math.floor(note / 12) - 1);
    k.black = black;
    k.s = s;
    k.w = (black ? 18 : 30) * s;
    k.h = (black ? 100 : 150) * s;
    k.m = (k.w * k.h) / 4500;
    k.I = (k.m * (k.w * k.w + k.h * k.h)) / 12;
    k.x = Math.random() * W;
    k.y = above ? -k.h - Math.random() * 200 : Math.random() * (H + k.h) - k.h / 2;
    k.fall = (180 + Math.random() * 120) * s; // a waterfall
    k.vx = 0;
    k.vy = k.fall;
    k.a = (Math.random() - 0.5) * 0.3;
    k.drift = (Math.random() - 0.5) * 0.15;
    k.va = k.drift;
    k.flash = 0;
    k.touch = false;
    k.struck = 0;
    return k;
  }

  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    W = innerWidth;
    H = innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = Math.round(Math.min(90, Math.max(24, (W * H) / 15000)));
    while (keys.length < n) keys.push(spawn({}, false));
    keys.length = n;
  }

  // Pushes key k out of the cursor's reach at (cx, cy); returns the speed it was struck at, or -1.
  function contact(k, cx, cy) {
    const c = Math.cos(k.a), s = Math.sin(k.a);
    const dx = cx - k.x, dy = cy - k.y;
    const lx = dx * c + dy * s, ly = -dx * s + dy * c; // the cursor in the key's frame
    const hw = k.w / 2, hh = k.h / 2;
    const qx = Math.max(-hw, Math.min(hw, lx)), qy = Math.max(-hh, Math.min(hh, ly));
    let nx = qx - lx, ny = qy - ly, pen;
    const d = Math.hypot(nx, ny);
    if (d > 0) {
      if (d >= REACH) return -1;
      nx /= d; ny /= d; pen = REACH - d;
    } else { // the cursor is inside: the key leaves by its nearest side
      const ex = hw - Math.abs(lx), ey = hh - Math.abs(ly);
      if (ex < ey) { nx = lx > 0 ? -1 : 1; ny = 0; pen = REACH + ex; } else { nx = 0; ny = ly > 0 ? -1 : 1; pen = REACH + ey; }
    }
    if (still.matches) return 0;
    const wx = nx * c - ny * s, wy = nx * s + ny * c;     // push direction
    const rx = qx * c - qy * s, ry = qx * s + qy * c;     // contact point from the key's centre
    const p = Math.min(pen, REACH);
    k.x += wx * p;
    k.y += wy * p;
    const pvx = k.vx - k.va * ry, pvy = k.vy + k.va * rx; // the key's velocity at the contact
    const rel = (pvx - cursor.vx) * wx + (pvy - cursor.vy) * wy;
    if (rel >= 0) return 0;
    const rn = rx * wy - ry * wx;
    const j = (-1.4 * rel) / (1 / k.m + (rn * rn) / k.I);
    k.vx += (j * wx) / k.m;
    k.vy += (j * wy) / k.m;
    k.va += (j * rn) / k.I;
    return -rel;
  }

  function step(dt, now) {
    const steps = cursor.on ? Math.min(8, Math.max(1, Math.ceil(Math.hypot(cursor.x - cursor.px, cursor.y - cursor.py) / 8))) : 0;
    if (cursor.on) {
      cursor.vx = Math.max(-3000, Math.min(3000, (cursor.x - cursor.px) / dt));
      cursor.vy = Math.max(-3000, Math.min(3000, (cursor.y - cursor.py) / dt));
    }
    const relax = 1 - Math.exp(-dt * 2);
    const nowMs = performance.now();
    for (let i = lit.length - 1; i >= 0; i--) if (lit[i].off <= nowMs) lit.splice(i, 1);
    const sounding = new Set(lit.filter(e => e.on <= nowMs).map(e => e.note));
    for (const k of keys) {
      if (!still.matches) {
        k.x += k.vx * dt;
        k.y += k.vy * dt;
        k.a += k.va * dt;
        k.vx -= k.vx * relax;
        k.vy += (k.fall - k.vy) * relax;
        k.va += (k.drift - k.va) * relax;
        const v = Math.hypot(k.vx, k.vy);
        if (v > 2500) { k.vx *= 2500 / v; k.vy *= 2500 / v; }
        k.va = Math.max(-12, Math.min(12, k.va));
      }
      // The cursor's path this frame, in short steps, so a quick swipe cannot pass through a key.
      let hit = -1;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        hit = Math.max(hit, contact(k, cursor.px + (cursor.x - cursor.px) * t, cursor.py + (cursor.y - cursor.py) * t));
      }
      if (hit >= 0 && !k.touch && now - k.struck > 120) {
        strike(k.note); // lights the song's notes, not the key hit
        k.struck = now;
      }
      k.touch = hit >= 0;
      // the keys of the notes sounding stay lit, pedal and all, whether the song plays itself or is hit
      k.flash = sounding.has(k.note) ? 1 : Math.max(0, k.flash - dt * 3);
      const r = Math.max(k.w, k.h);
      if (k.y - r > H + 40 || k.y < -H - 400 || k.x < -r - 200 || k.x > W + r + 200) spawn(k, true);
    }
    cursor.px = cursor.x;
    cursor.py = cursor.y;
    party = Math.max(0, party - dt / 2.5);
    for (let i = confetti.length - 1; i >= 0; i--) {
      const c = confetti[i];
      c.life += dt;
      if (c.life > c.end) { confetti.splice(i, 1); continue; }
      c.vx -= c.vx * dt * 1.2;
      c.vy += (900 - c.vy * 1.2) * dt;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.a += c.va * dt;
    }
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    keys.sort((a, b) => a.s - b.s); // a key respawns at a new depth
    for (const k of keys) {
      const w = k.w, h = k.h, x = -w / 2, y = -h / 2, r = 4 * k.s;
      ctx.save();
      ctx.translate(k.x, k.y);
      ctx.rotate(k.a);
      ctx.globalAlpha = 0.6 + (k.s - 0.6); // farther keys sink into the page
      ctx.fillStyle = colors.shadow;
      ctx.beginPath();
      ctx.roundRect(x + 1, y + 3 * k.s, w, h, r);
      ctx.fill();
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, r);
      ctx.fillStyle = k.black ? colors.black : colors.white;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = k.black ? colors['black-edge'] : colors['white-edge'];
      ctx.stroke();
      if (k.black) { // the black key's top face, shorter at the front
        ctx.beginPath();
        ctx.roundRect(x + 2.5 * k.s, y + 2 * k.s, w - 5 * k.s, h - 12 * k.s, r * 0.6);
        ctx.fillStyle = colors['black-face'];
        ctx.fill();
      }
      if (k.flash > 0) { // lit: nearly solid accent with a glow, even on a far key
        const a = ctx.globalAlpha;
        ctx.globalAlpha = Math.min(1, a + 0.4) * k.flash * 0.9;
        // white keys light blue and black keys violet at first, both drifting round the colour wheel once in 3 minutes
        const shift = (performance.now() / 1000) * 2;
        const lit = dark.matches
          ? (k.black ? `hsl(${258 + shift}, 80%, 75%)` : `hsl(${207 + shift}, 79%, 61%)`)
          : (k.black ? `hsl(${259 + shift}, 63%, 57%)` : `hsl(${208 + shift}, 89%, 41%)`);
        ctx.shadowColor = lit;
        ctx.shadowBlur = 22 * k.flash;
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, r);
        ctx.fillStyle = lit;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.globalAlpha = a;
      }
      if (party > 0) { // the finale's colours, running across the screen
        const a = ctx.globalAlpha;
        ctx.globalAlpha = a * Math.min(1, party * 1.5) * 0.6;
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, r);
        ctx.fillStyle = `hsl(${(k.x / W * 360 + performance.now() / 4) % 360}, 85%, 60%)`;
        ctx.fill();
        ctx.globalAlpha = a;
      }
      ctx.fillStyle = k.flash > 0.5 ? (k.black ? colors['black-lit-ink'] : colors['on-accent']) : k.black ? colors['black-label'] : colors['white-label'];
      ctx.font = `500 ${((k.black ? 9 : 11) * k.s).toFixed(1)}px "IBM Plex Sans", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(k.name, 0, h / 2 - (k.black ? 16 : 10) * k.s);
      ctx.restore();
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const c of confetti) {
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(c.a);
      ctx.globalAlpha = Math.min(1, (c.end - c.life) / 0.6);
      ctx.fillStyle = `hsl(${c.hue}, 85%, ${dark.matches ? 65 : 50}%)`;
      ctx.font = `600 ${c.size.toFixed(0)}px system-ui, sans-serif`;
      ctx.fillText(c.glyph, 0, 0);
      ctx.restore();
    }
    ctx.textBaseline = 'alphabetic';
  }

  function frame(t) {
    const dt = Math.min(0.05, (t - last) / 1000 || 0.016);
    last = t;
    step(dt, t);
    draw();
    requestAnimationFrame(frame);
  }

  // Only the page's background reaches the keys: over the top strip or a card the cursor is away.
  function move(e) {
    const away = e.target.closest && e.target.closest('.strip, .card');
    if (away) { cursor.on = false; return; }
    cursor.x = e.clientX;
    cursor.y = e.clientY;
    if (!cursor.on) { cursor.px = cursor.x; cursor.py = cursor.y; cursor.on = true; }
  }
  addEventListener('pointermove', move, { passive: true });
  addEventListener('pointerdown', move, { passive: true });
  addEventListener('pointerup', e => { if (e.pointerType !== 'mouse') cursor.on = false; });
  addEventListener('pointercancel', () => { cursor.on = false; });
  document.addEventListener('pointerleave', () => { cursor.on = false; });
  document.documentElement.addEventListener('mouseleave', () => { cursor.on = false; });

  readColors();
  dark.addEventListener('change', readColors);
  addEventListener('resize', resize);
  resize();
  document.fonts && document.fonts.ready.then(draw);
  requestAnimationFrame(frame);
})();
