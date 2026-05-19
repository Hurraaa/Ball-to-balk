// =============================================================
//  NEON BREAKER — Premium pseudo-3D brick breaker (mobile-first)
// =============================================================
(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  // Logical coordinate system (portrait, phone-friendly)
  const W = 480;
  const H = 800;

  // High-DPI: backing store scaled by devicePixelRatio for crisp rendering.
  function setupHiDPI() {
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  setupHiDPI();
  window.addEventListener('resize', setupHiDPI);
  window.addEventListener('orientationchange', setupHiDPI);

  const ui = {
    score: document.getElementById('score'),
    level: document.getElementById('level'),
    lives: document.getElementById('lives'),
    overlay: document.getElementById('overlay'),
    startBtn: document.getElementById('startBtn'),
    pauseBtn: document.getElementById('pauseBtn'),
    levelGrid: document.getElementById('levelGrid'),
  };

  // ---------------------- AUDIO (procedural) -------------------
  let audioCtx = null;
  function ensureAudio() {
    if (!audioCtx) {
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch { audioCtx = null; }
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
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

  function haptic(ms = 8) {
    if (navigator.vibrate) navigator.vibrate(ms);
  }

  // ---------------------- STATE --------------------------------
  const STATE = { MENU: 'menu', PLAY: 'play', PAUSED: 'paused', GAMEOVER: 'over', WIN: 'win' };
  let state = STATE.MENU;

  let score = 0;
  let level = 1;
  let lives = 3;
  let combo = 0;
  let comboTimer = 0;

  // Paddle (portrait: smaller)
  const paddle = {
    w: 95, h: 14, x: W / 2 - 47.5, y: H - 70,
    speed: 10, baseW: 95, expiresAt: 0,
  };

  // Balls
  const balls = [];
  function spawnBall(stuck = true) {
    balls.push({
      x: paddle.x + paddle.w / 2,
      y: paddle.y - 12,
      vx: 0, vy: 0,
      r: 8,
      stuck,
      stuckAt: performance.now(),
      trail: [],
      speed: 7.5 + Math.min((level - 1) * 0.25, 2.0),
      slowUntil: 0,
      fastUntil: 0,
    });
  }

  // Bricks — portrait layout
  let bricks = [];
  const BRICK_ROWS_MAX = 10;
  const BRICK_COLS = 7;
  const BRICK_PAD = 5;
  const BRICK_TOP = 70;
  const BRICK_SIDE = 20;
  const BRICK_W = (W - BRICK_SIDE * 2 - BRICK_PAD * (BRICK_COLS - 1)) / BRICK_COLS;
  const BRICK_H = 24;

  // Particles
  const particles = [];
  // Floating score popups
  const popups = [];
  // Power-ups falling
  const powerups = [];

  // Keys
  const keys = { left: false, right: false };

  // ---------------------- LEVELS -------------------------------
  const PALETTES = [
    { base:'#ff3ec9', light:'#ffa6e8', dark:'#a3007a', glow:'rgba(255,62,201,0.55)' },
    { base:'#ff6b3e', light:'#ffc29a', dark:'#a73a13', glow:'rgba(255,107,62,0.55)' },
    { base:'#ffd86b', light:'#fff3b8', dark:'#a87f00', glow:'rgba(255,216,107,0.55)' },
    { base:'#5cff8a', light:'#bdffc8', dark:'#1f8a3f', glow:'rgba(92,255,138,0.55)' },
    { base:'#22e3ff', light:'#b6f4ff', dark:'#0f7a99', glow:'rgba(34,227,255,0.55)' },
    { base:'#8a5cff', light:'#cdb8ff', dark:'#3c1f99', glow:'rgba(138,92,255,0.55)' },
    { base:'#ff5577', light:'#ffb6c5', dark:'#a01a36', glow:'rgba(255,85,119,0.55)' },
    { base:'#9bb0ff', light:'#d6dfff', dark:'#3a4ea0', glow:'rgba(155,176,255,0.55)' },
  ];

  const STEEL_PALETTE = { base:'#7a8294', light:'#d6dce8', dark:'#2c3242', glow:'rgba(200,215,240,0.4)' };

  // Pattern karakterleri: '.' boş · '1','2','3' = HP · 'S' = çelik (kırılmaz)
  // 7 sütun genişliğinde, en fazla 10 sıra.
  const LEVELS = [
    // L1 — "GİRİŞ" (warm-up)
    ['1111111',
     '1111111'],
    // L2 — "DUVAR"
    ['1111111',
     '1111111',
     '1111111'],
    // L3 — "TAÇ" (ilk 2-HP)
    ['2222222',
     '1111111',
     '1111111',
     '1111111'],
    // L4 — "NOKTALAR" (ilk boşluklar)
    ['2.2.2.2',
     '1111111',
     '1.1.1.1',
     '1111111',
     '2.2.2.2'],
    // L5 — "KÜÇÜK KALE" (ilk mini-boss)
    ['2222222',
     '2.....2',
     '2.121.2',
     '2.....2',
     '2222222'],
    // L6 — "BANTLAR"
    ['1111111',
     '2222222',
     '1111111',
     '2222222',
     '1111111',
     '1111111'],
    // L7 — "ELMAS"
    ['...2...',
     '..212..',
     '.12321.',
     '1232321',
     '.12321.',
     '..212..',
     '...2...'],
    // L8 — "ÇELİK GİRİŞ" (ilk steel)
    ['S11111S',
     '1.....1',
     '1.212.1',
     '1.121.1',
     '1.212.1',
     '1.....1',
     'S22222S'],
    // L9 — "DAMA"
    ['1.2.2.1',
     '.232.2.',
     '2.323.2',
     '.S.3.S.',
     '2.323.2',
     '.2.232.',
     '1.2.2.1'],
    // L10 — "ÇELİK KAFES" (mid boss)
    ['SS222SS',
     'S.222.S',
     '.21312.',
     '2233322',
     '.21312.',
     'S.222.S',
     'SS222SS'],
    // L11 — "PORTAL"
    ['SSS.SSS',
     '2.....2',
     '2.222.2',
     '2.323.2',
     '2.222.2',
     '2.....2',
     'SSS.SSS',
     '2222222'],
    // L12 — "GAUNTLET"
    ['2.S.S.2',
     '2.3.3.2',
     '.32.23.',
     '2.323.2',
     '.32.23.',
     '2.3.3.2',
     '2.S.S.2'],
    // L13 — "ZIRH"
    ['2.3.3.2',
     '2.3.3.2',
     'SSS.SSS',
     '.21312.',
     '2233322',
     '.21312.',
     'SSS.SSS',
     '1111111'],
    // L14 — "TAPINAK"
    ['SS3.3SS',
     '333.333',
     'S.232.S',
     '.32323.',
     'S.232.S',
     '333.333',
     'SS3.3SS',
     '.......',
     '2222222'],
    // L15 — "FİNAL"
    ['SS3S3SS',
     '3323233',
     'S33233S',
     '3322233',
     '33S3S33',
     '3322233',
     'S33233S',
     '3323233',
     'SS3S3SS'],
  ];

  const LEVEL_NAMES = [
    'GİRİŞ','DUVAR','TAÇ','NOKTALAR','KÜÇÜK KALE',
    'BANTLAR','ELMAS','ÇELİK GİRİŞ','DAMA','ÇELİK KAFES',
    'PORTAL','GAUNTLET','ZIRH','TAPINAK','FİNAL',
  ];

  function levelName(lv) {
    if (lv <= LEVEL_NAMES.length) return LEVEL_NAMES[lv - 1];
    return `USTA ${lv - LEVEL_NAMES.length}`;
  }

  function buildLevel(lv) {
    bricks = [];
    const idx = (lv - 1) % LEVELS.length;
    const pattern = LEVELS[idx];

    for (let r = 0; r < pattern.length; r++) {
      const line = pattern[r];
      for (let c = 0; c < BRICK_COLS; c++) {
        const ch = line[c];
        if (!ch || ch === '.' || ch === ' ') continue;

        let hp = 1, steel = false;
        if (ch === 'S' || ch === 's') { hp = 9999; steel = true; }
        else { hp = parseInt(ch, 10); if (!hp || hp < 1) continue; }

        const palette = steel ? STEEL_PALETTE : PALETTES[r % PALETTES.length];
        const x = BRICK_SIDE + c * (BRICK_W + BRICK_PAD);
        const y = BRICK_TOP + r * (BRICK_H + BRICK_PAD);
        bricks.push({
          x, y, w: BRICK_W, h: BRICK_H,
          hp, maxHp: hp, palette, hit: 0, alive: true, steel,
        });
      }
    }
  }

  // ---------------------- INPUT --------------------------------
  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft')  keys.left = true;
    if (e.key === 'ArrowRight') keys.right = true;
    if (e.code === 'Space') { e.preventDefault(); releaseStuck(); }
    if (e.key === 'p' || e.key === 'P') togglePause();
  });
  document.addEventListener('keyup', (e) => {
    if (e.key === 'ArrowLeft')  keys.left = false;
    if (e.key === 'ArrowRight') keys.right = false;
  });

  function pointerToLogicalX(clientX) {
    const rect = canvas.getBoundingClientRect();
    return (clientX - rect.left) * (W / rect.width);
  }

  canvas.addEventListener('mousemove', (e) => {
    if (state !== STATE.PLAY) return;
    const mx = pointerToLogicalX(e.clientX);
    paddle.x = Math.max(0, Math.min(W - paddle.w, mx - paddle.w / 2));
  });
  canvas.addEventListener('click', () => releaseStuck());

  // Touch: drag paddle anywhere on canvas, tap releases the ball
  let touchStartX = 0, touchStartTime = 0;
  canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (state !== STATE.PLAY) return;
    const t = e.touches[0];
    touchStartX = t.clientX;
    touchStartTime = performance.now();
    const mx = pointerToLogicalX(t.clientX);
    paddle.x = Math.max(0, Math.min(W - paddle.w, mx - paddle.w / 2));
  }, { passive: false });
  canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (state !== STATE.PLAY) return;
    const t = e.touches[0];
    const mx = pointerToLogicalX(t.clientX);
    paddle.x = Math.max(0, Math.min(W - paddle.w, mx - paddle.w / 2));
  }, { passive: false });
  canvas.addEventListener('touchend', (e) => {
    e.preventDefault();
    if (state !== STATE.PLAY) return;
    // Quick tap = release
    const dt = performance.now() - touchStartTime;
    const dx = Math.abs((e.changedTouches[0]?.clientX || touchStartX) - touchStartX);
    if (dt < 300 && dx < 12) releaseStuck();
  }, { passive: false });

  // Ana menü HTML'sini sakla — game over sonrası geri dönerken kullanırız.
  const MENU_HTML = ui.overlay.querySelector('.overlay-card').innerHTML;

  function buildLevelGrid() {
    const grid = document.getElementById('levelGrid');
    if (!grid) return;
    grid.innerHTML = '';
    for (let i = 1; i <= LEVELS.length; i++) {
      const btn = document.createElement('button');
      btn.className = 'level-btn';
      btn.innerHTML = `<span class="lvl-num">${i}</span><span class="lvl-name">${levelName(i)}</span>`;
      btn.addEventListener('click', () => { ensureAudio(); startGame(i); });
      grid.appendChild(btn);
    }
  }

  function wireMenu() {
    const sb = document.getElementById('startBtn');
    if (sb) sb.addEventListener('click', () => { ensureAudio(); startGame(1); });
    buildLevelGrid();
  }

  function showMenu() {
    // Önceki oyunun kalıntılarını temizle
    balls.length = 0;
    particles.length = 0;
    popups.length = 0;
    powerups.length = 0;
    bricks = [];
    combo = 0;

    const card = ui.overlay.querySelector('.overlay-card');
    card.innerHTML = MENU_HTML;
    wireMenu();
    ui.overlay.classList.add('show');
    state = STATE.MENU;
  }

  wireMenu();
  ui.pauseBtn.addEventListener('click', (e) => { e.stopPropagation(); ensureAudio(); togglePause(); });
  ui.pauseBtn.addEventListener('touchstart', (e) => {
    e.stopPropagation(); e.preventDefault();
    ensureAudio(); togglePause();
  }, { passive: false });

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
  function startGame(startLevel = 1) {
    score = 0; level = startLevel; lives = 3; combo = 0;
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
    haptic(60);
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
        <p class="subtitle">${level}. ${levelName(level)}</p>
        <button id="resumeBtn" class="btn-primary">DEVAM ET</button>
        <button id="menuBtn" class="btn-secondary">MENÜYE DÖN</button>`;
      document.getElementById('resumeBtn').onclick = () => togglePause();
      document.getElementById('menuBtn').onclick = () => { state = STATE.MENU; showMenu(); };
    } else if (kind === 'over') {
      card.innerHTML = `
        <h1 class="title"><span class="t1">OYUN</span><span class="t2">BİTTİ</span></h1>
        <p class="subtitle">${levelName(level)} · Skor: ${score}</p>
        <button id="restartBtn" class="btn-primary">TEKRAR OYNA</button>
        <button id="menuBtn" class="btn-secondary">MENÜYE DÖN</button>`;
      document.getElementById('restartBtn').onclick = () => startGame(level);
      document.getElementById('menuBtn').onclick = () => showMenu();
    } else if (kind === 'win') {
      const finishedName = levelName(level);
      const nextName = levelName(level + 1);
      card.innerHTML = `
        <h1 class="title"><span class="t1">BÖLÜM</span><span class="t2">${level} ✓</span></h1>
        <p class="subtitle">${finishedName} — Skor: ${score}</p>
        <p class="next-up">Sıradaki: <b>${level + 1}. ${nextName}</b></p>
        <button id="nextBtn" class="btn-primary">DEVAM</button>`;
      document.getElementById('nextBtn').onclick = () => { hideOverlay(); nextLevel(); };
      // 1.2 sn sonra otomatik geç — beklemek yok.
      setTimeout(() => {
        if (state === STATE.WIN) { hideOverlay(); nextLevel(); }
      }, 1200);
    }
    ui.overlay.classList.add('show');
  }
  function hideOverlay() { ui.overlay.classList.remove('show'); }

  // ---------------------- PARTICLES ----------------------------
  function spawnBurst(x, y, palette, count = 14) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 1 + Math.random() * 4;
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
  const NEGATIVE_TYPES = new Set(['narrow', 'fast']);
  const POWER_COLORS = {
    wide:   { base:'#16b7ff', light:'#7ef1ff', glow:'rgba(22,183,255,0.7)' },
    multi:  { base:'#ff3ec9', light:'#ffb1f1', glow:'rgba(255,62,201,0.7)' },
    slow:   { base:'#7a4dff', light:'#bda0ff', glow:'rgba(122,77,255,0.7)' },
    life:   { base:'#ff3a55', light:'#ff9aa5', glow:'rgba(255,58,85,0.7)' },
    narrow: { base:'#c41a3a', light:'#ff7a8e', glow:'rgba(255,40,70,0.85)' },
    fast:   { base:'#d04a00', light:'#ffb070', glow:'rgba(255,120,30,0.85)' },
  };
  // Her bölüm için düşme oranı + havuzu. "Başarma hissi" eğrisi:
  // - Erken bölümler bol pozitif; zor bölümlerde dengelenir
  // - Multi-ball pool'dan asla çıkmaz: oyuncu daima toparlanabilir
  // - Power-down'lar L5'ten itibaren girer, asla baskın değil
  function dropConfig(lv) {
    const T = {
      1:  { chance: 1.00, pool: ['multi'] },
      2:  { chance: 0.85, pool: ['multi','multi','multi','wide','life'] },
      3:  { chance: 0.75, pool: ['multi','multi','wide','wide','slow','life'] },
      4:  { chance: 0.70, pool: ['multi','multi','wide','wide','slow','life','narrow'] },
      5:  { chance: 0.60, pool: ['multi','multi','wide','wide','slow','life','narrow','fast'] },
      6:  { chance: 0.55, pool: ['multi','multi','wide','slow','life','narrow','fast'] },
      7:  { chance: 0.55, pool: ['multi','multi','wide','slow','life','life','narrow','fast'] },
      8:  { chance: 0.50, pool: ['multi','wide','slow','life','life','narrow','fast'] },
      9:  { chance: 0.50, pool: ['multi','multi','wide','slow','life','narrow','narrow','fast'] },
      10: { chance: 0.50, pool: ['multi','multi','wide','wide','slow','life','life','narrow','fast'] },
      11: { chance: 0.45, pool: ['multi','wide','slow','life','narrow','fast'] },
      12: { chance: 0.45, pool: ['multi','multi','wide','slow','life','narrow','narrow','fast','fast'] },
      13: { chance: 0.45, pool: ['multi','wide','slow','life','life','narrow','fast'] },
      14: { chance: 0.45, pool: ['multi','multi','wide','slow','life','narrow','narrow','fast','fast'] },
      15: { chance: 0.50, pool: ['multi','multi','wide','wide','slow','life','life','narrow','fast'] },
    };
    return T[lv] || { chance: 0.45, pool: ['multi','wide','slow','life','narrow','fast'] };
  }

  function maybeDropPower(x, y) {
    const cfg = dropConfig(level);
    let chance = cfg.chance;
    let pool = cfg.pool;

    // Güvenlik ağı: son canda multi-ball şansı katlanır, power-down'lar silinir.
    if (lives <= 1) {
      chance = Math.min(1, chance + 0.25);
      pool = pool.filter(t => !NEGATIVE_TYPES.has(t)).concat(['multi','multi']);
    }

    if (Math.random() >= chance) return;
    const type = pool[Math.floor(Math.random() * pool.length)];
    powerups.push({ x, y, type, vy: 2.2, w: 26, h: 26, negative: NEGATIVE_TYPES.has(type) });
  }
  function applyPower(type) {
    sfx.power();
    haptic(20);
    if (type === 'wide') {
      paddle.w = Math.min(180, paddle.baseW * 1.6);
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
        const ns = Math.max(3.5, sp * 0.6);
        const a = Math.atan2(b.vy, b.vx);
        b.vx = Math.cos(a) * ns;
        b.vy = Math.sin(a) * ns;
      }
      spawnPopup(paddle.x + paddle.w / 2, paddle.y - 18, 'YAVAŞ TOP', '#bda0ff');
    } else if (type === 'life') {
      lives = Math.min(9, lives + 1);
      updateHud();
      spawnPopup(paddle.x + paddle.w / 2, paddle.y - 18, '+1 CAN', '#ff9aa5');
    } else if (type === 'narrow') {
      paddle.w = Math.max(55, paddle.baseW * 0.6);
      paddle.expiresAt = performance.now() + 9000;
      spawnPopup(paddle.x + paddle.w / 2, paddle.y - 18, 'KÜÇÜK RAKET!', '#ff7a8e');
      haptic(40);
    } else if (type === 'fast') {
      const until = performance.now() + 8000;
      for (const b of balls) {
        b.fastUntil = until;
        const a = Math.atan2(b.vy, b.vx);
        const sp = Math.min(13, Math.hypot(b.vx, b.vy) * 1.4);
        b.vx = Math.cos(a) * sp;
        b.vy = Math.sin(a) * sp;
      }
      spawnPopup(paddle.x + paddle.w / 2, paddle.y - 18, 'HIZLI TOP!', '#ffb070');
      haptic(40);
    }
  }

  // ---------------------- UPDATE -------------------------------
  function update() {
    if (state !== STATE.PLAY) return;

    if (comboTimer > 0) comboTimer--;
    else combo = 0;

    if (paddle.expiresAt && performance.now() > paddle.expiresAt) {
      paddle.w = paddle.baseW;
      paddle.expiresAt = 0;
    }

    if (keys.left)  paddle.x -= paddle.speed;
    if (keys.right) paddle.x += paddle.speed;
    paddle.x = Math.max(0, Math.min(W - paddle.w, paddle.x));

    for (let i = balls.length - 1; i >= 0; i--) {
      const b = balls[i];
      if (b.stuck) {
        b.x = paddle.x + paddle.w / 2;
        b.y = paddle.y - b.r - 4;
        // 0.8 sn sonra otomatik fırlat — beklemek yok.
        if (performance.now() - b.stuckAt > 800) {
          const angle = (-Math.PI / 2) + (Math.random() - 0.5) * 0.6;
          b.vx = Math.cos(angle) * b.speed;
          b.vy = Math.sin(angle) * b.speed;
          b.stuck = false;
        }
      } else {
        if (b.slowUntil && performance.now() > b.slowUntil) {
          b.slowUntil = 0;
          const a = Math.atan2(b.vy, b.vx);
          b.vx = Math.cos(a) * b.speed;
          b.vy = Math.sin(a) * b.speed;
        }
        if (b.fastUntil && performance.now() > b.fastUntil) {
          b.fastUntil = 0;
          const a = Math.atan2(b.vy, b.vx);
          b.vx = Math.cos(a) * b.speed;
          b.vy = Math.sin(a) * b.speed;
        }
        b.x += b.vx;
        b.y += b.vy;

        b.trail.push({ x: b.x, y: b.y });
        if (b.trail.length > 10) b.trail.shift();

        if (b.x - b.r < 0)  { b.x = b.r; b.vx *= -1; sfx.wall(); }
        if (b.x + b.r > W)  { b.x = W - b.r; b.vx *= -1; sfx.wall(); }
        if (b.y - b.r < 0)  { b.y = b.r; b.vy *= -1; sfx.wall(); }

        if (b.vy > 0 && b.y + b.r >= paddle.y && b.y - b.r <= paddle.y + paddle.h &&
            b.x >= paddle.x - b.r && b.x <= paddle.x + paddle.w + b.r) {
          b.y = paddle.y - b.r - 0.1;
          const t = (b.x - (paddle.x + paddle.w / 2)) / (paddle.w / 2);
          const angle = (-Math.PI / 2) + t * (Math.PI / 3);
          const sp = Math.max(b.speed, Math.hypot(b.vx, b.vy));
          b.vx = Math.cos(angle) * sp;
          b.vy = Math.sin(angle) * sp;
          sfx.paddle();
          haptic(6);
          combo = 0;
        }

        if (b.y - b.r > H) {
          balls.splice(i, 1);
          continue;
        }

        for (const br of bricks) {
          if (!br.alive) continue;
          if (b.x + b.r > br.x && b.x - b.r < br.x + br.w &&
              b.y + b.r > br.y && b.y - b.r < br.y + br.h) {
            const prevX = b.x - b.vx;
            const prevY = b.y - b.vy;
            const fromLeft  = prevX + b.r <= br.x;
            const fromRight = prevX - b.r >= br.x + br.w;
            const fromTop   = prevY + b.r <= br.y;
            const fromBot   = prevY - b.r >= br.y + br.h;
            if (fromLeft || fromRight) b.vx *= -1;
            else if (fromTop || fromBot) b.vy *= -1;
            else b.vy *= -1;

            if (br.steel) {
              // Çelik: zarar yok, sadece sek + kıvılcım
              br.hit = 6;
              sfx.wall();
              spawnBurst(br.x + br.w / 2, br.y + br.h / 2, br.palette, 4);
              break;
            }

            br.hp--;
            br.hit = 8;
            sfx.brick();
            haptic(4);
            combo++;
            comboTimer = 90;
            const gain = 10 * Math.max(1, Math.floor(combo / 3) + 1);
            score += gain;
            updateHud();

            if (br.hp <= 0) {
              br.alive = false;
              spawnBurst(br.x + br.w / 2, br.y + br.h / 2, br.palette, 16);
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

    if (balls.length === 0) loseLife();

    // Win: tüm kırılabilir tuğlalar gitti mi? (çelik sayılmaz)
    if (bricks.length && bricks.every(b => b.steel || !b.alive)) {
      state = STATE.WIN;
      showOverlay('win');
    }

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life++;
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.18;
      p.vx *= 0.99;
      if (p.life >= p.maxLife) particles.splice(i, 1);
    }
    for (let i = popups.length - 1; i >= 0; i--) {
      const p = popups[i];
      p.life++;
      p.y -= 0.6;
      if (p.life >= p.maxLife) popups.splice(i, 1);
    }
    for (let i = powerups.length - 1; i >= 0; i--) {
      const p = powerups[i];
      p.y += p.vy;
      if (p.y > H + 20) { powerups.splice(i, 1); continue; }
      if (p.y + p.h / 2 > paddle.y && p.y - p.h / 2 < paddle.y + paddle.h &&
          p.x + p.w / 2 > paddle.x && p.x - p.w / 2 < paddle.x + paddle.w) {
        applyPower(p.type);
        powerups.splice(i, 1);
      }
    }
  }

  // ---------------------- RENDER -------------------------------
  function drawBackground() {
    const t = performance.now() / 1000;
    ctx.save();

    // Horizon glow
    const grd = ctx.createLinearGradient(0, H * 0.55, 0, H);
    grd.addColorStop(0, 'rgba(34,140,255,0.0)');
    grd.addColorStop(0.5, 'rgba(34,140,255,0.16)');
    grd.addColorStop(1, 'rgba(255,62,201,0.22)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, H * 0.5, W, H * 0.5);

    // Perspective grid lines converging to horizon
    ctx.strokeStyle = 'rgba(120,180,255,0.32)';
    ctx.lineWidth = 1;
    const horizon = H * 0.55;
    for (let i = -8; i <= 8; i++) {
      ctx.beginPath();
      const px = W / 2 + i * (W / 8);
      ctx.moveTo(W / 2, horizon);
      ctx.lineTo(px, H);
      ctx.stroke();
    }
    const speed = (t * 0.5) % 1;
    for (let i = 0; i < 14; i++) {
      const k = (i + speed) / 14;
      const y = horizon + (H - horizon) * (k * k);
      ctx.globalAlpha = 0.25 * (1 - k * 0.6);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
    ctx.restore();

    const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
  }

  function drawBrick(b) {
    if (b.steel) { drawSteelBrick(b); return; }
    const x = b.x, y = b.y, w = b.w, h = b.h;
    const hitOffset = b.hit > 0 ? -b.hit * 0.3 : 0;
    const p = b.palette;
    const alpha = b.hp < b.maxHp ? 0.88 : 1;

    ctx.save();
    ctx.globalAlpha = alpha;

    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    roundRect(ctx, x + 2, y + 4 + hitOffset, w, h, 5);
    ctx.fill();

    const grd = ctx.createLinearGradient(0, y + hitOffset, 0, y + h + hitOffset);
    grd.addColorStop(0, p.light);
    grd.addColorStop(0.5, p.base);
    grd.addColorStop(1, p.dark);
    ctx.fillStyle = grd;
    roundRect(ctx, x, y + hitOffset, w, h, 5);
    ctx.fill();

    const hgrd = ctx.createLinearGradient(0, y + hitOffset, 0, y + h * 0.45 + hitOffset);
    hgrd.addColorStop(0, 'rgba(255,255,255,0.55)');
    hgrd.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = hgrd;
    roundRect(ctx, x + 1, y + 1 + hitOffset, w - 2, h * 0.45, 4);
    ctx.fill();

    const bgrd = ctx.createLinearGradient(0, y + h * 0.5 + hitOffset, 0, y + h + hitOffset);
    bgrd.addColorStop(0, 'rgba(0,0,0,0)');
    bgrd.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = bgrd;
    roundRect(ctx, x + 1, y + h * 0.5 + hitOffset, w - 2, h * 0.5 - 1, 4);
    ctx.fill();

    const lgrd = ctx.createLinearGradient(x, 0, x + w * 0.2, 0);
    lgrd.addColorStop(0, 'rgba(255,255,255,0.3)');
    lgrd.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = lgrd;
    roundRect(ctx, x + 1, y + 1 + hitOffset, w * 0.2, h - 2, 4);
    ctx.fill();

    if (b.hit > 0) {
      ctx.shadowColor = p.glow;
      ctx.shadowBlur = 16;
      ctx.strokeStyle = p.light;
      ctx.lineWidth = 1.4;
      roundRect(ctx, x + 0.5, y + 0.5 + hitOffset, w - 1, h - 1, 5);
      ctx.stroke();
      b.hit--;
    }

    if (b.maxHp > 1) {
      const dots = b.hp;
      const dotR = 1.8;
      const startX = x + w / 2 - ((dots - 1) * 6) / 2;
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      for (let i = 0; i < dots; i++) {
        ctx.beginPath();
        ctx.arc(startX + i * 6, y + h / 2 + hitOffset, dotR, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawSteelBrick(b) {
    const x = b.x, y = b.y, w = b.w, h = b.h;
    const hitOffset = b.hit > 0 ? -b.hit * 0.3 : 0;
    const p = b.palette;

    ctx.save();
    // Gölge
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    roundRect(ctx, x + 2, y + 4 + hitOffset, w, h, 4);
    ctx.fill();

    // Metalik gövde (yatay bant gradient)
    const grd = ctx.createLinearGradient(0, y + hitOffset, 0, y + h + hitOffset);
    grd.addColorStop(0,    '#c4cad8');
    grd.addColorStop(0.35, '#6e7585');
    grd.addColorStop(0.55, '#4a505f');
    grd.addColorStop(0.75, '#7a8294');
    grd.addColorStop(1,    '#2c3242');
    ctx.fillStyle = grd;
    roundRect(ctx, x, y + hitOffset, w, h, 4);
    ctx.fill();

    // Tepe parlaması
    const hgrd = ctx.createLinearGradient(0, y + hitOffset, 0, y + h * 0.3 + hitOffset);
    hgrd.addColorStop(0, 'rgba(255,255,255,0.7)');
    hgrd.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = hgrd;
    roundRect(ctx, x + 1, y + 1 + hitOffset, w - 2, h * 0.3, 3);
    ctx.fill();

    // Perçinler (4 köşe)
    ctx.fillStyle = 'rgba(20,24,32,0.85)';
    const r = 1.8;
    const px = [x + 4, x + w - 4];
    const py = [y + 4 + hitOffset, y + h - 4 + hitOffset];
    for (const xx of px) for (const yy of py) {
      ctx.beginPath();
      ctx.arc(xx, yy, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // Perçin highlight
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    for (const xx of px) for (const yy of py) {
      ctx.beginPath();
      ctx.arc(xx - 0.4, yy - 0.4, 0.7, 0, Math.PI * 2);
      ctx.fill();
    }

    // Çarpma flash
    if (b.hit > 0) {
      ctx.shadowColor = p.glow;
      ctx.shadowBlur = 14;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.2;
      roundRect(ctx, x + 0.5, y + 0.5 + hitOffset, w - 1, h - 1, 4);
      ctx.stroke();
      b.hit--;
    }
    ctx.restore();
  }

  function drawPaddle() {
    const x = paddle.x, y = paddle.y, w = paddle.w, h = paddle.h;

    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    roundRect(ctx, x + 3, y + 6, w, h, 8);
    ctx.fill();

    ctx.shadowColor = 'rgba(56,232,255,0.7)';
    ctx.shadowBlur = 22;
    ctx.fillStyle = 'rgba(56,232,255,0.1)';
    roundRect(ctx, x, y, w, h, 8);
    ctx.fill();
    ctx.shadowBlur = 0;

    const grd = ctx.createLinearGradient(0, y, 0, y + h);
    grd.addColorStop(0, '#aef3ff');
    grd.addColorStop(0.4, '#38c8ff');
    grd.addColorStop(0.6, '#1e7fff');
    grd.addColorStop(1, '#0d3aa0');
    ctx.fillStyle = grd;
    roundRect(ctx, x, y, w, h, 8);
    ctx.fill();

    const tg = ctx.createLinearGradient(0, y, 0, y + h * 0.5);
    tg.addColorStop(0, 'rgba(255,255,255,0.85)');
    tg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = tg;
    roundRect(ctx, x + 2, y + 1, w - 4, h * 0.45, 6);
    ctx.fill();

    const bg = ctx.createLinearGradient(0, y + h * 0.55, 0, y + h);
    bg.addColorStop(0, 'rgba(0,0,0,0)');
    bg.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = bg;
    roundRect(ctx, x + 2, y + h * 0.55, w - 4, h * 0.4, 6);
    ctx.fill();

    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fillRect(x + w / 2 - 1, y + 3, 2, h - 6);

    ctx.restore();
  }

  function drawBall(b) {
    const trailColor = b.fastUntil ? '#ffb070' : (b.slowUntil ? '#bda0ff' : '#7ef1ff');
    const glowColor  = b.fastUntil ? 'rgba(255,120,30,0.9)' : (b.slowUntil ? 'rgba(138,92,255,0.8)' : 'rgba(56,232,255,0.85)');
    const midColor   = b.fastUntil ? '#ffd2a0' : (b.slowUntil ? '#cdb8ff' : '#aef3ff');
    const darkColor  = b.fastUntil ? '#a02000' : (b.slowUntil ? '#5b32d6' : '#0d6db8');

    for (let i = 0; i < b.trail.length; i++) {
      const t = b.trail[i];
      const a = i / b.trail.length;
      ctx.save();
      ctx.globalAlpha = a * 0.5;
      ctx.fillStyle = trailColor;
      ctx.beginPath();
      ctx.arc(t.x, t.y, b.r * (0.4 + a * 0.6), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.save();
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = b.fastUntil ? 30 : 24;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    const grd = ctx.createRadialGradient(b.x - b.r * 0.4, b.y - b.r * 0.4, 1, b.x, b.y, b.r);
    grd.addColorStop(0, '#ffffff');
    grd.addColorStop(0.4, midColor);
    grd.addColorStop(1, darkColor);
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fill();

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
      ctx.font = 'bold 16px Segoe UI, sans-serif';
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
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      roundRect(ctx, cx - s / 2 + 2, cy - s / 2 + 4, s, s, 6);
      ctx.fill();

      ctx.shadowColor = c.glow;
      ctx.shadowBlur = 18;

      const grd = ctx.createLinearGradient(0, cy - s / 2, 0, cy + s / 2);
      grd.addColorStop(0, c.light);
      grd.addColorStop(1, c.base);
      ctx.fillStyle = grd;
      roundRect(ctx, cx - s / 2, cy - s / 2, s, s, 6);
      ctx.fill();
      ctx.shadowBlur = 0;

      const tg = ctx.createLinearGradient(0, cy - s / 2, 0, cy);
      tg.addColorStop(0, 'rgba(255,255,255,0.7)');
      tg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = tg;
      roundRect(ctx, cx - s / 2 + 1, cy - s / 2 + 1, s - 2, s / 2, 5);
      ctx.fill();

      // Negatif (power-down) için uyarı çerçevesi
      if (p.negative) {
        const pulse = 0.6 + Math.sin(performance.now() / 120) * 0.4;
        ctx.globalAlpha = pulse;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        roundRect(ctx, cx - s / 2 + 1, cy - s / 2 + 1, s - 2, s - 2, 5);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 12px Segoe UI, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = 4;
      const labels = { wide: 'W', multi: '×3', slow: 'S', life: '♥', narrow: '↓W', fast: '⚡' };
      ctx.fillText(labels[p.type], cx, cy + 1);
      ctx.restore();
    }
  }

  function drawComboHud() {
    if (combo > 2) {
      ctx.save();
      ctx.font = 'bold 22px Segoe UI, sans-serif';
      ctx.textAlign = 'center';
      ctx.shadowColor = 'rgba(255,216,107,0.8)';
      ctx.shadowBlur = 18;
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
    drawVersion();
  }

  function drawVersion() {
    ctx.save();
    ctx.fillStyle = 'rgba(180,200,255,0.5)';
    ctx.font = 'bold 10px Segoe UI, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('v9', 8, H - 8);
    ctx.restore();
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

  function loop() {
    update();
    render();
    requestAnimationFrame(loop);
  }

  updateHud();
  loop();
})();
