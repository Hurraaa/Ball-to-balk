// =============================================================
//  NEON BREAKER — Premium pseudo-3D brick breaker
// =============================================================
(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;

  const ui = {
    score: document.getElementById('score'),
    level: document.getElementById('level'),
    lives: document.getElementById('lives'),
    overlay: document.getElementById('overlay'),
    startBtn: document.getElementById('startBtn'),
  };

  // ---------------------- AUDIO (procedural) -------------------
  let audioCtx = null;
  function ensureAudio() {
    if (!audioCtx) {
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch { audioCtx = null; }
    }
  }
  function beep(freq = 440, dur = 0.07, type = 'square', vol = 0.08, slide = 0) {
    if (!audioCtx) return;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, audioCtx.currentTime);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), audioCtx.currentTime + dur);
    g.gain.setValueAtTime(vol, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
    o.connect(g).connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + dur);
  }
  const sfx = {
    paddle:  () => beep(280, 0.05, 'square', 0.06),
    wall:    () => beep(220, 0.04, 'square', 0.05),
    brick:   () => beep(520, 0.06, 'triangle', 0.07, 200),
    power:   () => { beep(660, 0.08, 'sine', 0.1, 400); setTimeout(() => beep(880, 0.08, 'sine', 0.1, 400), 70); },
    lose:    () => beep(120, 0.4, 'sawtooth', 0.12, -80),
    win:     () => { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => beep(f, 0.12, 'triangle', 0.09), i * 90)); },
  };

  // ---------------------- STATE --------------------------------
  const STATE = { MENU: 'menu', PLAY: 'play', PAUSED: 'paused', GAMEOVER: 'over', WIN: 'win' };
  let state = STATE.MENU;

  let score = 0;
  let level = 1;
  let lives = 3;
  let combo = 0;
  let comboTimer = 0;

  // Paddle
  const paddle = {
    w: 130, h: 18, x: W / 2 - 65, y: H - 50,
    speed: 12, vx: 0, baseW: 130, expiresAt: 0,
  };

  // Balls
  const balls = [];
  function spawnBall(stuck = true) {
    balls.push({
      x: paddle.x + paddle.w / 2,
      y: paddle.y - 12,
      vx: 0, vy: 0,
      r: 9,
      stuck,
      trail: [],
      speed: 7.2,
      slowUntil: 0,
    });
  }

  // Bricks
  let bricks = [];
  const BRICK_ROWS_MAX = 8;
  const BRICK_COLS = 11;
  const BRICK_PAD = 6;
  const BRICK_TOP = 70;
  const BRICK_SIDE = 30;
  const BRICK_W = (W - BRICK_SIDE * 2 - BRICK_PAD * (BRICK_COLS - 1)) / BRICK_COLS;
  const BRICK_H = 26;

  // Particles
  const particles = [];
  // Floating score popups
  const popups = [];
  // Power-ups falling
  const powerups = [];

  // Keys
  const keys = { left: false, right: false };

  // ---------------------- LEVELS -------------------------------
  // Color palettes per row (top to bottom). hp = rows count
  // Each row uses one palette. Levels add density / hp.
  const PALETTES = [
    { base:'#ff3ec9', light:'#ffa6e8', dark:'#a3007a', glow:'rgba(255,62,201,0.55)' },  // pink
    { base:'#ff6b3e', light:'#ffc29a', dark:'#a73a13', glow:'rgba(255,107,62,0.55)' },  // orange
    { base:'#ffd86b', light:'#fff3b8', dark:'#a87f00', glow:'rgba(255,216,107,0.55)' }, // gold
    { base:'#5cff8a', light:'#bdffc8', dark:'#1f8a3f', glow:'rgba(92,255,138,0.55)' },  // green
    { base:'#22e3ff', light:'#b6f4ff', dark:'#0f7a99', glow:'rgba(34,227,255,0.55)' },  // cyan
    { base:'#8a5cff', light:'#cdb8ff', dark:'#3c1f99', glow:'rgba(138,92,255,0.55)' },  // violet
    { base:'#ff5577', light:'#ffb6c5', dark:'#a01a36', glow:'rgba(255,85,119,0.55)' },  // red
    { base:'#9bb0ff', light:'#d6dfff', dark:'#3a4ea0', glow:'rgba(155,176,255,0.55)' }, // periwinkle
  ];

  function buildLevel(lv) {
    bricks = [];
    const rows = Math.min(4 + Math.floor(lv / 2), BRICK_ROWS_MAX);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < BRICK_COLS; c++) {
        // Skip pattern variation
        let skip = false;
        if (lv === 2 && (r === 0 || r === rows - 1) && (c === 0 || c === BRICK_COLS - 1)) skip = true;
        if (lv === 3 && r === 1 && c % 2 === 0) skip = true;
        if (lv >= 4 && r === 0 && (c === 0 || c === BRICK_COLS - 1)) skip = true;
        if (lv >= 5 && r === Math.floor(rows / 2) && c % 3 === 0) skip = true;
        if (skip) continue;

        // HP: top rows tougher
        let hp = 1;
        if (lv >= 2 && r === 0) hp = 2;
        if (lv >= 4 && r <= 1) hp = 2;
        if (lv >= 6 && r === 0) hp = 3;

        const palette = PALETTES[r % PALETTES.length];
        const x = BRICK_SIDE + c * (BRICK_W + BRICK_PAD);
        const y = BRICK_TOP + r * (BRICK_H + BRICK_PAD);
        bricks.push({ x, y, w: BRICK_W, h: BRICK_H, hp, maxHp: hp, palette, hit: 0, alive: true });
      }
    }
  }

  // ---------------------- INPUT --------------------------------
  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft')  keys.left = true;
    if (e.key === 'ArrowRight') keys.right = true;
    if (e.code === 'Space') {
      e.preventDefault();
      releaseStuck();
    }
    if (e.key === 'p' || e.key === 'P') togglePause();
  });
  document.addEventListener('keyup', (e) => {
    if (e.key === 'ArrowLeft')  keys.left = false;
    if (e.key === 'ArrowRight') keys.right = false;
  });

  canvas.addEventListener('mousemove', (e) => {
    if (state !== STATE.PLAY) return;
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (W / rect.width);
    paddle.x = Math.max(0, Math.min(W - paddle.w, mx - paddle.w / 2));
  });
  canvas.addEventListener('click', () => releaseStuck());
  canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const t = e.touches[0];
    const mx = (t.clientX - rect.left) * (W / rect.width);
    paddle.x = Math.max(0, Math.min(W - paddle.w, mx - paddle.w / 2));
    releaseStuck();
  }, { passive: false });
  canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const t = e.touches[0];
    const mx = (t.clientX - rect.left) * (W / rect.width);
    paddle.x = Math.max(0, Math.min(W - paddle.w, mx - paddle.w / 2));
  }, { passive: false });

  ui.startBtn.addEventListener('click', () => {
    ensureAudio();
    startGame();
  });

  function releaseStuck() {
    if (state !== STATE.PLAY) return;
    for (const b of balls) {
      if (b.stuck) {
        const angle = (-Math.PI / 2) + (Math.random() - 0.5) * 0.6;
        b.vx = Math.cos(angle) * b.speed;
        b.vy = Math.sin(angle) * b.speed;
        b.stuck = false;
      }
    }
  }

  function togglePause() {
    if (state === STATE.PLAY) { state = STATE.PAUSED; showOverlay('paused'); }
    else if (state === STATE.PAUSED) { state = STATE.PLAY; hideOverlay(); }
  }

  // ---------------------- GAME FLOW ----------------------------
  function startGame() {
    score = 0; level = 1; lives = 3; combo = 0;
    paddle.w = paddle.baseW;
    paddle.x = W / 2 - paddle.w / 2;
    balls.length = 0; particles.length = 0; popups.length = 0; powerups.length = 0;
    spawnBall(true);
    buildLevel(level);
    updateHud();
    hideOverlay();
    state = STATE.PLAY;
  }

  function nextLevel() {
    level++;
    paddle.w = paddle.baseW;
    paddle.x = W / 2 - paddle.w / 2;
    balls.length = 0; powerups.length = 0;
    spawnBall(true);
    buildLevel(level);
    updateHud();
    state = STATE.PLAY;
    sfx.win();
  }

  function loseLife() {
    lives--;
    combo = 0;
    updateHud();
    sfx.lose();
    if (lives <= 0) {
      state = STATE.GAMEOVER;
      showOverlay('over');
    } else {
      paddle.w = paddle.baseW;
      paddle.x = W / 2 - paddle.w / 2;
      balls.length = 0;
      spawnBall(true);
    }
  }

  function updateHud() {
    ui.score.textContent = score.toString().padStart(5, '0');
    ui.level.textContent = level;
    ui.lives.textContent = '♥'.repeat(Math.max(0, lives)) || '·';
  }

  function showOverlay(kind) {
    const card = ui.overlay.querySelector('.overlay-card');
    if (kind === 'paused') {
      card.innerHTML = `
        <h1 class="title"><span class="t1">DURAKLA</span><span class="t2">TILDI</span></h1>
        <p class="subtitle">Devam etmek için P'ye bas</p>
        <button id="resumeBtn" class="btn-primary">DEVAM ET</button>`;
      document.getElementById('resumeBtn').onclick = () => togglePause();
    } else if (kind === 'over') {
      card.innerHTML = `
        <h1 class="title"><span class="t1">OYUN</span><span class="t2">BİTTİ</span></h1>
        <p class="subtitle">Skorun: ${score}</p>
        <button id="restartBtn" class="btn-primary">TEKRAR OYNA</button>`;
      document.getElementById('restartBtn').onclick = () => startGame();
    } else if (kind === 'win') {
      card.innerHTML = `
        <h1 class="title"><span class="t1">SEVİYE</span><span class="t2">TAMAM</span></h1>
        <p class="subtitle">Skor: ${score} · Sıradaki seviye ${level + 1}</p>
        <button id="nextBtn" class="btn-primary">DEVAM</button>`;
      document.getElementById('nextBtn').onclick = () => { hideOverlay(); nextLevel(); };
    }
    ui.overlay.classList.add('show');
  }
  function hideOverlay() { ui.overlay.classList.remove('show'); }

  // ---------------------- PARTICLES ----------------------------
  function spawnBurst(x, y, palette, count = 14) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 1 + Math.random() * 5;
      particles.push({
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - 1,
        life: 0,
        maxLife: 30 + Math.random() * 20,
        size: 2 + Math.random() * 3,
        color: Math.random() < 0.5 ? palette.light : palette.base,
        glow: palette.glow,
      });
    }
  }
  function spawnPopup(x, y, text, color = '#ffffff') {
    popups.push({ x, y, text, color, life: 0, maxLife: 50 });
  }

  // ---------------------- POWER-UPS ----------------------------
  const POWER_TYPES = ['wide', 'multi', 'slow', 'life'];
  const POWER_COLORS = {
    wide:  { base:'#16b7ff', light:'#7ef1ff', glow:'rgba(22,183,255,0.7)' },
    multi: { base:'#ff3ec9', light:'#ffb1f1', glow:'rgba(255,62,201,0.7)' },
    slow:  { base:'#7a4dff', light:'#bda0ff', glow:'rgba(122,77,255,0.7)' },
    life:  { base:'#ff3a55', light:'#ff9aa5', glow:'rgba(255,58,85,0.7)' },
  };
  function maybeDropPower(x, y) {
    if (Math.random() < 0.16) {
      const type = POWER_TYPES[Math.floor(Math.random() * POWER_TYPES.length)];
      powerups.push({ x, y, type, vy: 2.4, w: 30, h: 30, rot: 0 });
    }
  }
  function applyPower(type) {
    sfx.power();
    if (type === 'wide') {
      paddle.w = Math.min(220, paddle.baseW * 1.6);
      paddle.expiresAt = performance.now() + 12000;
      spawnPopup(paddle.x + paddle.w / 2, paddle.y - 18, 'GENİŞ RAKET', '#7ef1ff');
    } else if (type === 'multi') {
      const sources = balls.filter(b => !b.stuck).slice(0, 1);
      const src = sources[0] || balls[0];
      if (src) {
        for (let i = 0; i < 2; i++) {
          const angle = Math.atan2(src.vy, src.vx) + (i ? 0.35 : -0.35);
          balls.push({
            x: src.x, y: src.y, r: src.r,
            vx: Math.cos(angle) * src.speed,
            vy: Math.sin(angle) * src.speed,
            stuck: false, trail: [], speed: src.speed, slowUntil: 0,
          });
        }
      }
      spawnPopup(paddle.x + paddle.w / 2, paddle.y - 18, 'ÇOKLU TOP', '#ffb1f1');
    } else if (type === 'slow') {
      const until = performance.now() + 8000;
      for (const b of balls) {
        b.slowUntil = until;
        const sp = Math.hypot(b.vx, b.vy);
        const ns = Math.max(4, sp * 0.6);
        const a = Math.atan2(b.vy, b.vx);
        b.vx = Math.cos(a) * ns;
        b.vy = Math.sin(a) * ns;
      }
      spawnPopup(paddle.x + paddle.w / 2, paddle.y - 18, 'YAVAŞ TOP', '#bda0ff');
    } else if (type === 'life') {
      lives = Math.min(9, lives + 1);
      updateHud();
      spawnPopup(paddle.x + paddle.w / 2, paddle.y - 18, '+1 CAN', '#ff9aa5');
    }
  }

  // ---------------------- UPDATE -------------------------------
  function update() {
    if (state !== STATE.PLAY) return;

    // Combo timer decay
    if (comboTimer > 0) comboTimer--;
    else combo = 0;

    // Power-up expirations
    if (paddle.expiresAt && performance.now() > paddle.expiresAt) {
      paddle.w = paddle.baseW;
      paddle.expiresAt = 0;
    }

    // Paddle keyboard
    if (keys.left)  paddle.x -= paddle.speed;
    if (keys.right) paddle.x += paddle.speed;
    paddle.x = Math.max(0, Math.min(W - paddle.w, paddle.x));

    // Balls
    for (let i = balls.length - 1; i >= 0; i--) {
      const b = balls[i];
      if (b.stuck) {
        b.x = paddle.x + paddle.w / 2;
        b.y = paddle.y - b.r - 4;
      } else {
        // Slow expiration
        if (b.slowUntil && performance.now() > b.slowUntil) {
          b.slowUntil = 0;
          const a = Math.atan2(b.vy, b.vx);
          b.vx = Math.cos(a) * b.speed;
          b.vy = Math.sin(a) * b.speed;
        }
        b.x += b.vx;
        b.y += b.vy;

        // Trail
        b.trail.push({ x: b.x, y: b.y });
        if (b.trail.length > 12) b.trail.shift();

        // Walls
        if (b.x - b.r < 0)  { b.x = b.r; b.vx *= -1; sfx.wall(); }
        if (b.x + b.r > W)  { b.x = W - b.r; b.vx *= -1; sfx.wall(); }
        if (b.y - b.r < 0)  { b.y = b.r; b.vy *= -1; sfx.wall(); }

        // Paddle collision
        if (b.vy > 0 && b.y + b.r >= paddle.y && b.y - b.r <= paddle.y + paddle.h &&
            b.x >= paddle.x - b.r && b.x <= paddle.x + paddle.w + b.r) {
          b.y = paddle.y - b.r - 0.1;
          const t = (b.x - (paddle.x + paddle.w / 2)) / (paddle.w / 2);
          const angle = (-Math.PI / 2) + t * (Math.PI / 3);
          const sp = Math.max(b.speed, Math.hypot(b.vx, b.vy));
          b.vx = Math.cos(angle) * sp;
          b.vy = Math.sin(angle) * sp;
          sfx.paddle();
          combo = 0;
        }

        // Fall out
        if (b.y - b.r > H) {
          balls.splice(i, 1);
          continue;
        }

        // Bricks
        for (const br of bricks) {
          if (!br.alive) continue;
          if (b.x + b.r > br.x && b.x - b.r < br.x + br.w &&
              b.y + b.r > br.y && b.y - b.r < br.y + br.h) {
            // Resolve side
            const prevX = b.x - b.vx;
            const prevY = b.y - b.vy;
            const fromLeft  = prevX + b.r <= br.x;
            const fromRight = prevX - b.r >= br.x + br.w;
            const fromTop   = prevY + b.r <= br.y;
            const fromBot   = prevY - b.r >= br.y + br.h;
            if (fromLeft || fromRight) b.vx *= -1;
            else if (fromTop || fromBot) b.vy *= -1;
            else b.vy *= -1;

            br.hp--;
            br.hit = 8;
            sfx.brick();
            combo++;
            comboTimer = 90;
            const gain = 10 * Math.max(1, Math.floor(combo / 3) + 1);
            score += gain;
            updateHud();

            if (br.hp <= 0) {
              br.alive = false;
              spawnBurst(br.x + br.w / 2, br.y + br.h / 2, br.palette, 18);
              spawnPopup(br.x + br.w / 2, br.y, `+${gain}`, br.palette.light);
              maybeDropPower(br.x + br.w / 2, br.y + br.h / 2);
            } else {
              spawnBurst(br.x + br.w / 2, br.y + br.h / 2, br.palette, 5);
            }
            break;
          }
        }
      }
    }

    // Ensure at least one ball
    if (balls.length === 0) loseLife();

    // Level complete?
    if (bricks.length && bricks.every(b => !b.alive)) {
      state = STATE.WIN;
      showOverlay('win');
    }

    // Particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life++;
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.18;
      p.vx *= 0.99;
      if (p.life >= p.maxLife) particles.splice(i, 1);
    }
    // Popups
    for (let i = popups.length - 1; i >= 0; i--) {
      const p = popups[i];
      p.life++;
      p.y -= 0.6;
      if (p.life >= p.maxLife) popups.splice(i, 1);
    }
    // Power-ups
    for (let i = powerups.length - 1; i >= 0; i--) {
      const p = powerups[i];
      p.y += p.vy;
      p.rot += 0.05;
      if (p.y > H + 20) { powerups.splice(i, 1); continue; }
      if (p.y + p.h > paddle.y && p.y < paddle.y + paddle.h &&
          p.x + p.w / 2 > paddle.x && p.x - p.w / 2 < paddle.x + paddle.w) {
        applyPower(p.type);
        powerups.splice(i, 1);
      }
    }
  }

  // ---------------------- RENDER -------------------------------
  function drawBackground() {
    // Animated grid floor (depth illusion)
    const t = performance.now() / 1000;
    ctx.save();
    ctx.globalAlpha = 0.18;

    // Horizon glow
    const grd = ctx.createLinearGradient(0, H * 0.55, 0, H);
    grd.addColorStop(0, 'rgba(34,140,255,0.0)');
    grd.addColorStop(0.5, 'rgba(34,140,255,0.18)');
    grd.addColorStop(1, 'rgba(255,62,201,0.22)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, H * 0.5, W, H * 0.5);

    // Perspective grid lines
    ctx.strokeStyle = 'rgba(120,180,255,0.35)';
    ctx.lineWidth = 1;
    const horizon = H * 0.55;
    // Vertical lines converging to vanishing point
    for (let i = -10; i <= 10; i++) {
      ctx.beginPath();
      const px = W / 2 + i * (W / 12);
      ctx.moveTo(W / 2, horizon);
      ctx.lineTo(px, H);
      ctx.stroke();
    }
    // Horizontal lines moving toward viewer
    const speed = (t * 0.5) % 1;
    for (let i = 0; i < 14; i++) {
      const k = (i + speed) / 14;
      const y = horizon + (H - horizon) * (k * k);
      ctx.globalAlpha = 0.22 * (1 - k * 0.6);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }

    ctx.restore();

    // Vignette
    const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
  }

  function drawBrick(b) {
    const x = b.x, y = b.y, w = b.w, h = b.h;
    const hitOffset = b.hit > 0 ? -b.hit * 0.3 : 0;
    const p = b.palette;
    const alpha = b.hp < b.maxHp ? 0.85 : 1;

    ctx.save();
    ctx.globalAlpha = alpha;

    // Drop shadow (pseudo 3D depth)
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(x + 2, y + 4 + hitOffset, w, h);

    // Body gradient
    const grd = ctx.createLinearGradient(0, y + hitOffset, 0, y + h + hitOffset);
    grd.addColorStop(0, p.light);
    grd.addColorStop(0.5, p.base);
    grd.addColorStop(1, p.dark);
    ctx.fillStyle = grd;
    roundRect(ctx, x, y + hitOffset, w, h, 5);
    ctx.fill();

    // Top highlight strip (bevel)
    const hgrd = ctx.createLinearGradient(0, y + hitOffset, 0, y + h * 0.45 + hitOffset);
    hgrd.addColorStop(0, 'rgba(255,255,255,0.55)');
    hgrd.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = hgrd;
    roundRect(ctx, x + 1, y + 1 + hitOffset, w - 2, h * 0.45, 4);
    ctx.fill();

    // Bottom dark edge (bevel)
    const bgrd = ctx.createLinearGradient(0, y + h * 0.5 + hitOffset, 0, y + h + hitOffset);
    bgrd.addColorStop(0, 'rgba(0,0,0,0)');
    bgrd.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = bgrd;
    roundRect(ctx, x + 1, y + h * 0.5 + hitOffset, w - 2, h * 0.5 - 1, 4);
    ctx.fill();

    // Left highlight
    const lgrd = ctx.createLinearGradient(x, 0, x + w * 0.2, 0);
    lgrd.addColorStop(0, 'rgba(255,255,255,0.3)');
    lgrd.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = lgrd;
    roundRect(ctx, x + 1, y + 1 + hitOffset, w * 0.2, h - 2, 4);
    ctx.fill();

    // Glow on hit
    if (b.hit > 0) {
      ctx.shadowColor = p.glow;
      ctx.shadowBlur = 16;
      ctx.strokeStyle = p.light;
      ctx.lineWidth = 1.4;
      roundRect(ctx, x + 0.5, y + 0.5 + hitOffset, w - 1, h - 1, 5);
      ctx.stroke();
      b.hit--;
    }

    // HP indicator dots
    if (b.maxHp > 1) {
      const dots = b.hp;
      const dotR = 2;
      const startX = x + w / 2 - ((dots - 1) * 7) / 2;
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      for (let i = 0; i < dots; i++) {
        ctx.beginPath();
        ctx.arc(startX + i * 7, y + h / 2 + hitOffset, dotR, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
  }

  function drawPaddle() {
    const x = paddle.x, y = paddle.y, w = paddle.w, h = paddle.h;

    ctx.save();
    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    roundRect(ctx, x + 3, y + 6, w, h, 9);
    ctx.fill();

    // Outer glow
    ctx.shadowColor = 'rgba(56,232,255,0.7)';
    ctx.shadowBlur = 24;
    ctx.fillStyle = 'rgba(56,232,255,0.1)';
    roundRect(ctx, x, y, w, h, 9);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Body
    const grd = ctx.createLinearGradient(0, y, 0, y + h);
    grd.addColorStop(0, '#aef3ff');
    grd.addColorStop(0.4, '#38c8ff');
    grd.addColorStop(0.6, '#1e7fff');
    grd.addColorStop(1, '#0d3aa0');
    ctx.fillStyle = grd;
    roundRect(ctx, x, y, w, h, 9);
    ctx.fill();

    // Top gloss
    const tg = ctx.createLinearGradient(0, y, 0, y + h * 0.5);
    tg.addColorStop(0, 'rgba(255,255,255,0.85)');
    tg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = tg;
    roundRect(ctx, x + 2, y + 1, w - 4, h * 0.45, 7);
    ctx.fill();

    // Bottom dark edge
    const bg = ctx.createLinearGradient(0, y + h * 0.55, 0, y + h);
    bg.addColorStop(0, 'rgba(0,0,0,0)');
    bg.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = bg;
    roundRect(ctx, x + 2, y + h * 0.55, w - 4, h * 0.4, 7);
    ctx.fill();

    // Center accent line
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fillRect(x + w / 2 - 1, y + 3, 2, h - 6);

    ctx.restore();
  }

  function drawBall(b) {
    // Trail
    for (let i = 0; i < b.trail.length; i++) {
      const t = b.trail[i];
      const a = i / b.trail.length;
      ctx.save();
      ctx.globalAlpha = a * 0.5;
      ctx.fillStyle = b.slowUntil ? '#bda0ff' : '#7ef1ff';
      ctx.beginPath();
      ctx.arc(t.x, t.y, b.r * (0.4 + a * 0.6), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Glow
    ctx.save();
    ctx.shadowColor = b.slowUntil ? 'rgba(138,92,255,0.8)' : 'rgba(56,232,255,0.85)';
    ctx.shadowBlur = 28;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Ball body with 3D look
    const grd = ctx.createRadialGradient(b.x - b.r * 0.4, b.y - b.r * 0.4, 1, b.x, b.y, b.r);
    grd.addColorStop(0, '#ffffff');
    grd.addColorStop(0.4, b.slowUntil ? '#cdb8ff' : '#aef3ff');
    grd.addColorStop(1, b.slowUntil ? '#5b32d6' : '#0d6db8');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fill();

    // Highlight
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.arc(b.x - b.r * 0.35, b.y - b.r * 0.35, b.r * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawParticles() {
    for (const p of particles) {
      const a = 1 - p.life / p.maxLife;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.shadowColor = p.glow;
      ctx.shadowBlur = 10;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      ctx.restore();
    }
  }

  function drawPopups() {
    for (const p of popups) {
      const a = 1 - p.life / p.maxLife;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.font = 'bold 18px Segoe UI, sans-serif';
      ctx.textAlign = 'center';
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 12;
      ctx.fillText(p.text, p.x, p.y);
      ctx.restore();
    }
  }

  function drawPowerups() {
    for (const p of powerups) {
      const c = POWER_COLORS[p.type];
      const cx = p.x, cy = p.y;
      const s = p.w;

      ctx.save();
      // Shadow
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      roundRect(ctx, cx - s / 2 + 2, cy - s / 2 + 4, s, s, 7);
      ctx.fill();

      // Glow
      ctx.shadowColor = c.glow;
      ctx.shadowBlur = 22;

      // Body
      const grd = ctx.createLinearGradient(0, cy - s / 2, 0, cy + s / 2);
      grd.addColorStop(0, c.light);
      grd.addColorStop(1, c.base);
      ctx.fillStyle = grd;
      roundRect(ctx, cx - s / 2, cy - s / 2, s, s, 7);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Bevel highlight
      const tg = ctx.createLinearGradient(0, cy - s / 2, 0, cy);
      tg.addColorStop(0, 'rgba(255,255,255,0.7)');
      tg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = tg;
      roundRect(ctx, cx - s / 2 + 1, cy - s / 2 + 1, s - 2, s / 2, 6);
      ctx.fill();

      // Icon
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 14px Segoe UI, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = 4;
      const labels = { wide: 'W', multi: '×3', slow: 'S', life: '♥' };
      ctx.fillText(labels[p.type], cx, cy + 1);
      ctx.restore();
    }
  }

  function drawComboHud() {
    if (combo > 2) {
      ctx.save();
      ctx.font = 'bold 28px Segoe UI, sans-serif';
      ctx.textAlign = 'center';
      ctx.shadowColor = 'rgba(255,216,107,0.8)';
      ctx.shadowBlur = 20;
      ctx.fillStyle = '#ffd86b';
      ctx.fillText(`COMBO ×${combo}`, W / 2, 40);
      ctx.restore();
    }
  }

  function render() {
    ctx.clearRect(0, 0, W, H);
    drawBackground();

    for (const b of bricks) if (b.alive) drawBrick(b);

    drawPaddle();
    drawPowerups();
    for (const b of balls) drawBall(b);
    drawParticles();
    drawPopups();
    drawComboHud();
  }

  function roundRect(ctx, x, y, w, h, r) {
    if (w < 2 * r) r = w / 2;
    if (h < 2 * r) r = h / 2;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ---------------------- LOOP ---------------------------------
  function loop() {
    update();
    render();
    requestAnimationFrame(loop);
  }

  // Boot
  updateHud();
  loop();
})();
