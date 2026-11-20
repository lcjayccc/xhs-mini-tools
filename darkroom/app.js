/* 暗房冲印店：流程与交互（显影 → 定影 → 开灯 → 出片） */
(function () {
  'use strict';

  var Bridge = window.Bridge, Film = window.Film;
  var $ = function (id) { return document.getElementById(id); };
  var screens = ['intro', 'develop', 'fix', 'result'];

  var BASE_RATE = 0.03;      // 不晃也会慢慢显影：约 33 秒到“刚好”
  var AGITATE_RATE = 0.055;  // 晃得越勤快越快：满速约 12 秒
  var FIX_SECONDS = 4;
  var COUNT_KEY = 'darkroom.count';
  var CARDS_KEY = 'darkroom.cards';
  // 小卡材质，按稀有度从高到低；规则见 docs/tasks/T-03-小卡/映射规则.md
  var MATERIALS = ['prism', 'rainbow', 'sparkle', 'pearl', 'etched', 'chrome'];
  var PRISM_ROLL = 0.29;     // 完美操作下 Prism 约 1/10（35% 无瑕疵 × 0.29）

  var MATERIAL_META = {
    prism:   { name: '棱镜', rarity: '最稀有', code: 'SR', tier: 'prism',   origin: '一点瑕疵都没有的那一张',     clue: '完美显影且无瑕，凭运气遇见' },
    rainbow: { name: '彩虹', rarity: '普通',   code: 'C',  tier: 'common',  origin: '冲得还行的日常卡',           clue: '按部就班冲出一张好照片' },
    sparkle: { name: '闪粉', rarity: '特别款', code: 'SP', tier: 'special', origin: '漏进来的光变成了闪粉',       clue: '碰上暗房漏光，就会出现' },
    pearl:   { name: '珠光', rarity: '特别款', code: 'SP', tier: 'special', origin: '欠显，淡得像一段回忆',       clue: '早一点把相纸捞出来试试' },
    etched:  { name: '蚀刻', rarity: '特别款', code: 'SP', tier: 'special', origin: '过显，黑得只剩轮廓',         clue: '让相纸在显影液里多泡一会儿' },
    chrome:  { name: '银镜', rarity: '特别款', code: 'SP', tier: 'special', origin: '没定影完，相纸上还残留着银', clue: '定影还没做完就开灯看看' }
  };

  var prismTexUrl = '';

  var endFixHold = function () {};
  var state = {
    base: null, aspect: 4 / 3,
    dev: 0, devTime: 0, agiSum: 0, agi: 0, agiTarget: 0,
    raf: 0, lastTs: 0, gyroOn: false, gyroRound: 0, gyroCbs: [],
    fix: 0, fixHolding: false, fixTimer: 0, lastFixSec: 0,
    cardUrl: '', tempPath: '', count: 0, busy: false,
    material: '', collected: [], photo: null, round: 0,
    shotDate: '', isNewMaterial: false,
    lastRippleTs: 0, lastRippleX: 0, lastRippleY: 0
  };

  var cardState = {
    open: false, binderOpen: false,
    flipped: true, revealed: false, revealing: false, revealTimer: 0,
    revealedRound: -1, cardOpener: null, binderOpener: null,
    raf: 0, lastTs: 0,
    rx: 0, ry: 0, vx: 0, vy: 0,
    tx: 0, ty: 0, dragging: false, lastInputTs: 0,
    sweepStart: 0, sweeping: false,
    slowFrames: 0, lowPerf: false
  };

  function show(name) {
    screens.forEach(function (s) { $('screen-' + s).hidden = s !== name; });
    if (name !== 'result') fitTrays();
  }

  function setStatus(id, text) { $(id).textContent = text || ''; }
  function clamp01(x) { return x < 0 ? 0 : (x > 1 ? 1 : x); }
  function clamp11(x) { return x < -1 ? -1 : (x > 1 ? 1 : x); }
  function pad(n, len) { var s = String(n); while (s.length < len) s = '0' + s; return s; }

  function isReducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function clearFlash() {
    var flash = $('light-flash');
    if (flash) flash.className = 'light-flash';
  }

  /* ---------- 棱镜碎冰多面体纹理（运行期生成一次并缓存） ---------- */
  function getPrismTexture() {
    if (prismTexUrl) return prismTexUrl;
    try {
      var size = 180, cols = 6, rows = 6;
      var c = document.createElement('canvas');
      c.width = size; c.height = size;
      var ctx = c.getContext('2d');
      var stepX = size / cols, stepY = size / rows;
      var pts = [];
      var r, col, seed = 1337;
      function rand() {
        seed = (seed * 16807) % 2147483647;
        return (seed - 1) / 2147483646;
      }
      for (r = 0; r <= rows; r += 1) {
        pts[r] = [];
        for (col = 0; col <= cols; col += 1) {
          var jx = (col === 0 || col === cols) ? 0 : (rand() - 0.5) * stepX * 0.72;
          var jy = (r === 0 || r === rows) ? 0 : (rand() - 0.5) * stepY * 0.72;
          pts[r][col] = { x: col * stepX + jx, y: r * stepY + jy };
        }
      }
      function drawTri(a, b, d) {
        var lum = Math.floor(35 + rand() * 205);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.lineTo(d.x, d.y);
        ctx.closePath();
        ctx.fillStyle = 'rgb(' + lum + ',' + lum + ',' + lum + ')';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.22)';
        ctx.lineWidth = 0.6;
        ctx.stroke();
      }
      for (r = 0; r < rows; r += 1) {
        for (col = 0; col < cols; col += 1) {
          var p00 = pts[r][col], p10 = pts[r][col + 1];
          var p01 = pts[r + 1][col], p11 = pts[r + 1][col + 1];
          if (rand() > 0.5) {
            drawTri(p00, p10, p11);
            drawTri(p00, p11, p01);
          } else {
            drawTri(p00, p10, p01);
            drawTri(p10, p11, p01);
          }
        }
      }
      prismTexUrl = 'url("' + c.toDataURL('image/png') + '")';
    } catch (e) {
      prismTexUrl = 'none';
    }
    return prismTexUrl;
  }

  /* ---------- 布局：按舞台大小算药盘尺寸，避开右上角宿主按钮 ---------- */
  function fitTrays() {
    ['intro', 'develop', 'fix'].forEach(function (name) {
      var screen = $('screen-' + name);
      if (screen.hidden) return;
      var isIntro = name === 'intro';
      var aspect = isIntro ? 4 / 3 : state.aspect;
      var stage = screen.querySelector(isIntro ? '.intro-tray' : '.stage');
      var tray = screen.querySelector('.tray');
      var paper = screen.querySelector('.tray-paper');
      var sw = stage.clientWidth - 40, sh = stage.clientHeight - (isIntro ? 20 : 50);
      var hw = (sh - 28) / aspect + 28;
      var w = Math.min(sw, hw, isIntro ? 260 : 360);
      // 最小宽度不能超过高度允许的宽度，否则极矮屏会裁掉相纸底部
      tray.style.width = Math.floor(Math.max(Math.min(isIntro ? 90 : 140, hw), w)) + 'px';
      tray.style.maxWidth = 'none';
      paper.style.paddingTop = (aspect * 100).toFixed(2) + '%';
    });
  }

  function fitCard() {
    if (!cardState.open) return;
    var stage = $('card-stage');
    var scene = $('holo-scene');
    if (!stage || !scene) return;
    var caption = $('card-caption');
    var tip = $('card-tip');
    var extraH = 20;
    if (caption) extraH += Math.max(18, caption.offsetHeight) + 8;
    if (tip) extraH += Math.max(16, tip.offsetHeight) + 6;
    var sw = stage.clientWidth - 40;
    var sh = stage.clientHeight - extraH;
    var hw = sh * (55 / 85);
    var w = Math.min(sw, hw, 264);
    scene.style.width = Math.max(92, Math.floor(w)) + 'px';
  }

  function avoidHostButtons() {
    Bridge.getWindowInfo().then(function (info) {
      if (!info || !info.menuButtons || !info.windowWidth) return;
      var left = info.windowWidth;
      ['back', 'me', 'share'].forEach(function (k) {
        var b = info.menuButtons[k];
        if (b && b.top < 80 && b.left > info.windowWidth / 2) left = Math.min(left, b.left);
      });
      if (left < info.windowWidth) {
        document.documentElement.style.setProperty('--capsule-right', Math.ceil(info.windowWidth - left + 12) + 'px');
      }
    });
  }

  /* ---------- 首屏 ---------- */
  function initIntro() {
    var preview = $('sample-preview');
    preview.style.webkitFilter = 'none';
    preview.style.filter = 'none';
    setTimeout(function () {
      try {
        var small = document.createElement('canvas');
        small.width = 300; small.height = 400;
        Film.drawFit(Film.makeSample(), small);
        var shot = Film.develop(small, { dev: 1, uneven: 0, fix: 1, leak: true, dust: true });
        Film.drawFit(shot, preview);
      } catch (e) { /* 示例图失败不影响使用 */ }
    }, 30);

    $('pick-input').addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file || state.busy) return;
      state.busy = true;
      setStatus('intro-status', '正在把照片放上药盘…');
      Film.loadFile(file).then(function (canvas) {
        state.busy = false;
        startDevelop(canvas);
      }, function () {
        state.busy = false;
        setStatus('intro-status', '这张照片读不出来，换一张试试。');
      });
      e.target.value = '';
    });

    $('use-sample').addEventListener('click', function () {
      if (state.busy) return;
      startDevelop(Film.makeSample());
    });
    $('use-sample').disabled = false;
    setStatus('intro-status', '红灯亮了。暗房里看不清颜色，开灯才知道冲成什么样。');
  }

  /* ---------- 显影 ---------- */
  function startDevelop(base) {
    state.base = base;
    state.aspect = base.height / base.width;
    state.dev = 0; state.devTime = 0; state.agiSum = 0; state.agi = 0; state.agiTarget = 0;
    state.fix = 0; state.cardUrl = ''; state.tempPath = '';

    var canvas = $('develop-canvas');
    canvas.width = Math.round(base.width / 2);
    canvas.height = Math.round(base.height / 2);
    Film.drawFit(base, canvas);
    paintDevelop(canvas, 0);

    $('pull-out').disabled = true;
    $('dev-hint').textContent = '晃一晃手机，让药水流过相纸';
    show('develop');

    // 每轮一个独立回调：旧轮迟到的失败只会注销它自己，不会误伤当前轮的订阅
    var round = ++state.gyroRound;
    var cb = function (f) { onGyro(f); };
    state.gyroCbs.push(cb);   // 启动前就登记：确认到达前捞出，也能被 stopAllGyro 释放
    Bridge.startGyro(cb).then(function (ok) {
      var i = state.gyroCbs.indexOf(cb);
      if (i < 0) return;                       // 已经捞出、被释放了，迟到的确认不再加回
      if (!ok) state.gyroCbs.splice(i, 1);
      if (round !== state.gyroRound) return;
      state.gyroOn = ok;
      if (!ok) $('dev-hint').textContent = '用手指在药盘里来回划，让药水流动';
    });
    state.lastTs = 0;
    state.developing = true;
    state.raf = requestAnimationFrame(tick);
  }

  function onGyro(f) {
    if (!f) return;
    var mag = Math.sqrt(f.x * f.x + f.y * f.y + f.z * f.z);
    state.agiTarget = Math.max(state.agiTarget, clamp01(mag / 5));
  }

  /* 相纸上的影像：显影越久越浓，过了就发黑 */
  function paintDevelop(canvas, dev) {
    var t = clamp01((dev - 0.12) / 0.85);
    var density = t * t * (3 - 2 * t);
    var over = Math.max(0, dev - 1);
    var under = Math.max(0, 1 - dev);
    var bright = (1 - over * 0.45 + under * 0.15).toFixed(3);
    var contrast = (1 + over * 0.6 - under * 0.3).toFixed(3);
    var f = 'grayscale(1) contrast(' + contrast + ') brightness(' + bright + ')';
    canvas.style.webkitFilter = f;
    canvas.style.filter = f;
    canvas.style.opacity = density.toFixed(3);
  }

  function tick(ts) {
    if (!state.developing) return;
    if (!state.lastTs) state.lastTs = ts;
    var dt = Math.min(0.5, (ts - state.lastTs) / 1000);
    state.lastTs = ts;

    // 输入衰减：不晃了，药水慢慢平静
    state.agi += (state.agiTarget - state.agi) * Math.min(1, dt * 8);
    state.agiTarget *= Math.pow(0.05, dt);

    state.dev = Math.min(2, state.dev + dt * (BASE_RATE + AGITATE_RATE * state.agi));
    state.devTime += dt;
    state.agiSum += state.agi * dt;

    paintDevelop($('develop-canvas'), state.dev);
    var liquid = $('tray-liquid');
    var tt = ts / 1000, amp = state.agi;
    liquid.style.transform = liquid.style.webkitTransform =
      'translate(' + (Math.sin(tt * 6) * amp * 7).toFixed(2) + '%,' + (Math.cos(tt * 4.3) * amp * 5).toFixed(2) + '%)';
    $('dev-meter').style.width = Math.round(state.agi * 100) + '%';
    var sec = Math.floor(state.devTime);
    $('dev-time').textContent = pad(Math.floor(sec / 60), 2) + ':' + pad(sec % 60, 2);

    if (state.dev > 0.25) $('pull-out').disabled = false;
    var hint = $('dev-hint');
    if (state.dev > 1.35) hint.textContent = '再不捞，就只剩轮廓了';
    else if (state.dev > 0.8) hint.textContent = '画面差不多成形了，你觉得呢？';
    else if (state.dev > 0.3) hint.textContent = '影子出来了，继续晃';

    state.raf = requestAnimationFrame(tick);
  }

  function stopDevelopLoop() {
    state.developing = false;
    cancelAnimationFrame(state.raf);
    state.raf = 0;
    stopAllGyro();
    state.gyroOn = false;
  }

  function stopAllGyro() {
    state.gyroCbs.forEach(function (cb) { Bridge.stopGyro(cb); });
    state.gyroCbs = [];
  }

  function spawnRipple(clientX, clientY, force) {
    var now = Date.now();
    if (!force) {
      if (now - state.lastRippleTs < 120) return;
      var dx = clientX - state.lastRippleX;
      var dy = clientY - state.lastRippleY;
      if (dx * dx + dy * dy < 16 * 16) return;
    }
    state.lastRippleTs = now;
    state.lastRippleX = clientX;
    state.lastRippleY = clientY;
    var box = $('tray-ripples');
    if (!box) return;
    var rect = box.getBoundingClientRect();
    var dot = document.createElement('span');
    dot.className = 'tray-ripple';
    dot.style.left = Math.round(clientX - rect.left) + 'px';
    dot.style.top = Math.round(clientY - rect.top) + 'px';
    box.appendChild(dot);
    setTimeout(function () {
      if (dot.parentNode) dot.parentNode.removeChild(dot);
    }, 680);
  }

  function bindTrayRub() {
    var tray = $('tray'), last = null;
    tray.style.touchAction = 'none';
    // 只跟踪第一根手指：多指各自的坐标混在一起会算出虚高的流动速度
    tray.addEventListener('pointerdown', function (e) {
      if (last) return;
      last = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp };
      spawnRipple(e.clientX, e.clientY, true);
      if (tray.setPointerCapture) { try { tray.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ } }
    });
    tray.addEventListener('pointermove', function (e) {
      if (!last || e.pointerId !== last.id) return;
      var dt = Math.max(1, e.timeStamp - last.t);
      var dist = Math.sqrt(Math.pow(e.clientX - last.x, 2) + Math.pow(e.clientY - last.y, 2));
      state.agiTarget = Math.max(state.agiTarget, clamp01((dist / dt) * 1000 / 1500));
      spawnRipple(e.clientX, e.clientY, false);
      last = { id: last.id, x: e.clientX, y: e.clientY, t: e.timeStamp };
    });
    function end(e) { if (last && e.pointerId === last.id) last = null; }
    tray.addEventListener('pointerup', end);
    tray.addEventListener('pointercancel', end);
  }

  function pullOut() {
    if ($('pull-out').disabled) return;
    stopDevelopLoop();
    Bridge.vibrate('medium');
    var fixCanvas = $('fix-canvas'), devCanvas = $('develop-canvas');
    fixCanvas.width = devCanvas.width; fixCanvas.height = devCanvas.height;
    Film.drawFit(state.base, fixCanvas);
    paintDevelop(fixCanvas, state.dev);
    state.fix = 0;
    state.lastFixSec = 0;
    $('fix-fill').style.width = '0';
    $('fix-text').textContent = '按住定影（4 秒）';
    $('fix-hint').textContent = '按住不放，让定影液把画面固定下来';
    $('fix-hold').className = 'btn btn-hold';
    $('lights-on').className = 'btn btn-ghost';
    $('lights-on').hidden = true;
    $('step-fix').className = 'is-on';
    $('step-light').className = '';
    show('fix');
  }

  /* ---------- 定影：按住计时 ---------- */
  function bindFix() {
    var btn = $('fix-hold');
    function step() {
      if (!state.fixHolding) return;
      var now = Date.now();
      state.fix = Math.min(1, state.fix + (now - state.fixTimer) / 1000 / FIX_SECONDS);
      state.fixTimer = now;
      $('fix-fill').style.width = Math.round(state.fix * 100) + '%';
      if (state.fix >= 1) {
        state.fixHolding = false;
        holdBy = null;
        btn.className = 'btn btn-hold is-done';
        $('fix-text').textContent = '✓ 定影已完成';
        $('fix-hint').textContent = '画面已固定，可以开灯了';
        $('lights-on').textContent = '开灯';
        $('lights-on').className = 'btn btn-ghost is-ready';
        $('lights-on').hidden = false;
        $('step-fix').className = 'is-done';
        $('step-light').className = 'is-on';
        fitTrays();
        Bridge.vibrate('light');
        return;
      }
      var leftSec = Math.max(1, Math.ceil((1 - state.fix) * FIX_SECONDS));
      if (leftSec !== state.lastFixSec) {
        state.lastFixSec = leftSec;
        $('fix-text').textContent = '定影中… 还剩 ' + leftSec + ' 秒';
      }
      fixRaf = requestAnimationFrame(step);
    }
    // holdBy 记录是谁在按：pointerId，或键盘 'key'；其他手指的按下和抬起一律忽略
    var holdBy = null, fixRaf = 0;
    function startHold(by) {
      if (state.fix >= 1 || state.fixHolding) return;
      holdBy = by;
      state.fixHolding = true;
      state.fixTimer = Date.now();
      state.lastFixSec = 0;
      btn.className = 'btn btn-hold is-holding';
      $('fix-text').textContent = '定影中…';
      cancelAnimationFrame(fixRaf);
      fixRaf = requestAnimationFrame(step);
    }
    btn.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      startHold(e.pointerId);
    });
    function release() {
      if (!state.fixHolding) return;
      state.fixHolding = false;
      holdBy = null;
      cancelAnimationFrame(fixRaf);
      btn.className = 'btn btn-hold';
      if (state.fix < 1) {
        $('fix-text').textContent = '继续按住定影';
        $('fix-hint').textContent = '定影还没做完，现在开灯可能会留下斑';
        $('lights-on').textContent = '就这样开灯';
        $('lights-on').className = 'btn btn-ghost';
        $('lights-on').hidden = false;
        fitTrays();
      }
    }
    function endPointer(e) { if (e.pointerId === holdBy) release(); }
    btn.addEventListener('pointerup', endPointer);
    btn.addEventListener('pointercancel', endPointer);
    btn.addEventListener('pointerleave', endPointer);
    // 触摸时手指滑出按钮不会触发 pointerleave，按坐标判断
    btn.addEventListener('pointermove', function (e) {
      if (e.pointerId !== holdBy) return;
      var r = btn.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) release();
    });
    // 记下是哪个键开始的，只认这个键的松开
    function holdKey(e) {
      if (e.key === ' ' || e.key === 'Spacebar') return 'key:space';
      if (e.key === 'Enter') return 'key:enter';
      return null;
    }
    btn.addEventListener('keydown', function (e) {
      var k = holdKey(e);
      if (!k) return;
      e.preventDefault();
      if (!e.repeat) startHold(k);
    });
    btn.addEventListener('keyup', function (e) {
      var k = holdKey(e);
      if (k && k === holdBy) release();
    });
    btn.addEventListener('blur', function () { if (typeof holdBy === 'string') release(); });
    // 开灯时若还按着，静默结束这次按压，不再改界面文字
    endFixHold = function () {
      state.fixHolding = false;
      holdBy = null;
      cancelAnimationFrame(fixRaf);
    };
    // 切到后台时结束按压，回来不会把后台时间算进定影
    document.addEventListener('visibilitychange', function () { if (document.hidden) release(); });
    btn.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }

  /* ---------- 小卡材质：按顺序命中第一条 ---------- */
  function pickMaterial(p) {
    if (p.fix < 1) return 'chrome';      // 没定影完，残留着银
    if (p.dev > 1.4) return 'etched';    // 过显，只剩轮廓
    if (p.dev < 0.75) return 'pearl';    // 欠显，淡得像回忆
    if (p.leak) return 'sparkle';        // 漏进来的光变成闪粉
    var perfect = p.dev >= 0.9 && p.dev <= 1.12 && p.uneven <= 0.3 && !p.dust;
    if (perfect && Math.random() < PRISM_ROLL) return 'prism';
    return 'rainbow';
  }

  function collectMaterial(m) {
    if (state.collected.indexOf(m) >= 0) {
      // 材质不新，但上次写卡册失败了：趁这次出片再补写一次
      if (saved.cards.unsaved) saveCards();
      return;
    }
    state.collected.push(m);
    saveCards();   // 存档还没读回或读取失败时不写，见 persist
  }

  /* ---------- 存档：计数和卡册 ----------
     每个键三种状态：pending 还在读、ok 读回成功、failed 读取失败。
     只有 ok 才写；failed 的键本次只记在内存里，绝不写，免得覆盖存储里的旧数据。
     出片时最多等 1.5 秒读取，避免迟到的读数改写本轮 */
  var saved = {
    ready: null,
    count: { state: 'pending', rounds: 0, writing: false, again: false, unsaved: false },
    cards: { state: 'pending', writing: false, again: false, unsaved: false }
  };

  // 同一个键串行写：上一次写完再写最新值，避免后发的写入先落盘
  function persist(slot, write) {
    if (slot.state !== 'ok') return;
    if (slot.writing) { slot.again = true; return; }
    slot.writing = true;
    function done(ok) {
      slot.writing = false;
      slot.unsaved = ok !== true;   // 写失败（false 或拒绝）留标记，下次出片重试
      if (slot.again) { slot.again = false; persist(slot, write); }
    }
    Promise.resolve().then(write).then(done, function () { done(false); });
  }
  function saveCount() { persist(saved.count, function () { return Bridge.setNumber(COUNT_KEY, state.count); }); }
  function saveCards() { persist(saved.cards, function () { return Bridge.setList(CARDS_KEY, state.collected.slice()); }); }

  function refreshCollectionViews() {
    updateBinderCounts();
    if (cardState.binderOpen) renderBinderGrid();
  }

  function loadSaved() {
    // getNumber / getList 读取失败或容器不支持时返回 null；没有记录时返回 0 / []
    var count = Bridge.getNumber(COUNT_KEY).then(null, function () { return null; }).then(function (n) {
      if (n === null) { saved.count.state = 'failed'; return; }
      state.count = n + saved.count.rounds;   // 读回前已经出过片：在存档值上接着往后数
      saved.count.state = 'ok';
      if (saved.count.rounds) saveCount();
    });
    var cards = Bridge.getList(CARDS_KEY).then(null, function () { return null; }).then(function (list) {
      if (list === null) { saved.cards.state = 'failed'; return; }
      var stored = list.filter(function (m) { return MATERIALS.indexOf(m) >= 0; });
      stored.forEach(function (m) { if (state.collected.indexOf(m) < 0) state.collected.push(m); });
      saved.cards.state = 'ok';
      if (state.collected.length > stored.length) saveCards();
      // 本轮的材质其实早就收集过：撤掉「新」的标记
      if (state.isNewMaterial && stored.indexOf(state.material) >= 0) {
        state.isNewMaterial = false;
        var dot = $('open-card-dot'); if (dot) dot.hidden = true;
        var tag = $('card-caption-new'); if (tag) tag.hidden = true;
      }
      refreshCollectionViews();
    });
    saved.ready = Promise.race([Promise.all([count, cards]), new Promise(function (res) { setTimeout(res, 1500); })]);
  }

  /* ---------- 弹层焦点管理与无剧透判定 ---------- */
  function isCurrentRevealed() {
    return !!(state.material && cardState.revealedRound === state.round);
  }

  function isMaterialVisibleInBinder(key) {
    if (state.collected.indexOf(key) < 0) return false;
    if (key === state.material && state.isNewMaterial && !isCurrentRevealed()) return false;
    return true;
  }

  function getActiveModal() {
    if (cardState.binderOpen) return $('binder-modal');
    if (cardState.open) return $('card-modal');
    return null;
  }

  function getFocusable(root) {
    var list = root.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    var out = [];
    for (var i = 0; i < list.length; i += 1) {
      var el = list[i];
      if (el.disabled || el.hidden || el.offsetParent === null) continue;
      out.push(el);
    }
    return out;
  }

  function focusModal(modal, preferred) {
    if (preferred && !preferred.disabled && preferred.offsetParent !== null) {
      try { preferred.focus(); return; } catch (err) { /* 忽略 */ }
    }
    var items = getFocusable(modal);
    if (items.length) {
      try { items[0].focus(); } catch (err) { /* 忽略 */ }
    }
  }

  function restoreFocus(el) {
    if (el && el !== document.body && typeof el.focus === 'function' && !el.disabled && el.offsetParent !== null) {
      try { el.focus(); } catch (err) { /* 忽略 */ }
    }
  }

  function bindModalFocusTrap() {
    document.addEventListener('keydown', function (e) {
      var modal = getActiveModal();
      if (!modal) return;
      if (e.key === 'Escape' || e.key === 'Esc') {
        e.preventDefault();
        if (cardState.binderOpen) closeBinder();
        else closeCard();
        return;
      }
      if (e.key !== 'Tab' && e.keyCode !== 9) return;
      var items = getFocusable(modal);
      if (!items.length) {
        e.preventDefault();
        return;
      }
      var first = items[0], last = items[items.length - 1];
      var cur = document.activeElement;
      var inside = modal.contains(cur);
      if (e.shiftKey) {
        if (!inside || cur === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (!inside || cur === last) {
          e.preventDefault();
          first.focus();
        }
      }
    });
    document.addEventListener('focusin', function (e) {
      var modal = getActiveModal();
      if (!modal || modal.contains(e.target)) return;
      focusModal(modal, null);
    });
  }

  /* ---------- 镭射小卡与暗房卡册 ---------- */
  function setCardTilt(nx, ny) {
    cardState.tx = clamp11(nx);
    cardState.ty = clamp11(ny);
    cardState.lastInputTs = Date.now();
  }

  function degradeCardPerf() {
    if (cardState.lowPerf) return;
    cardState.lowPerf = true;
    var modal = $('card-modal');
    if (modal && modal.className.indexOf('is-low-perf') < 0) {
      modal.className = modal.className + ' is-low-perf';
    }
  }

  function buildRarityMarkup(meta) {
    var svg = '';
    if (meta.tier === 'prism') {
      svg = '<svg class="rarity-svg" viewBox="0 0 20 12" width="16" height="10" aria-hidden="true">' +
        '<path d="M5 1l1.2 3.8L10 6 6.2 7.2 5 11 3.8 7.2 0 6l3.8-1.2z" fill="currentColor"/>' +
        '<path d="M15 1l1.2 3.8L20 6l-3.8 1.2L15 11l-1.2-3.8L10 6l3.8-1.2z" fill="currentColor"/>' +
        '</svg>';
    } else if (meta.tier === 'special') {
      svg = '<svg class="rarity-svg" viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">' +
        '<path d="M6 1l1.3 3.7L11 6 7.3 7.3 6 11 4.7 7.3 1 6l3.7-1.3z" fill="currentColor"/>' +
        '</svg>';
    } else {
      svg = '<svg class="rarity-svg" viewBox="0 0 10 10" width="8" height="8" aria-hidden="true">' +
        '<circle cx="5" cy="5" r="3" fill="currentColor"/>' +
        '</svg>';
    }
    return svg + '<span>' + meta.code + '</span>';
  }

  function applyCardVisual(rx, ry) {
    var tilt = $('holo-tilt');
    var fx = $('holo-fx');
    var backShine = $('holo-back-shine');
    if (tilt) {
      var t = 'rotateX(' + rx.toFixed(2) + 'deg) rotateY(' + ry.toFixed(2) + 'deg)';
      tilt.style.webkitTransform = t;
      tilt.style.transform = t;
    }
    if (cardState.lowPerf) return;
    var nx = clamp11(ry / 12);
    var ny = clamp11(-rx / 12);
    var px = (50 + nx * 38).toFixed(1) + '%';
    var py = (50 + ny * 38).toFixed(1) + '%';
    var bgx = (50 + nx * 46).toFixed(1) + '%';
    var bgy = (50 + ny * 46).toFixed(1) + '%';
    var hyp = Math.min(1, Math.sqrt(nx * nx + ny * ny)).toFixed(3);
    if (fx) {
      fx.style.setProperty('--px', px);
      fx.style.setProperty('--py', py);
      fx.style.setProperty('--bgx', bgx);
      fx.style.setProperty('--bgy', bgy);
      fx.style.setProperty('--hyp', hyp);
    }
    if (backShine) {
      backShine.style.setProperty('--px', (50 - nx * 38).toFixed(1) + '%');
      backShine.style.setProperty('--py', py);
    }
  }

  function cardTick(ts) {
    if (!cardState.open || cardState.binderOpen) return;
    if (isReducedMotion()) {
      cardState.rx = 0; cardState.ry = 0; cardState.vx = 0; cardState.vy = 0;
      applyCardVisual(0, 0);
      cardState.raf = 0;
      return;
    }
    if (!cardState.lastTs) {
      cardState.lastTs = ts;
    } else if (!cardState.lowPerf) {
      var rawDt = ts - cardState.lastTs;
      if (rawDt > 45 && rawDt < 500) {
        cardState.slowFrames += 1;
        if (cardState.slowFrames >= 10) degradeCardPerf();
      } else {
        cardState.slowFrames = 0;
      }
    }
    var dt = Math.min(0.05, (ts - cardState.lastTs) / 1000);
    cardState.lastTs = ts;

    var now = Date.now();
    var targetRx = 0, targetRy = 0;
    var hasActiveInput = cardState.dragging || (now - cardState.lastInputTs < 420);
    if (hasActiveInput) {
      cardState.sweeping = false;
      targetRy = cardState.tx * 12;
      targetRx = -cardState.ty * 12;
    } else if (cardState.sweeping) {
      var p = (now - cardState.sweepStart) / 760;
      if (p >= 1) {
        cardState.sweeping = false;
      } else {
        var env = Math.sin(p * Math.PI);
        var sweepX = -Math.cos(p * Math.PI) * 0.72 * env;
        var sweepY = -Math.cos(p * Math.PI) * 0.48 * env;
        targetRy = sweepX * 12;
        targetRx = -sweepY * 12;
      }
    } else {
      var t = ts / 1000;
      var idleAmp = cardState.revealed ? 1 : 0.6;
      targetRy = Math.sin(t * 1.15) * 3.8 * idleAmp;
      targetRx = Math.cos(t * 0.85) * 2.8 * idleAmp;
    }

    // 弹簧回弹物理
    var stiffness = cardState.dragging ? 170 : 95;
    var damping = cardState.dragging ? 18 : 11;
    var ax = (targetRx - cardState.rx) * stiffness - cardState.vx * damping;
    var ay = (targetRy - cardState.ry) * stiffness - cardState.vy * damping;
    cardState.vx += ax * dt;
    cardState.vy += ay * dt;
    cardState.rx += cardState.vx * dt;
    cardState.ry += cardState.vy * dt;

    applyCardVisual(cardState.rx, cardState.ry);
    cardState.raf = requestAnimationFrame(cardTick);
  }

  function startCardLoop() {
    if (!cardState.open || cardState.binderOpen) return;
    if (cardState.revealing && !cardState.revealed) finishReveal();
    if (cardState.raf) return;
    cardState.lastTs = 0;
    cardState.slowFrames = 0;
    if (isReducedMotion()) {
      applyCardVisual(0, 0);
      return;
    }
    cardState.raf = requestAnimationFrame(cardTick);
  }

  function stopCardLoop() {
    cancelAnimationFrame(cardState.raf);
    cardState.raf = 0;
    if (cardState.revealTimer) {
      clearTimeout(cardState.revealTimer);
      cardState.revealTimer = 0;
    }
  }

  function updateBinderCounts() {
    var got = 0;
    MATERIALS.forEach(function (k) {
      if (isMaterialVisibleInBinder(k)) got += 1;
    });
    var shortText = got + '/' + MATERIALS.length;
    var elRes = $('binder-count-result');
    var elCard = $('binder-count-card');
    var elHead = $('card-collect-count');
    if (elRes) elRes.textContent = shortText;
    if (elCard) elCard.textContent = shortText;
    if (elHead) elHead.textContent = '已收集 ' + shortText;
  }

  function renderBinderGrid() {
    var grid = $('card-collect-grid');
    if (!grid) return;
    grid.innerHTML = '';
    updateBinderCounts();
    var revealedNow = isCurrentRevealed();

    MATERIALS.forEach(function (key, idx) {
      var meta = MATERIAL_META[key];
      var has = isMaterialVisibleInBinder(key);
      var slot = document.createElement('div');
      slot.className = 'binder-slot';

      var pocket = document.createElement('div');
      pocket.className = 'binder-pocket';

      if (has) {
        var card = document.createElement('div');
        card.className = 'pocket-card';
        card.setAttribute('data-material', key);

        var head = document.createElement('div');
        head.className = 'pocket-head';
        var num = document.createElement('span');
        num.textContent = pad(idx + 1, 2) + ' / ' + meta.code;
        head.appendChild(num);
        if (revealedNow && state.material && key === state.material) {
          var badge = document.createElement('span');
          badge.className = 'pocket-now';
          badge.textContent = '本次';
          head.appendChild(badge);
        }

        var center = document.createElement('div');
        center.className = 'pocket-center';
        var name = document.createElement('p');
        name.className = 'pocket-name';
        name.textContent = meta.name;
        var rar = document.createElement('p');
        rar.className = 'pocket-rarity';
        rar.textContent = meta.rarity;
        center.appendChild(name);
        center.appendChild(rar);

        var origin = document.createElement('p');
        origin.className = 'pocket-origin';
        origin.textContent = meta.origin;

        card.appendChild(head);
        card.appendChild(center);
        card.appendChild(origin);
        pocket.appendChild(card);
      } else {
        var empty = document.createElement('div');
        empty.className = 'pocket-empty';

        var eno = document.createElement('span');
        eno.className = 'pocket-empty-no';
        eno.textContent = pad(idx + 1, 2) + ' / ???';

        var eico = document.createElement('div');
        eico.className = 'pocket-empty-ico';
        eico.innerHTML = '<svg viewBox="0 0 60 60" width="44" height="44" aria-hidden="true">' +
          '<circle cx="30" cy="30" r="24" fill="none" stroke="currentColor" stroke-width="1" stroke-dasharray="2 3"/>' +
          '<circle cx="30" cy="30" r="14" fill="none" stroke="currentColor" stroke-width="1"/>' +
          '<circle cx="30" cy="30" r="3" fill="currentColor"/>' +
          '</svg>';

        var ehint = document.createElement('p');
        ehint.className = 'pocket-empty-hint';
        ehint.textContent = meta.clue;

        empty.appendChild(eno);
        empty.appendChild(eico);
        empty.appendChild(ehint);
        pocket.appendChild(empty);
      }

      slot.appendChild(pocket);
      grid.appendChild(slot);
    });
  }

  function openBinder(e) {
    cardState.binderOpener = (e && e.currentTarget && typeof e.currentTarget.focus === 'function')
      ? e.currentTarget : document.activeElement;
    renderBinderGrid();
    cardState.binderOpen = true;
    stopCardLoop();
    stopCardGyro();   // 卡册挡住小卡时不再采集
    $('binder-modal').hidden = false;
    focusModal($('binder-modal'), $('close-binder'));
  }

  function closeBinder(noFocus) {
    if (!cardState.binderOpen) return;
    cardState.binderOpen = false;
    $('binder-modal').hidden = true;
    if (cardState.open) { startCardLoop(); startCardGyro(); }
    var opener = cardState.binderOpener;
    cardState.binderOpener = null;
    if (noFocus !== true) restoreFocus(opener);
  }

  function finishReveal() {
    var mat = state.material || 'rainbow';
    var meta = MATERIAL_META[mat] || MATERIAL_META.rainbow;
    cardState.revealing = false;
    cardState.revealed = true;
    cardState.revealedRound = state.round;
    cardState.flipped = false;

    var card = $('holo-card');
    if (card) card.className = 'holo-flipper';

    $('card-caption-text').textContent = meta.name + ' · ' + meta.origin;
    $('card-caption-new').hidden = !state.isNewMaterial;
    $('card-caption').className = 'card-caption is-visible';
    $('card-tip').textContent = '手指划动倾斜赏光 · 轻点翻看卡背';
    updateBinderCounts();
    fitCard();

    var saveBtn = $('save-card');
    if (saveBtn) {
      saveBtn.disabled = state.busy;   // 上一次保存还没结束时先不让点，结束后由 saveCard 重新启用
      saveBtn.className = 'btn btn-primary';
    }
    var dot = $('open-card-dot');
    if (dot) dot.hidden = true;

    if (!isReducedMotion()) {
      cardState.sweepStart = Date.now() + 260;
      cardState.sweeping = true;
    }
  }

  function triggerReveal() {
    if (cardState.revealing || cardState.revealed) return;
    var mat = state.material || 'rainbow';
    var meta = MATERIAL_META[mat] || MATERIAL_META.rainbow;

    if (isReducedMotion()) {
      Bridge.vibrate('light');
      finishReveal();
      return;
    }

    var aura = $('holo-aura');
    if (aura) {
      aura.className = 'holo-aura';
      aura.setAttribute('data-material', mat);
      void aura.offsetWidth;
    }

    if (meta.tier === 'prism') {
      cardState.revealing = true;
      Bridge.vibrate('heavy');
      $('holo-card').className = 'holo-flipper is-charging';
      if (aura) aura.className = 'holo-aura is-prism';
      cardState.revealTimer = setTimeout(function () {
        cardState.revealTimer = 0;
        finishReveal();
      }, 220);
    } else if (meta.tier === 'special') {
      cardState.revealing = true;
      Bridge.vibrate('medium');
      if (aura) aura.className = 'holo-aura is-special';
      cardState.revealTimer = setTimeout(function () {
        cardState.revealTimer = 0;
        finishReveal();
      }, 120);
    } else {
      Bridge.vibrate('light');
      finishReveal();
    }
  }

  function toggleCardFlip() {
    if (!cardState.revealed) {
      triggerReveal();
      return;
    }
    cardState.flipped = !cardState.flipped;
    var card = $('holo-card');
    if (card) card.className = cardState.flipped ? 'holo-flipper is-flipped' : 'holo-flipper';
    $('card-tip').textContent = cardState.flipped
      ? '轻点翻回正面'
      : '手指划动倾斜赏光 · 轻点翻看卡背';
    Bridge.vibrate('light');
  }

  function renderCardContent() {
    var mat = state.material || 'rainbow';
    var meta = MATERIAL_META[mat] || MATERIAL_META.rainbow;
    var noPad = pad(state.shotNo || state.count, 4);

    $('holo-front').setAttribute('data-material', mat);
    $('card-front-no').textContent = 'NO.' + noPad;
    $('card-front-mat').textContent = meta.name;
    $('card-front-rarity').innerHTML = buildRarityMarkup(meta);
    $('card-back-no').textContent = 'No.' + noPad;
    $('card-back-date').textContent = state.shotDate || '2026.11.19';

    var fx = $('holo-fx');
    if (fx && mat === 'prism') {
      fx.style.setProperty('--prism-tex', getPrismTexture());
    }

    if (state.photo) {
      var photoCanvas = $('card-photo');
      Film.drawCover(state.photo, photoCanvas);
    }

    updateBinderCounts();
  }

  function openCard(e) {
    if (!state.photo) return;
    cardState.openSeq = (cardState.openSeq || 0) + 1;   // 每次打开一个序号，存卡结果只回写发起它的那次
    cardState.cardOpener = (e && e.currentTarget && typeof e.currentTarget.focus === 'function')
      ? e.currentTarget : document.activeElement;
    renderCardContent();
    cardState.open = true;
    cardState.revealed = false;
    cardState.revealing = false;
    cardState.flipped = true;
    cardState.sweeping = false;
    cardState.rx = 0; cardState.ry = 0; cardState.vx = 0; cardState.vy = 0;
    cardState.tx = 0; cardState.ty = 0; cardState.dragging = false; cardState.lastInputTs = 0;
    cardState.slowFrames = 0;

    var card = $('holo-card');
    card.className = 'holo-flipper is-flipped is-instant';
    var aura = $('holo-aura');
    if (aura) aura.className = 'holo-aura';
    $('card-caption').className = 'card-caption';
    $('card-caption-text').textContent = '';
    $('card-caption-new').hidden = true;
    $('card-tip').textContent = '轻点翻开，看看冲出了什么材质';

    var saveBtn = $('save-card');
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.className = 'btn btn-primary is-pending';
    }

    var scene = $('holo-scene');
    if (scene) {
      scene.className = 'holo-scene';
      void scene.offsetWidth;
      scene.className = 'holo-scene is-entering';
    }

    $('card-modal').hidden = false;
    fitCard();
    applyCardVisual(0, 0);
    // 解除无过渡锁，保证首次点击能平滑翻转
    void card.offsetWidth;
    card.className = 'holo-flipper is-flipped';
    startCardLoop();
    startCardGyro();
    focusModal($('card-modal'), card);
  }

  function closeCard(noFocus) {
    if (!cardState.open) return;
    cardState.open = false;
    cardState.revealing = false;
    cardState.dragging = false;
    cardState.sweeping = false;
    stopCardLoop();
    stopCardGyro();
    $('card-modal').hidden = true;
    var opener = cardState.cardOpener;
    cardState.cardOpener = null;
    if (noFocus !== true) restoreFocus(opener);
  }

  /* ---------- 陀螺仪倾斜小卡：容器只给角速度，累加成倾斜并让它慢慢回正，避免漂移 ---------- */
  var cardGyro = { cb: null, ax: 0, ay: 0, lastTs: 0 };

  function startCardGyro() {
    if (cardGyro.cb || isReducedMotion()) return;
    var cb = function (f) {
      if (!f || !cardState.open || cardState.binderOpen || cardState.dragging || cardState.sweeping) { cardGyro.lastTs = 0; return; }
      var now = Date.now();
      var dt = cardGyro.lastTs ? Math.min(0.2, (now - cardGyro.lastTs) / 1000) : 0.06;
      cardGyro.lastTs = now;
      var keep = Math.pow(0.25, dt);   // 约 1 秒回正到四分之一
      cardGyro.ax = clamp11(cardGyro.ax * keep + f.y * dt * 2);   // 绕 y 轴转动 → 左右倾
      cardGyro.ay = clamp11(cardGyro.ay * keep + f.x * dt * 2);   // 绕 x 轴转动 → 前后倾
      // 手机静止时不接管，让原有的空闲微晃继续
      var still = Math.abs(f.x) + Math.abs(f.y) < 0.05 && Math.abs(cardGyro.ax) + Math.abs(cardGyro.ay) < 0.03;
      if (!still) setCardTilt(cardGyro.ax, cardGyro.ay);
    };
    cardGyro.cb = cb;
    cardGyro.ax = 0; cardGyro.ay = 0; cardGyro.lastTs = 0;
    Bridge.startGyro(cb).then(function (ok) {
      // 启动确认到达时小卡已关、或已换成别的回调：停掉这一个
      if (ok && cardGyro.cb !== cb) Bridge.stopGyro(cb);
      if (!ok && cardGyro.cb === cb) cardGyro.cb = null;
    });
  }

  function stopCardGyro() {
    if (!cardGyro.cb) return;
    Bridge.stopGyro(cardGyro.cb);
    cardGyro.cb = null;
  }

  /* ---------- 存这张小卡：卡背在后、正面在前的晒卡图 ---------- */
  var RARITY_MARK = { C: '●', SP: '✦', SR: '✦✦' };

  function ensureCardShot() {
    var got = 0;
    MATERIALS.forEach(function (k) { if (state.collected.indexOf(k) >= 0) got += 1; });
    // 图上印着收集进度：进度变了（比如存档迟到合并）就重新合成
    if (state.cardShotPath && state.cardShotGot === got) return Promise.resolve(state.cardShotPath);
    var round = state.round;
    var mat = state.material || 'rainbow';
    var meta = MATERIAL_META[mat] || MATERIAL_META.rainbow;
    var no = 'No.' + pad(state.shotNo || state.count, 4);
    var shot = Film.composePhotocard(state.photo, {
      material: mat, name: meta.name, code: meta.code, mark: RARITY_MARK[meta.code] || '',
      no: no, date: state.shotDate || '',
      footer1: '暗房冲印店 · ' + meta.name + '（' + meta.rarity + '）',
      footer2: no + '  ·  ' + (state.shotDate || '') + '  ·  已收集 ' + got + '/' + MATERIALS.length
    });
    return Bridge.toTempFile(shot.toDataURL('image/jpeg', 0.92)).then(function (p) {
      // 写临时文件期间已经换了一轮：这张属于上一轮，不能留给新一轮复用
      if (round === state.round) { state.cardShotPath = p; state.cardShotGot = got; }
      return p;
    });
  }

  function saveCard() {
    var btn = $('save-card');
    if (state.busy || !state.photo || !cardState.revealed) return;
    state.busy = true;
    btn.disabled = true;
    $('card-tip').textContent = '正在存…';
    // 让「正在存」先显示出来，再做较重的合成
    var round = state.round, seq = cardState.openSeq;
    setTimeout(function () {
      // 合成放进 Promise 链：同步抛错也会走到失败分支，按钮和提示一定能恢复
      Promise.resolve().then(ensureCardShot).then(Bridge.saveImage).then(function () {
        if (round === state.round && seq === cardState.openSeq) $('card-tip').textContent = '小卡存到相册了。';
      }, function (err) {
        if (round !== state.round || seq !== cardState.openSeq) return;
        $('card-tip').textContent = err && err.errMsg ? failText(err, '存小卡') : '小卡没合成出来，再点一次试试。';
      }).then(releaseBusy);
    }, 30);
  }

  /* 存相纸、发笔记、存小卡共用 busy；任何一个结束都要把存卡按钮按当前弹层是否已揭晓恢复 */
  function releaseBusy() {
    state.busy = false;
    var btn = $('save-card');
    if (btn && cardState.open) btn.disabled = !cardState.revealed;
  }

  function bindCardInteraction() {
    var card = $('holo-card');
    var activeId = null, startX = 0, startY = 0, moved = false;

    function updateFromPointer(e) {
      var rect = card.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      var nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      var ny = ((e.clientY - rect.top) / rect.height) * 2 - 1;
      setCardTilt(nx, ny);
    }

    card.addEventListener('pointerdown', function (e) {
      if (activeId !== null) return;
      activeId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      moved = false;
      cardState.dragging = true;
      if (card.setPointerCapture) { try { card.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ } }
      if (!isReducedMotion()) updateFromPointer(e);
    });

    card.addEventListener('pointermove', function (e) {
      if (e.pointerId !== activeId) return;
      var dx = e.clientX - startX;
      var dy = e.clientY - startY;
      if (dx * dx + dy * dy > 64) moved = true;
      if (!isReducedMotion()) updateFromPointer(e);
    });

    function end(e, allowFlip) {
      if (e.pointerId !== activeId) return;
      activeId = null;
      cardState.dragging = false;
      cardState.lastInputTs = 0;
      if (allowFlip && !moved) toggleCardFlip();
    }

    card.addEventListener('pointerup', function (e) { end(e, true); });
    card.addEventListener('pointercancel', function (e) { end(e, false); });

    card.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        toggleCardFlip();
      }
    });
  }

  /* ---------- 开灯出片 ---------- */
  function devLabel(dev) {
    if (dev < 0.75) return { title: '淡得像一段回忆', tag: '欠显' };
    if (dev < 0.9) return { title: '还差一口气', tag: '略欠' };
    if (dev <= 1.12) return { title: '刚刚好的一张', tag: '刚好' };
    if (dev <= 1.4) return { title: '浓了一点点', tag: '略过' };
    return { title: '黑得只剩轮廓', tag: '过显' };
  }

  function renderReportTags(items, isPerfect) {
    var box = $('result-report');
    box.innerHTML = '';
    items.forEach(function (text, idx) {
      var span = document.createElement('span');
      span.className = (isPerfect && idx === items.length - 1) ? 'report-tag report-tag-ok' : 'report-tag';
      span.textContent = text;
      box.appendChild(span);
    });
  }

  function lightsOn() {
    if (state.busy) return;
    endFixHold();
    state.busy = true;
    $('lights-on').disabled = true;
    $('fix-hint').textContent = '开灯…';
    var flash = $('light-flash');
    if (flash) {
      flash.className = 'light-flash';
      void flash.offsetWidth;
      flash.className = 'light-flash is-flashing';
    }
    document.body.className = 'is-lit';
    Bridge.vibrate('heavy');

    var avgAgi = state.devTime > 0 ? state.agiSum / state.devTime : 0;
    var params = {
      dev: state.dev,
      uneven: clamp01(1 - avgAgi / 0.45),
      fix: state.fix,
      leak: Math.random() < 0.3,
      dust: Math.random() < 0.5
    };
    state.material = pickMaterial(params);

    // 等存档读回（最多 1.5 秒）再出片，编号和卡册才不会被迟到的读数覆盖
    saved.ready.then(function () { setTimeout(function () {
      try {
        var photo = Film.develop(state.base, params);
        var label = devLabel(params.dev);
        var no = state.count + 1;
        var d = new Date();
        state.shotDate = d.getFullYear() + '.' + pad(d.getMonth() + 1, 2) + '.' + pad(d.getDate(), 2);
        var card = Film.composeCard(photo, {
          title: label.title,
          no: 'No.' + pad(no, 4),
          date: state.shotDate,
          footer: '暗房冲印店 · 暖调彩负'
        });
        state.cardUrl = card.toDataURL('image/jpeg', 0.9);
        // 成片生成成功才提交本轮：编号、小卡照片、收集
        state.photo = photo;   // 小卡正面用这张成片（canvas），不带白边
        state.count = no;
        state.shotNo = no;   // 本轮编号定下来，相纸、小卡和晒卡图都用它
        if (saved.count.state === 'pending') saved.count.rounds += 1;
        else saveCount();
        var prevCollectedLen = state.collected.length;
        collectMaterial(state.material);
        state.isNewMaterial = state.collected.length > prevCollectedLen;
        state.tempPath = '';
        state.title = label.title;
        $('result-img').src = state.cardUrl;
        $('result-title').textContent = label.title;

        var tags = [
          '显影 ' + Math.round(state.devTime) + 's · ' + label.tag,
          '药水流动 ' + Math.round(avgAgi * 100) + '%'
        ];
        var flaws = [];
        if (params.leak) flaws.push('漏进了一点光');
        if (params.uneven > 0.3) flaws.push('显影不匀');
        if (params.dust) flaws.push('沾了灰');
        if (params.fix < 1) flaws.push('定影斑');
        if (flaws.length) {
          flaws.forEach(function (f) { tags.push(f); });
          renderReportTags(tags, false);
        } else {
          tags.push('一点瑕疵都没有');
          renderReportTags(tags, true);
        }

        $('open-card-text').textContent = '领取暗房小卡';
        $('open-card-dot').hidden = !state.isNewMaterial;
        updateBinderCounts();

        setStatus('result-status', Bridge.inApp() ? '' : '在小红书里打开，才能存相册和发笔记。');
        show('result');
        document.querySelector('.result-scroll').scrollTop = 0;
      } catch (e) {
        clearFlash();
        document.body.className = '';
        $('fix-hint').textContent = '这张没冲出来，再试一次吧';
      }
      state.busy = false;
      $('lights-on').disabled = false;
    }, 60); });
  }

  function ensureTempFile() {
    if (state.tempPath) return Promise.resolve(state.tempPath);
    return Bridge.toTempFile(state.cardUrl).then(function (p) { state.tempPath = p; return p; });
  }

  function failText(err, action) {
    if (err && err.errMsg === 'unsupported') return '这里' + action + '不了，请在小红书里打开。';
    return action + '没成功，可能是没有相册权限，允许后再试一次。';
  }

  function savePhoto() {
    if (state.busy || !state.cardUrl) return;
    state.busy = true;
    $('save-photo').disabled = true;
    setStatus('result-status', '正在存…');
    ensureTempFile().then(Bridge.saveImage).then(function () {
      setStatus('result-status', '已经存到相册了。');
    }, function (err) {
      setStatus('result-status', failText(err, '存相册'));
    }).then(function () { releaseBusy(); $('save-photo').disabled = false; });
  }

  function postNote() {
    if (state.busy || !state.cardUrl) return;
    state.busy = true;
    $('post-note').disabled = true;
    setStatus('result-status', '');
    ensureTempFile().then(function (path) {
      return Bridge.postNote(path, '我在暗房冲了一张照片',
        '在「暗房冲印店」的红灯下，亲手冲洗了一张照片：' + state.title + '。\n晃得好不好，决定它最后长什么样。');
    }).catch(function (err) {
      setStatus('result-status', failText(err, '发笔记'));
    }).then(function () { releaseBusy(); $('post-note').disabled = false; });
  }

  function again() {
    closeBinder(true);
    closeCard(true);
    clearFlash();
    document.body.className = '';
    state.base = null; state.cardUrl = ''; state.tempPath = ''; state.photo = null; state.material = '';
    state.isNewMaterial = false; state.cardShotPath = ''; state.round += 1;
    $('result-img').removeAttribute('src');
    setStatus('intro-status', '再选一张照片吧。');
    show('intro');
  }

  /* ---------- 启动 ---------- */
  function boot() {
    if (!Bridge || !Film) {
      setStatus('intro-status', '暗房没准备好，请退出后重新打开。');
      return;
    }
    avoidHostButtons();
    loadSaved();
    bindTrayRub();
    bindFix();
    bindCardInteraction();
    bindModalFocusTrap();
    $('pull-out').addEventListener('click', pullOut);
    $('lights-on').addEventListener('click', lightsOn);
    $('open-card').addEventListener('click', openCard);
    $('close-card').addEventListener('click', closeCard);
    $('save-card').addEventListener('click', saveCard);
    $('open-binder-result').addEventListener('click', openBinder);
    $('open-binder-card').addEventListener('click', openBinder);
    $('close-binder').addEventListener('click', closeBinder);
    $('save-photo').addEventListener('click', savePhoto);
    $('post-note').addEventListener('click', postNote);
    $('again').addEventListener('click', again);
    window.addEventListener('resize', function () {
      fitTrays();
      fitCard();
    });
    fitTrays();
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        stopCardLoop();
      } else {
        state.lastTs = 0;
        if (cardState.open && !cardState.binderOpen) startCardLoop();
      }
    });
    initIntro();
  }

  boot();
}());

