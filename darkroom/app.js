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

  var endFixHold = function () {};
  var state = {
    base: null, aspect: 4 / 3,
    dev: 0, devTime: 0, agiSum: 0, agi: 0, agiTarget: 0,
    raf: 0, lastTs: 0, gyroOn: false, gyroRound: 0, gyroCbs: [],
    fix: 0, fixHolding: false, fixTimer: 0, lastFixSec: 0,
    cardUrl: '', tempPath: '', count: 0, busy: false,
    lastRippleTs: 0, lastRippleX: 0, lastRippleY: 0
  };

  function show(name) {
    screens.forEach(function (s) { $('screen-' + s).hidden = s !== name; });
    if (name !== 'result') fitTrays();
  }

  function setStatus(id, text) { $(id).textContent = text || ''; }
  function clamp01(x) { return x < 0 ? 0 : (x > 1 ? 1 : x); }
  function pad(n, len) { var s = String(n); while (s.length < len) s = '0' + s; return s; }

  function clearFlash() {
    var flash = $('light-flash');
    if (flash) flash.className = 'light-flash';
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
    Bridge.startGyro(cb).then(function (ok) {
      if (ok) state.gyroCbs.push(cb);
      // 已经捞出来了才确认启动：立即停掉，免得定影页继续采集
      if (!state.developing) { stopAllGyro(); return; }
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

    setTimeout(function () {
      try {
        var photo = Film.develop(state.base, params);
        var label = devLabel(params.dev);
        state.count += 1;
        Bridge.setNumber(COUNT_KEY, state.count);
        var d = new Date();
        var card = Film.composeCard(photo, {
          title: label.title,
          no: 'No.' + pad(state.count, 4),
          date: d.getFullYear() + '.' + pad(d.getMonth() + 1, 2) + '.' + pad(d.getDate(), 2),
          footer: '暗房冲印店 · 暖调彩负'
        });
        state.cardUrl = card.toDataURL('image/jpeg', 0.9);
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
    }, 60);
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
    }).then(function () { state.busy = false; $('save-photo').disabled = false; });
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
    }).then(function () { state.busy = false; $('post-note').disabled = false; });
  }

  function again() {
    clearFlash();
    document.body.className = '';
    state.base = null; state.cardUrl = ''; state.tempPath = '';
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
    Bridge.getNumber(COUNT_KEY).then(function (n) { if (n) state.count = n; });
    bindTrayRub();
    bindFix();
    $('pull-out').addEventListener('click', pullOut);
    $('lights-on').addEventListener('click', lightsOn);
    $('save-photo').addEventListener('click', savePhoto);
    $('post-note').addEventListener('click', postNote);
    $('again').addEventListener('click', again);
    window.addEventListener('resize', fitTrays);
    fitTrays();
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) state.lastTs = 0;
    });
    initIntro();
  }

  boot();
}());

