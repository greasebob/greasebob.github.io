// Piano keys falling behind the page. The cursor pushes them aside, and each key it touches plays the
// song's next step, as QuartzMIDI's Tap does. The notes are Salamander Grand Piano samples
// (notes/CREDITS.txt), cut from P2Piano's bank; the song is in song.json.
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

  let W = 0, H = 0, keys = [], colors = {}, last = 0;
  const cursor = { x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0, on: false, fresh: true };

  // ---- sound ----
  let ac = null, out = null, muted = false;
  const buffers = new Map(), voices = [];
  const soundBtn = document.getElementById('sound');

  function startAudio() {
    if (!ac) {
      ac = new AudioContext();
      const comp = ac.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      out = ac.createGain();
      out.gain.value = 0.55;
      out.connect(comp);
      comp.connect(ac.destination);
      for (const n of ROOTS) {
        fetch(`notes/${n}.mp3`).then(r => r.arrayBuffer()).then(b => ac.decodeAudioData(b))
          .then(buf => buffers.set(n, buf)).catch(() => {});
      }
    }
    if (ac.state !== 'running') ac.resume();
  }

  function showSound() {
    soundBtn.querySelector('use').setAttribute('href', muted ? '#volume-x' : '#volume-2');
    soundBtn.setAttribute('aria-pressed', muted ? 'false' : 'true');
  }

  // The song: [[time_s, [[note, velocity, length_s], ...]], ...], one step per chord.
  let song = null, at = 0;
  fetch('song.json').then(r => r.json()).then(s => { song = s; }).catch(() => {});

  // Plays the song's next step, and lets up the notes whose written end it has passed.
  function strike(fallback, hit) {
    if (!ac || muted || ac.state !== 'running') return; // the song waits for the sound
    if (!song) { play(fallback, Math.min(1, 0.35 + hit / 1500)); return; }
    const [time, notes] = song[at];
    if (ac) for (const v of voices) if (v.end !== undefined && v.end <= time + 0.001) stop(v, ac.currentTime);
    const touch = 0.7 + 0.3 * Math.min(1, hit / 1200);
    for (const [note, vel, len] of notes) {
      const v = play(note, Math.min(1, (vel / 110) * touch));
      if (v) v.end = time + len;
    }
    at = (at + 1) % song.length;
    if (at === 0 && ac) for (const v of voices) stop(v, ac.currentTime + 0.4); // round again
  }

  function play(note, gain) {
    if (!ac || muted || ac.state !== 'running') return null;
    const root = ROOTS.reduce((a, b) => Math.abs(b - note) < Math.abs(a - note) ? b : a);
    const buf = buffers.get(root);
    if (!buf) return null;
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
    muted = !muted;
    showSound();
    if (!muted) startAudio();
  });
  showSound();
  startAudio(); // plays at once where the browser allows it, as for a site visited before

  // ---- keys ----
  function readColors() {
    const s = getComputedStyle(document.documentElement);
    for (const k of ['white', 'white-edge', 'white-label', 'black', 'black-face', 'black-edge', 'black-label', 'shadow'])
      colors[k] = s.getPropertyValue(`--key-${k}`).trim();
    colors.accent = s.getPropertyValue('--accent').trim();
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
        strike(k.note, hit);
        k.flash = 1;
        k.struck = now;
      }
      k.touch = hit >= 0;
      k.flash = Math.max(0, k.flash - dt * 3);
      const r = Math.max(k.w, k.h);
      if (k.y - r > H + 40 || k.y < -H - 400 || k.x < -r - 200 || k.x > W + r + 200) spawn(k, true);
    }
    cursor.px = cursor.x;
    cursor.py = cursor.y;
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
      if (k.flash > 0) {
        const a = ctx.globalAlpha;
        ctx.globalAlpha = a * k.flash * 0.45;
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, r);
        ctx.fillStyle = colors.accent;
        ctx.fill();
        ctx.globalAlpha = a;
      }
      ctx.fillStyle = k.black ? colors['black-label'] : colors['white-label'];
      ctx.font = `500 ${((k.black ? 9 : 11) * k.s).toFixed(1)}px "IBM Plex Sans", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(k.name, 0, h / 2 - (k.black ? 16 : 10) * k.s);
      ctx.restore();
    }
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
