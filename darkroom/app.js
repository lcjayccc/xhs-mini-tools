/* 暗房冲印店：流程与交互（显影 → 定影 → 开灯 → 出片） */
(function () {
  'use strict';

  var Bridge = window.Bridge, Film = window.Film;
  var $ = function (id) { return document.getElementById(id); };
  var screens = ['intro', 'crop', 'develop', 'fix', 'result'];

  var DEVELOP_RATE = 0.075;
  var EXPOSURE_MS = 800, STOP_BATH_MS = 700, WASH_MS = 1000;
  var FIX_SECONDS = 4;
  var COUNT_KEY = 'darkroom.count';
  var CARDS_KEY = 'darkroom.cards';
  // 卡册 3×3 九宫格展示顺序（SSR → SR → R）；旧存档 6 个 ID 原样继承
  var MATERIALS = ['prism', 'noir', 'cateye', 'sparkle', 'etched', 'chrome', 'rainbow', 'pearl', 'sunleak'];

  var MATERIAL_META = {
    prism:   { name: '碎冰棱镜', rarity: '暗房秘藏', code: 'SSR', tier: 'prism',   tag: '碎光折射', origin: '像把整片碎玻璃星河封进相纸',   clue: '碎光在暗处折射' },
    noir:    { name: '暗房红印', rarity: '暗房秘藏', code: 'SSR', tier: 'prism',   tag: '黑金红印', origin: '红灯与鎏金定格的冲印店私藏',   clue: '暗房红光与鎏金' },
    cateye:  { name: '丝绒猫眼', rarity: '工艺特版', code: 'SR',  tier: 'special', tag: '丝绒磁光', origin: '一道丝绒猫眼光随指尖游走聚集', clue: '游走的丝绒光带' },
    sparkle: { name: '星尘闪粉', rarity: '工艺特版', code: 'SR',  tier: 'special', tag: '鎏金星尘', origin: '暗房里偷偷落进来的星尘',       clue: '细碎金闪时隐时现' },
    etched:  { name: '银盐蚀刻', rarity: '工艺特版', code: 'SR',  tier: 'special', tag: '银盐雕纹', origin: '逆光细看，藏在暗处的银盐雕纹', clue: '光扫过浮现银线' },
    chrome:  { name: '液态银镜', rarity: '工艺特版', code: 'SR',  tier: 'special', tag: '刀锋银光', origin: '一道冷冽的金属银盐刀锋光',     clue: '银白镜光斜切过' },
    sunleak: { name: '暖阳漏光', rarity: '常驻典藏', code: 'R',   tier: 'common',  tag: '落日漏光', origin: '胶片边缘漏进一缕日落暖阳',     clue: '边角漏进暖橙光' },
    pearl:   { name: '月光珠光', rarity: '常驻典藏', code: 'R',   tier: 'common',  tag: '柔雾贝母', origin: '像月光浸过的柔雾贝母纸',       clue: '温润的贝母光泽' },
    rainbow: { name: '柔虹', rarity: '常驻典藏', code: 'R',   tier: 'common',  tag: '斜掠柔虹', origin: '光斜过来时，刚好掠过一道虹',   clue: '柔和游走的彩光' }
  };

  var prismTexUrl = '';
  var portraitSampleCache = null;

  var state = {
    base: null, aspect: 4 / 3,
    dev: 0, devTime: 0, agiSum: 0, agi: 0, agiTarget: 0,
    raf: 0, lastTs: 0, gyroOn: false, gyroRound: 0, gyroCbs: [],
    fix: 0, fixHolding: false, fixTimer: 0, lastFixSec: 0,
    printMode: 'clean', prints: null, cardInfo: null, count: 0, busy: false,
    material: '', collected: [], photo: null, round: 0,
    shotDate: '', isNewMaterial: false,
    lastRippleTs: 0, lastRippleX: 0, lastRippleY: 0,
    lastSloshRippleTs: 0,
    sweetBuzzedRound: -1
  };

  var cardState = {
    open: false, binderOpen: false, framing: false,
    photoBounds: null, framingBounds: null, framingDrag: null,
    flipped: true, revealed: false, revealing: false, revealTimer: 0,
    revealedRound: -1, shimmerRound: -1, cardOpener: null, binderOpener: null,
    raf: 0, lastTs: 0,
    rx: 0, ry: 0, vx: 0, vy: 0,
    lx: 34, ly: 22, vlx: 0, vly: 0, on: 0,
    turn: 180, vTurn: 0, charge: 0, dashAngle: 0,
    tx: 0, ty: 0, dragging: false, hovering: false, lastInputTs: 0,
    sweepStart: 0, sweeping: false,
    slowFrames: 0, lowPerf: false, lastDraw: '',
    sampleMode: false, sampleMat: '', sampleReturn: null,
    saveMode: 'face',
    thumb: null
  };

  var previewState = { open: false, opener: null, tipTimer: 0, compareBy: null, original: null, zoomed: false, tapTimer: 0, lastTapTs: 0 };
  var cropState = null;

  function show(name) {
    if (name !== 'result' && previewState.open) closePreview(true);
    screens.forEach(function (s) { $('screen-' + s).hidden = s !== name; });
    if (name !== 'result') {
      fitTrays();
    } else {
      var resScreen = $('screen-result');
      if (resScreen) {
        resScreen.className = 'screen screen-result';
        if (!isReducedMotion()) {
          void resScreen.offsetWidth;
          resScreen.className = 'screen screen-result is-entering';
        }
      }
      var openCardBtn = $('open-card');
      if (openCardBtn) {
        if (!isCurrentRevealed() && cardState.shimmerRound !== state.round && !isReducedMotion()) {
          cardState.shimmerRound = state.round;
          openCardBtn.className = 'btn btn-card-entry';
          void openCardBtn.offsetWidth;
          openCardBtn.className = 'btn btn-card-entry is-shimmer';
        } else {
          openCardBtn.className = 'btn btn-card-entry';
        }
      }
    }
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

  /* ---------- 离线人像示例底片（黄金时刻逆光海边人像，兼顾高光/中间调/深暗部以展现各冲洗与卡面效果） ---------- */
  function makePortraitSample() {
    if (portraitSampleCache) return portraitSampleCache;
    var w = 600, h = 800;
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var ctx = c.getContext('2d');

    // 1. 黄金时刻暖色天海背景（丰富渐变层次）
    var sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0.0, '#1e2842');
    sky.addColorStop(0.28, '#4a3d58');
    sky.addColorStop(0.50, '#b96958');
    sky.addColorStop(0.64, '#f0ae72');
    sky.addColorStop(0.76, '#f8d59a');
    sky.addColorStop(1.0, '#2a222b');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    // 2. 逆光太阳光晕（营造胶片晕光与高光测试区）
    var sun = ctx.createRadialGradient(430, 290, 12, 430, 290, 320);
    sun.addColorStop(0.0, 'rgba(255, 250, 232, 0.92)');
    sun.addColorStop(0.22, 'rgba(255, 214, 152, 0.62)');
    sun.addColorStop(0.55, 'rgba(232, 124, 92, 0.22)');
    sun.addColorStop(1.0, 'rgba(232, 124, 92, 0)');
    ctx.fillStyle = sun;
    ctx.fillRect(0, 0, w, h);

    // 3. 远景海面与波光（中间调与水平层次）
    var sea = ctx.createLinearGradient(0, 495, 0, h);
    sea.addColorStop(0.0, '#6a4c56');
    sea.addColorStop(0.32, '#3d3345');
    sea.addColorStop(1.0, '#1a1721');
    ctx.fillStyle = sea;
    ctx.fillRect(0, 495, w, h - 495);

    // 远山剪影
    ctx.fillStyle = 'rgba(42, 34, 52, 0.55)';
    ctx.beginPath();
    ctx.moveTo(0, 498);
    ctx.quadraticCurveTo(95, 456, 210, 488);
    ctx.quadraticCurveTo(360, 446, 510, 484);
    ctx.quadraticCurveTo(565, 470, w, 482);
    ctx.lineTo(w, 502);
    ctx.lineTo(0, 502);
    ctx.closePath();
    ctx.fill();

    // 海面碎金反光
    var i, rx, ry, rw;
    for (i = 0; i < 28; i += 1) {
      ry = 505 + i * 7.5;
      rw = Math.max(16, 130 - i * 3.4);
      rx = 415 - rw * 0.5 + Math.sin(i * 1.9) * 18;
      ctx.fillStyle = 'rgba(255, 224, 168, ' + (0.28 - i * 0.008).toFixed(3) + ')';
      ctx.fillRect(rx, ry, rw, 2.2);
    }

    // 柔和散景光斑（体现闪粉/棱镜的高光层次）
    var bokeh = [
      [96, 152, 34, 0.14], [156, 226, 22, 0.18], [492, 174, 42, 0.16],
      [524, 348, 28, 0.15], [72, 368, 26, 0.12], [462, 430, 18, 0.20]
    ];
    for (i = 0; i < bokeh.length; i += 1) {
      var b = bokeh[i];
      var bg = ctx.createRadialGradient(b[0], b[1], 2, b[0], b[1], b[2]);
      bg.addColorStop(0, 'rgba(255, 240, 210, ' + b[3] + ')');
      bg.addColorStop(0.75, 'rgba(255, 218, 172, ' + (b[3] * 0.5).toFixed(3) + ')');
      bg.addColorStop(1, 'rgba(255, 218, 172, 0)');
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.arc(b[0], b[1], b[2], 0, Math.PI * 2);
      ctx.fill();
    }

    // 4. 人物后发与随风飘动发丝（深栗色暗部）
    ctx.save();
    ctx.fillStyle = '#1b1214';
    ctx.beginPath();
    ctx.moveTo(192, 278);
    ctx.bezierCurveTo(165, 360, 148, 468, 176, 560);
    ctx.lineTo(418, 558);
    ctx.bezierCurveTo(440, 456, 422, 348, 390, 268);
    ctx.bezierCurveTo(366, 186, 228, 180, 192, 278);
    ctx.closePath();
    ctx.fill();

    // 右侧逆光金色发丝边缘光
    ctx.strokeStyle = 'rgba(255, 216, 154, 0.72)';
    ctx.lineWidth = 3.2;
    ctx.beginPath();
    ctx.moveTo(378, 232);
    ctx.bezierCurveTo(418, 294, 434, 376, 422, 452);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255, 196, 134, 0.42)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(392, 268);
    ctx.bezierCurveTo(438, 336, 456, 404, 444, 474);
    ctx.stroke();

    // 5. 肩颈与针织开衫（奶白色中间调 + 深色内搭领口）
    // 颈部与锁骨光影
    var neckGrad = ctx.createLinearGradient(255, 385, 335, 510);
    neckGrad.addColorStop(0, '#d99e82');
    neckGrad.addColorStop(0.5, '#efc1a4');
    neckGrad.addColorStop(1, '#c88c72');
    ctx.fillStyle = neckGrad;
    ctx.beginPath();
    ctx.moveTo(256, 396);
    ctx.lineTo(330, 396);
    ctx.lineTo(344, 502);
    ctx.lineTo(240, 502);
    ctx.closePath();
    ctx.fill();

    // 下巴在颈部的柔和投影
    ctx.fillStyle = 'rgba(92, 46, 38, 0.28)';
    ctx.beginPath();
    ctx.ellipse(294, 418, 36, 16, 0, 0, Math.PI * 2);
    ctx.fill();

    // 奶白针织开衫主体
    var coatGrad = ctx.createLinearGradient(110, 500, 480, 800);
    coatGrad.addColorStop(0, '#c8b8ab');
    coatGrad.addColorStop(0.45, '#f2e8dc');
    coatGrad.addColorStop(0.85, '#fff4e4');
    coatGrad.addColorStop(1, '#d8c5b4');
    ctx.fillStyle = coatGrad;
    ctx.beginPath();
    ctx.moveTo(108, 800);
    ctx.bezierCurveTo(118, 646, 152, 536, 232, 496);
    ctx.lineTo(362, 496);
    ctx.bezierCurveTo(442, 534, 480, 644, 494, 800);
    ctx.closePath();
    ctx.fill();

    // 深蓝灰水手/衬衫翻领（形成强对比暗部）
    ctx.fillStyle = '#242b3d';
    ctx.beginPath();
    ctx.moveTo(232, 496);
    ctx.lineTo(294, 592);
    ctx.lineTo(362, 496);
    ctx.lineTo(334, 490);
    ctx.lineTo(294, 550);
    ctx.lineTo(258, 490);
    ctx.closePath();
    ctx.fill();

    // 领口白边细线
    ctx.strokeStyle = 'rgba(255, 245, 234, 0.72)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(242, 498);
    ctx.lineTo(294, 580);
    ctx.lineTo(352, 498);
    ctx.stroke();

    // 6. 面部轮廓与柔和五官（胶片日系少女四分之三侧颜）
    var faceGrad = ctx.createRadialGradient(318, 304, 18, 290, 320, 128);
    faceGrad.addColorStop(0, '#fde2cd');
    faceGrad.addColorStop(0.55, '#f1c2a5');
    faceGrad.addColorStop(1, '#ce8e74');
    ctx.fillStyle = faceGrad;
    ctx.beginPath();
    ctx.moveTo(222, 286);
    ctx.bezierCurveTo(220, 368, 250, 418, 296, 422);
    ctx.bezierCurveTo(342, 418, 368, 366, 368, 286);
    ctx.bezierCurveTo(368, 224, 336, 198, 294, 198);
    ctx.bezierCurveTo(252, 198, 222, 226, 222, 286);
    ctx.closePath();
    ctx.fill();

    // 面部右侧暖金轮廓光
    ctx.strokeStyle = 'rgba(255, 242, 214, 0.78)';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(358, 254);
    ctx.bezierCurveTo(370, 316, 356, 376, 326, 408);
    ctx.stroke();

    // 柔和腮红
    var blushL = ctx.createRadialGradient(252, 342, 4, 252, 342, 28);
    blushL.addColorStop(0, 'rgba(228, 122, 108, 0.34)');
    blushL.addColorStop(1, 'rgba(228, 122, 108, 0)');
    ctx.fillStyle = blushL;
    ctx.beginPath();
    ctx.arc(252, 342, 28, 0, Math.PI * 2);
    ctx.fill();

    var blushR = ctx.createRadialGradient(334, 340, 4, 334, 340, 26);
    blushR.addColorStop(0, 'rgba(232, 128, 110, 0.30)');
    blushR.addColorStop(1, 'rgba(232, 128, 110, 0)');
    ctx.fillStyle = blushR;
    ctx.beginPath();
    ctx.arc(334, 340, 26, 0, Math.PI * 2);
    ctx.fill();

    // 眉毛
    ctx.strokeStyle = '#3a2420';
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(240, 294);
    ctx.quadraticCurveTo(260, 287, 276, 293);
    ctx.moveTo(312, 292);
    ctx.quadraticCurveTo(330, 286, 346, 293);
    ctx.stroke();

    // 双眼（清澈目光与高光点）
    function drawEye(cx, cy) {
      ctx.fillStyle = '#fff9f4';
      ctx.beginPath();
      ctx.ellipse(cx, cy, 15, 8.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#2d1c1b';
      ctx.beginPath();
      ctx.arc(cx + 1.5, cy + 0.5, 7.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#5c3c36';
      ctx.beginPath();
      ctx.arc(cx + 1.5, cy + 2.2, 4.0, 0, Math.PI * 2);
      ctx.fill();
      // 眼神高光
      ctx.fillStyle = '#fff7ea';
      ctx.beginPath();
      ctx.arc(cx + 4.0, cy - 2.0, 2.2, 0, Math.PI * 2);
      ctx.fill();
      // 上睫毛线
      ctx.strokeStyle = '#231515';
      ctx.lineWidth = 2.8;
      ctx.beginPath();
      ctx.moveTo(cx - 16, cy + 1);
      ctx.quadraticCurveTo(cx, cy - 11, cx + 16, cy + 1);
      ctx.stroke();
    }
    drawEye(260, 316);
    drawEye(328, 315);

    // 鼻影与微笑唇色
    ctx.strokeStyle = 'rgba(148, 86, 68, 0.42)';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(295, 326);
    ctx.quadraticCurveTo(298, 344, 292, 350);
    ctx.stroke();

    ctx.fillStyle = '#cc6f64';
    ctx.beginPath();
    ctx.moveTo(278, 376);
    ctx.quadraticCurveTo(294, 370, 312, 376);
    ctx.quadraticCurveTo(295, 389, 278, 376);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 224, 210, 0.45)';
    ctx.beginPath();
    ctx.ellipse(295, 379, 6, 1.8, 0, 0, Math.PI * 2);
    ctx.fill();

    // 7. 空气刘海与鬓角发丝（覆盖额头，立体层次）
    var hairGrad = ctx.createLinearGradient(200, 175, 385, 340);
    hairGrad.addColorStop(0, '#181012');
    hairGrad.addColorStop(0.55, '#2b1b1c');
    hairGrad.addColorStop(1, '#4c2c24');
    ctx.fillStyle = hairGrad;
    ctx.beginPath();
    ctx.moveTo(202, 298);
    ctx.bezierCurveTo(194, 218, 240, 168, 298, 170);
    ctx.bezierCurveTo(356, 172, 396, 222, 388, 304);
    ctx.bezierCurveTo(378, 260, 362, 242, 346, 276);
    ctx.bezierCurveTo(334, 238, 314, 232, 302, 272);
    ctx.bezierCurveTo(286, 236, 262, 238, 250, 276);
    ctx.bezierCurveTo(234, 246, 214, 264, 202, 298);
    ctx.closePath();
    ctx.fill();

    // 两侧修饰脸颊的碎发
    ctx.fillStyle = '#1e1416';
    ctx.beginPath();
    ctx.moveTo(212, 266);
    ctx.bezierCurveTo(202, 336, 208, 404, 226, 444);
    ctx.bezierCurveTo(218, 390, 222, 332, 228, 274);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(376, 268);
    ctx.bezierCurveTo(384, 336, 376, 402, 358, 446);
    ctx.bezierCurveTo(364, 390, 362, 334, 360, 276);
    ctx.closePath();
    ctx.fill();

    // 8. 复古 35mm 旁轴胶片机与双手（呼应暗房主题，增加精密金属/皮质质感）
    // 相机机身
    ctx.fillStyle = '#1a1a1e';
    ctx.fillRect(218, 578, 164, 108);
    // 银色机顶
    var topPlate = ctx.createLinearGradient(218, 578, 382, 608);
    topPlate.addColorStop(0, '#c8cfd6');
    topPlate.addColorStop(0.5, '#f2f5f8');
    topPlate.addColorStop(1, '#9ca4ae');
    ctx.fillStyle = topPlate;
    ctx.fillRect(218, 578, 164, 28);
    // 快门旋钮与取景窗
    ctx.fillStyle = '#aeb6c0';
    ctx.fillRect(236, 568, 22, 10);
    ctx.fillRect(344, 570, 18, 8);
    ctx.fillStyle = '#151922';
    ctx.fillRect(320, 584, 26, 15);
    ctx.fillStyle = 'rgba(130, 200, 255, 0.35)';
    ctx.fillRect(323, 586, 10, 6);

    // 镜头外圈（金属银 + 镀膜玻璃）
    ctx.fillStyle = '#d4dbe2';
    ctx.beginPath();
    ctx.arc(298, 636, 40, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#202228';
    ctx.beginPath();
    ctx.arc(298, 636, 33, 0, Math.PI * 2);
    ctx.fill();
    var lensGrad = ctx.createRadialGradient(290, 628, 4, 298, 636, 24);
    lensGrad.addColorStop(0, '#5a7ea8');
    lensGrad.addColorStop(0.5, '#1d273c');
    lensGrad.addColorStop(1, '#0c0f18');
    ctx.fillStyle = lensGrad;
    ctx.beginPath();
    ctx.arc(298, 636, 23, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 245, 224, 0.72)';
    ctx.beginPath();
    ctx.ellipse(290, 627, 6, 3.2, -0.5, 0, Math.PI * 2);
    ctx.fill();

    // 双手托举相机
    ctx.fillStyle = '#ebb99c';
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(190, 598, 34, 72, 14) : ctx.fillRect(190, 598, 34, 72);
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(376, 598, 34, 72, 14) : ctx.fillRect(376, 598, 34, 72);
    ctx.fill();

    // 9. 轻柔的画面暖色晕光收尾
    var flare = ctx.createRadialGradient(460, 250, 10, 460, 250, 440);
    flare.addColorStop(0, 'rgba(255, 232, 184, 0.24)');
    flare.addColorStop(0.5, 'rgba(255, 178, 126, 0.08)');
    flare.addColorStop(1, 'rgba(255, 178, 126, 0)');
    ctx.fillStyle = flare;
    ctx.fillRect(0, 0, w, h);

    ctx.restore();
    portraitSampleCache = c;
    return c;
  }

  /* ---------- 棱镜碎冰多面体纹理（中心主体避让：中心柔和通透，四周晶面锐利） ---------- */
  function getPrismTexture() {
    if (prismTexUrl) return prismTexUrl;
    try {
      var size = 240, cols = 8, rows = 8;
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
          var jx = (col === 0 || col === cols) ? 0 : (rand() - 0.5) * stepX * 0.68;
          var jy = (r === 0 || r === rows) ? 0 : (rand() - 0.5) * stepY * 0.68;
          pts[r][col] = { x: col * stepX + jx, y: r * stepY + jy };
        }
      }
      function drawTri(a, b, d) {
        var cx = (a.x + b.x + d.x) / 3;
        var cy = (a.y + b.y + d.y) / 3;
        // 距离中心越近，晶面明暗对比越柔和，避免遮挡人像面部主体
        var dx = (cx - size * 0.5) / (size * 0.5);
        var dy = (cy - size * 0.45) / (size * 0.5);
        var dist = Math.min(1, Math.sqrt(dx * dx + dy * dy));
        var edgeWeight = 0.22 + 0.78 * Math.pow(dist, 1.35);
        var lum = Math.floor(24 + rand() * 215 * edgeWeight);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.lineTo(d.x, d.y);
        ctx.closePath();
        ctx.fillStyle = 'rgb(' + lum + ',' + lum + ',' + lum + ')';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,' + (0.06 + 0.20 * edgeWeight).toFixed(2) + ')';
        ctx.lineWidth = 0.5;
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
      var sw = stage.clientWidth - 40, sh = stage.clientHeight - (isIntro ? 16 : 24);
      var hw = (sh - 24) / aspect + 24;
      var w = Math.min(sw, hw, isIntro ? 304 : 360);
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
    var extraH = 22;
    if (caption) extraH += Math.max(18, caption.offsetHeight) + 8;
    if (tip) extraH += Math.max(16, tip.offsetHeight) + 6;
    var sw = stage.clientWidth - 36;
    var sh = stage.clientHeight - extraH;
    var hw = sh * (55 / 85);
    var w = Math.min(sw, hw, 316);
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
        small.width = 360; small.height = 480;
        Film.drawFit(makePortraitSample(), small);
        var shot = Film.develop(small, { dev: 1, uneven: 0, fix: 1, leak: false, dust: false });
        Film.drawFit(shot, preview);
      } catch (e) { /* 示例图失败不影响使用 */ }
    }, 30);

    $('pick-input').addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file || state.busy) return;
      state.busy = true;
      setStatus('intro-status', '正在准备照片…');
      Film.loadImage(file).then(function (image) {
        state.busy = false;
        startCrop(image);
      }, function () {
        state.busy = false;
        setStatus('intro-status', '这张照片暂时读不出来，换一张试试');
      });
      e.target.value = '';
    });

    $('use-sample').addEventListener('click', function () {
      if (state.busy) return;
      state.busy = true;
      var sample = new Image();
      sample.onload = function () {
        state.busy = false;
        startCrop(sample);
      };
      function failSample() {
        state.busy = false;
        setStatus('intro-status', '样片暂时无法打开，可以选一张自己的照片');
      }
      sample.onerror = failSample;
      try { sample.src = makePortraitSample().toDataURL('image/png'); }
      catch (err) { failSample(); }
    });
    $('use-sample').disabled = false;
    setStatus('intro-status', '');
  }

  /* ---------- 选定裁剪范围 ---------- */
  function paintCrop() {
    var image = cropState.image;
    var box = Film.cropBounds(image, cropState.ratio, cropState.zoom, cropState.x, cropState.y);
    cropState.bounds = box;
    cropState.x = (box.x + box.w / 2) / image.naturalWidth;
    cropState.y = (box.y + box.h / 2) / image.naturalHeight;
    var style = $('crop-box').style;
    style.left = box.x / image.naturalWidth * 100 + '%';
    style.top = box.y / image.naturalHeight * 100 + '%';
    style.width = box.w / image.naturalWidth * 100 + '%';
    style.height = box.h / image.naturalHeight * 100 + '%';
  }

  function fitCrop() {
    if (!cropState) return;
    var stage = $('crop-stage'), frame = $('crop-frame'), image = cropState.image;
    var size = Math.min((stage.clientWidth - 32) / image.naturalWidth, (stage.clientHeight - 12) / image.naturalHeight);
    frame.style.width = Math.max(1, image.naturalWidth * size) + 'px';
    frame.style.height = Math.max(1, image.naturalHeight * size) + 'px';
  }

  function setCropGridVisible(active, holdMs) {
    if (!cropState) return;
    var frame = $('crop-frame');
    clearTimeout(cropState.gridTimer);
    cropState.gridTimer = 0;
    if (active) {
      if (frame.className !== 'crop-frame is-interacting') frame.className = 'crop-frame is-interacting';
      if (holdMs) {
        cropState.gridTimer = setTimeout(function () {
          if (cropState) cropState.gridTimer = 0;
          if (!cropState || !cropState.pointers.length) frame.className = 'crop-frame';
        }, holdMs);
      }
    } else {
      cropState.gridTimer = setTimeout(function () {
        if (cropState) cropState.gridTimer = 0;
        if (!cropState || !cropState.pointers.length) frame.className = 'crop-frame';
      }, holdMs || 220);
    }
  }

  function describeOriginalAspect(w, h) {
    if (!w || !h) return '原图';
    var r = w / h;
    var presets = [
      [16 / 9, '16:9'], [3 / 2, '3:2'], [4 / 3, '4:3'], [1, '1:1'],
      [3 / 4, '3:4'], [2 / 3, '2:3'], [9 / 16, '9:16'], [55 / 85, '55:85']
    ];
    for (var i = 0; i < presets.length; i += 1) {
      if (Math.abs(r - presets[i][0]) < 0.008) return '原图 · ' + presets[i][1];
    }
    return r >= 1 ? ('原图 · ' + r.toFixed(1) + ':1') : ('原图 · 1:' + (1 / r).toFixed(1));
  }

  function applyCropZoom(val) {
    if (!cropState) return;
    var z = Math.max(1, Math.min(3, val));
    cropState.zoom = z;
    var input = $('crop-zoom');
    if (input) input.value = z.toFixed(2);
    var zoomVal = $('crop-zoom-val');
    if (zoomVal) zoomVal.textContent = z.toFixed(1) + '×';
    paintCrop();
  }

  function selectCropRatio(format) {
    var image = cropState.image;
    var horizontal = image.naturalWidth >= image.naturalHeight;
    var badgeText = '原图';
    if (format === 'original') {
      cropState.ratio = image.naturalWidth / image.naturalHeight;
      badgeText = describeOriginalAspect(image.naturalWidth, image.naturalHeight);
    } else if (format === 'card') {
      cropState.ratio = Film.cardPhotoAspect;
      badgeText = '小卡同框 · 55:85';
    } else {
      var sides = format.split(':');
      var ratio = Number(sides[0]) / Number(sides[1]);
      cropState.ratio = horizontal ? ratio : 1 / ratio;
      var ratioStr = horizontal ? format : sides.slice().reverse().join(':');
      if (format === '3:2') badgeText = '35mm 全格 · ' + ratioStr;
      else if (format === '4:3') badgeText = '35mm 半格 · ' + ratioStr;
      else badgeText = '120 方幅 · 1:1';
    }
    var ratiosEl = $('crop-ratios');
    ratiosEl.className = horizontal ? 'crop-ratios' : 'crop-ratios is-portrait';
    var buttons = ratiosEl.querySelectorAll('button');
    for (var i = 0; i < buttons.length; i++) {
      var value = buttons[i].getAttribute('data-ratio');
      var label = buttons[i].querySelector('.crop-ratio-number');
      if (label) label.textContent = horizontal ? value : value.split(':').reverse().join(':');
      buttons[i].setAttribute('aria-pressed', String(value === format));
    }
    var badge = $('crop-format-badge');
    if (badge) badge.textContent = badgeText;
    $('crop-hint').textContent = Math.abs(cropState.ratio - Film.cardPhotoAspect) < 1e-9
      ? '此画幅与小卡满版同框' : '';
    paintCrop();
  }

  function startCrop(image) {
    cropState = { image: image, zoom: 1, x: 0.5, y: 0.5, drag: null, pointers: [], pinchDist: 0, pinchZoom: 1, gridTimer: 0 };
    image.className = 'crop-source';
    image.draggable = false;
    image.alt = '';
    $('crop-frame').className = 'crop-frame';
    $('crop-frame').appendChild(image);
    $('crop-zoom').value = '1';
    var zoomVal = $('crop-zoom-val');
    if (zoomVal) zoomVal.textContent = '1.0×';
    setStatus('crop-status', '');
    setStatus('intro-status', '');
    selectCropRatio('original');
    show('crop');
    fitCrop();
    $('crop-title').focus();
  }

  function clearCrop() {
    clearTimeout(cropState.gridTimer);
    $('crop-frame').className = 'crop-frame';
    $('crop-frame').removeChild(cropState.image);
    cropState = null;
  }

  function bindCrop() {
    var frame = $('crop-frame');
    var buttons = $('crop-ratios').querySelectorAll('button');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].addEventListener('click', function (e) {
        selectCropRatio(e.currentTarget.getAttribute('data-ratio'));
      });
    }
    $('crop-zoom').addEventListener('input', function (e) {
      setCropGridVisible(true, 360);
      applyCropZoom(Number(e.target.value));
    });
    $('crop-zoom-val').addEventListener('click', function () {
      if (!cropState) return;
      cropState.x = 0.5;
      cropState.y = 0.5;
      setCropGridVisible(true, 320);
      applyCropZoom(1);
    });
    function findPtr(id) {
      if (!cropState) return -1;
      for (var k = 0; k < cropState.pointers.length; k += 1) {
        if (cropState.pointers[k].id === id) return k;
      }
      return -1;
    }
    function ptrDist(a, b) {
      var dx = a.x - b.x, dy = a.y - b.y;
      return Math.sqrt(dx * dx + dy * dy);
    }
    frame.addEventListener('pointerdown', function (e) {
      if (!cropState || e.button !== 0) return;
      if (findPtr(e.pointerId) >= 0 || cropState.pointers.length === 2) return;
      cropState.pointers.push({ id: e.pointerId, x: e.clientX, y: e.clientY });
      if (cropState.pointers.length === 1) {
        cropState.drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
      } else if (cropState.pointers.length === 2) {
        cropState.drag = null;
        cropState.pinchDist = Math.max(10, ptrDist(cropState.pointers[0], cropState.pointers[1]));
        cropState.pinchZoom = cropState.zoom;
      }
      setCropGridVisible(true);
      if (frame.setPointerCapture) { try { frame.setPointerCapture(e.pointerId); } catch (err) { /* 指针已释放 */ } }
    });
    frame.addEventListener('pointermove', function (e) {
      if (!cropState) return;
      var idx = findPtr(e.pointerId);
      if (idx < 0) return;
      cropState.pointers[idx].x = e.clientX;
      cropState.pointers[idx].y = e.clientY;
      if (cropState.pointers.length === 2 && cropState.pinchDist > 0) {
        var d = ptrDist(cropState.pointers[0], cropState.pointers[1]);
        applyCropZoom(cropState.pinchZoom * (d / cropState.pinchDist));
        return;
      }
      var drag = cropState.drag;
      if (!drag || drag.id !== e.pointerId) return;
      var area = frame.getBoundingClientRect();
      cropState.x += (e.clientX - drag.x) / area.width;
      cropState.y += (e.clientY - drag.y) / area.height;
      drag.x = e.clientX;
      drag.y = e.clientY;
      paintCrop();
    });
    function release(e) {
      if (!cropState) return;
      var idx = findPtr(e.pointerId);
      if (idx < 0) return;
      cropState.pointers.splice(idx, 1);
      if (cropState.pointers.length === 1) {
        var rem = cropState.pointers[0];
        cropState.drag = { id: rem.id, x: rem.x, y: rem.y };
        cropState.pinchDist = 0;
      } else if (cropState.pointers.length === 0) {
        cropState.drag = null;
        cropState.pinchDist = 0;
        setCropGridVisible(false, 220);
      }
    }
    frame.addEventListener('pointerup', release);
    frame.addEventListener('pointercancel', release);
    frame.addEventListener('lostpointercapture', release);
    frame.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    var directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    frame.addEventListener('keydown', function (e) {
      var direction = directions[e.key];
      if (!direction) return;
      e.preventDefault();
      cropState.x += direction[0] * 0.02;
      cropState.y += direction[1] * 0.02;
      setCropGridVisible(true, 450);
      paintCrop();
    });
    $('crop-cancel').addEventListener('click', function () {
      clearCrop();
      show('intro');
      $('pick-input').focus();
    });
    $('crop-apply').addEventListener('click', function () {
      var photo;
      try {
        photo = Film.cropToCanvas(cropState.image, cropState.bounds);
      } catch (err) {
        setStatus('crop-status', '这张照片暂时无法裁剪，请返回重选。');
        return;
      }
      clearCrop();
      startDevelop(photo);
    });
  }

  /* ---------- 显影 ---------- */
  function startDevelop(base) {
    state.base = base;
    state.aspect = base.height / base.width;
    state.dev = 0; state.devTime = 0; state.agiSum = 0; state.agi = 0; state.agiTarget = 0;
    state.fix = 0; state.prints = null;

    var canvas = $('develop-canvas');
    canvas.width = Math.round(base.width / 2);
    canvas.height = Math.round(base.height / 2);
    Film.drawFit(base, canvas);
    paintDevelop(canvas, 0);

    $('pull-out').disabled = true;
    $('pull-out').className = 'btn btn-ghost';
    $('dev-time').textContent = '00:00';
    $('dev-meter').style.transform = 'scaleX(0)';
    $('dev-readout').className = 'readout-box';
    $('tray-guide').className = 'tray-guide';
    $('tray-paper').className = 'tray-paper';
    $('dev-reselect').hidden = true;
    $('screen-develop').className = 'screen screen-develop is-exposing';
    setStatus('dev-hint', '放大曝光…');
    show('develop');
    Bridge.vibrate('light');
    setTimeout(beginDevelop, EXPOSURE_MS);
  }

  function beginDevelop() {
    $('screen-develop').className = 'screen screen-develop';
    $('dev-reselect').hidden = false;
    if (!isReducedMotion()) $('tray-paper').className = 'tray-paper is-dipping';
    setStatus('dev-hint', '轻晃手机，或用指尖轻划药液');
    state.lastTs = 0;
    state.developing = true;
    // 每轮一个独立回调，避免上一轮迟到的结果影响当前订阅。
    var round = ++state.gyroRound;
    var cb = function (f) { onGyro(f); };
    state.gyroCbs.push(cb);
    Bridge.startGyro(cb).then(function (ok) {
      var i = state.gyroCbs.indexOf(cb);
      if (i < 0) return;                       // 已经捞出、被释放了，迟到的确认不再加回
      if (!ok) state.gyroCbs.splice(i, 1);
      if (round !== state.gyroRound) return;
      state.gyroOn = ok;
      if (!ok && state.dev < 0.9) setStatus('dev-hint', '用指尖轻轻划过药液');
    });
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

    state.devTime += dt;
    state.dev = Math.min(2, state.devTime * DEVELOP_RATE);
    state.agiSum += Math.min(1, state.agi / 0.25) * dt;

    paintDevelop($('develop-canvas'), state.dev);

    // 增强液体流动可见度：更明显的斜向波浪位移、轻微缩放与动态反光强度（减少动态效果时保持静态液面）
    var reduced = isReducedMotion();
    var liquid = $('tray-liquid');
    var tt = ts / 1000, amp = state.agi;
    if (reduced) {
      if (liquid.style.transform || liquid.style.webkitTransform) {
        liquid.style.transform = liquid.style.webkitTransform = '';
      }
      if (liquid.style.opacity !== '0.42') liquid.style.opacity = '0.42';
    } else {
      var tx = Math.sin(tt * 5.8) * (2.5 + amp * 13.5);
      var ty = Math.cos(tt * 4.4) * (1.8 + amp * 9.5);
      var sc = 1 + amp * 0.06;
      var rot = Math.sin(tt * 3.2) * amp * 3.5;
      liquid.style.transform = liquid.style.webkitTransform =
        'translate(' + tx.toFixed(2) + '%,' + ty.toFixed(2) + '%) scale(' + sc.toFixed(3) + ') rotate(' + rot.toFixed(2) + 'deg)';
      liquid.style.opacity = (0.36 + amp * 0.62).toFixed(2);
    }

    // 晃动强烈时在药盘内自动激起轻柔波纹，直接用百分比坐标避免读布局
    if (amp > 0.45 && !reduced) {
      var now = Date.now();
      if (now - state.lastSloshRippleTs > 320) {
        state.lastSloshRippleTs = now;
        spawnRipplePct(24 + Math.random() * 52, 24 + Math.random() * 52);
      }
    }

    // 2 秒零晃动时的轻量手势微提示（仅在状态变化时写 className）
    var guide = $('tray-guide');
    if (guide) {
      var shouldGuide = state.devTime > 1.8 && state.agiSum < 0.08 && amp < 0.12;
      var guideCls = shouldGuide ? 'tray-guide is-guiding' : 'tray-guide';
      if (guide.className !== guideCls) guide.className = guideCls;
    }

    // 用 GPU 合成 transform: scaleX 替代 width 避免重排
    var meter = $('dev-meter');
    var sx = 'scaleX(' + clamp01(amp).toFixed(3) + ')';
    meter.style.webkitTransform = sx;
    meter.style.transform = sx;

    var readoutBox = $('dev-readout');
    if (readoutBox) {
      var readoutCls = amp > 0.18 ? 'readout-box is-flowing' : 'readout-box';
      if (readoutBox.className !== readoutCls) readoutBox.className = readoutCls;
    }

    var sec = Math.floor(state.devTime);
    $('dev-time').textContent = pad(Math.floor(sec / 60), 2) + ':' + pad(sec % 60, 2);

    var devScreen = $('screen-develop');
    if (devScreen) {
      var isSweet = state.dev >= 0.9 && state.dev <= 1.12;
      var sweetCls = isSweet ? 'screen screen-develop is-sweet' : 'screen screen-develop';
      if (devScreen.className !== sweetCls) {
        devScreen.className = sweetCls;
        if (isSweet) setStatus('dev-hint', '可以取出相纸');
        if (isSweet && state.sweetBuzzedRound !== state.round) {
          state.sweetBuzzedRound = state.round;
          Bridge.vibrate('light');
        }
      }
    }

    var pullBtn = $('pull-out');
    if (state.dev > 0.25) pullBtn.disabled = false;
    // 影像初步显出后允许取出，到自然影调时突出按钮。
    var pullCls = state.dev > 0.8 ? 'btn btn-primary' : 'btn btn-ghost';
    if (pullBtn.className !== pullCls) pullBtn.className = pullCls;
    var hint = $('dev-hint');
    if (state.dev > 1.35 && hint.textContent !== '影调已深，可以取出相纸') {
      hint.textContent = '影调已深，可以取出相纸';
    }

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

  function spawnRipplePct(pctX, pctY) {
    var box = $('tray-ripples');
    if (!box) return;
    var dot = document.createElement('span');
    dot.className = 'tray-ripple';
    dot.style.left = Math.round(pctX) + '%';
    dot.style.top = Math.round(pctY) + '%';
    box.appendChild(dot);
    setTimeout(function () {
      if (dot.parentNode) dot.parentNode.removeChild(dot);
    }, 740);
  }

  function spawnRipple(clientX, clientY, force) {
    var now = Date.now();
    if (!force) {
      if (now - state.lastRippleTs < 100) return;
      var dx = clientX - state.lastRippleX;
      var dy = clientY - state.lastRippleY;
      if (dx * dx + dy * dy < 14 * 14) return;
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
    }, 740);
  }

  function bindTrayRub() {
    var tray = $('tray'), last = null;
    tray.style.touchAction = 'none';
    // 只跟踪第一根手指：多指各自的坐标混在一起会算出虚高的流动速度
    tray.addEventListener('pointerdown', function (e) {
      if (!state.developing || last) return;
      last = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp };
      spawnRipple(e.clientX, e.clientY, true);
      if (tray.setPointerCapture) { try { tray.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ } }
    });
    tray.addEventListener('pointermove', function (e) {
      if (!state.developing || !last || e.pointerId !== last.id) return;
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
    if (!state.developing || $('pull-out').disabled) return;
    $('pull-out').disabled = true;
    stopDevelopLoop();
    var devScreen = $('screen-develop');
    if (devScreen) devScreen.className = 'screen screen-develop';
    Bridge.vibrate('medium');
    var fixCanvas = $('fix-canvas'), devCanvas = $('develop-canvas');
    fixCanvas.width = devCanvas.width; fixCanvas.height = devCanvas.height;
    Film.drawFit(state.base, fixCanvas);
    paintDevelop(fixCanvas, state.dev);
    state.fix = 0;
    state.lastFixSec = 0;
    var fixTray = document.querySelector('.tray-fix');
    var fixRed = document.querySelector('.tray-fix .tray-red');
    if (fixTray) fixTray.classList.remove('is-fixed');
    if (fixRed) fixRed.style.opacity = '';
    $('fix-fill').style.width = '0';
    $('fix-text').textContent = '长按定影 · 4 秒';
    setStatus('fix-hint', '停显…');
    $('fix-hold').hidden = false;
    $('fix-hold').disabled = true;
    $('fix-hold').className = 'btn btn-hold';
    $('lights-on').className = 'btn btn-ghost';
    $('lights-on').hidden = true;
    $('step-fix').className = 'is-on';
    $('step-light').className = '';
    $('screen-fix').className = 'screen screen-fix is-stopping';
    show('fix');
    setTimeout(function () {
      $('screen-fix').className = 'screen screen-fix';
      setStatus('fix-hint', '');
      $('fix-hold').disabled = false;
    }, STOP_BATH_MS);
  }

  /* ---------- 定影：按住计时 ---------- */
  function bindFix() {
    var btn = $('fix-hold');
    var fixTray = document.querySelector('.tray-fix');
    var fixRed = document.querySelector('.tray-fix .tray-red');
    function step() {
      if (!state.fixHolding) return;
      var now = Date.now();
      state.fix = Math.min(1, state.fix + (now - state.fixTimer) / 1000 / FIX_SECONDS);
      state.fixTimer = now;
      $('fix-fill').style.width = Math.round(state.fix * 100) + '%';
      if (fixRed) fixRed.style.opacity = (1 - state.fix * 0.16).toFixed(3);
      if (state.fix >= 1) {
        state.fixHolding = false;
        holdBy = null;
        if (fixTray) fixTray.classList.add('is-fixed');
        btn.className = 'btn btn-hold is-done';
        btn.disabled = true;
        $('fix-text').textContent = '定影完成';
        setStatus('fix-hint', '水洗相纸…');
        $('screen-fix').className = 'screen screen-fix is-washing';
        $('step-fix').className = 'is-done';
        $('step-light').className = 'is-on';
        Bridge.vibrate('light');
        setTimeout(lightsOn, WASH_MS);
        return;
      }
      var leftSec = Math.max(1, Math.ceil((1 - state.fix) * FIX_SECONDS));
      if (leftSec !== state.lastFixSec) {
        state.lastFixSec = leftSec;
        $('fix-text').textContent = '定影中 · ' + leftSec + ' 秒';
      }
      fixRaf = requestAnimationFrame(step);
    }
    // holdBy 记录是谁在按：pointerId，或键盘 'key'；其他手指的按下和抬起一律忽略
    var holdBy = null, fixRaf = 0;
    function startHold(by) {
      if (btn.disabled || state.fix >= 1 || state.fixHolding) return;
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
        $('fix-text').textContent = '继续长按';
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
    // 切到后台时结束按压，回来不会把后台时间算进定影
    document.addEventListener('visibilitychange', function () { if (document.hidden) release(); });
    btn.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }

  // 基础权重与显影结果无关。未集齐时，会话前两张优先给未收集款。
  var MATERIAL_WEIGHTS = {
    prism: 5, noir: 5, cateye: 9, sparkle: 9, etched: 9, chrome: 9,
    rainbow: 18, pearl: 18, sunleak: 18
  };
  var sessionDraws = 0, sessionDupes = 0;

  function pickMaterial() {
    var onlyNew = sessionDraws < 2 && state.collected.length < MATERIALS.length;
    var total = 0;
    var weights = MATERIALS.map(function (key) {
      var collected = state.collected.indexOf(key) >= 0;
      var weight = MATERIAL_WEIGHTS[key];
      if (collected && onlyNew) weight = 0;
      if (!collected && sessionDupes >= 2) weight *= 2;
      total += weight;
      return weight;
    });
    var roll = Math.random() * total;
    var picked = MATERIALS[MATERIALS.length - 1];
    for (var i = 0; i < MATERIALS.length; i += 1) {
      if (roll < weights[i]) { picked = MATERIALS[i]; break; }
      roll -= weights[i];
    }
    sessionDraws += 1;
    sessionDupes = state.collected.indexOf(picked) >= 0 ? sessionDupes + 1 : 0;
    return picked;
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
    if (previewState.open) return $('preview-modal');
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
        if (previewState.open) closePreview();
        else if (cardState.binderOpen) closeBinder();
        else if (cardState.framing) closeCardFraming();
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

  function setTransform(el, val) {
    if (!el) return;
    el.style.webkitTransform = val;
    el.style.transform = val;
  }

  function applyCardVisual(rx, ry) {
    var tilt = $('holo-tilt');
    var card = $('holo-card');
    var shadow = $('holo-shadow');
    var edges = $('holo-edges');
    var fx = $('holo-fx');
    var glare = $('holo-glare');
    var rim = $('holo-rim');
    var back = $('holo-back');
    var backShine = $('holo-back-shine');
    var backGlare = $('holo-back-glare');
    var backRim = $('holo-back-rim');
    var reduced = isReducedMotion();

    if (reduced) {
      cardState.lastDraw = '';
      setTransform(tilt, '');
      setTransform(card, '');
      setTransform(shadow, '');
      setTransform($('card-photo'), '');
      setTransform($('holo-back-watermark'), '');
      if (edges && edges.className !== 'holo-edges') edges.className = 'holo-edges';
      return;
    }

    var turn = cardState.turn;
    var charge = cardState.charge;
    var lx = cardState.lx;
    var ly = cardState.ly;
    var on = cardState.on;
    var dash = cardState.dashAngle;
    var drawKey = rx.toFixed(2) + ',' + ry.toFixed(2) + ',' + turn.toFixed(2) + ',' +
      charge.toFixed(3) + ',' + lx.toFixed(1) + ',' + ly.toFixed(1) + ',' +
      on.toFixed(2) + ',' + dash.toFixed(1) + ',' + (cardState.revealed ? 1 : 0) + ',' +
      (cardState.lowPerf ? 1 : 0);
    if (drawKey === cardState.lastDraw) return;
    cardState.lastDraw = drawKey;

    var rad = Math.PI / 180;
    var turnRad = turn * rad;
    var liftFrac = Math.abs(Math.sin(turnRad));
    var showingFront = Math.cos(turnRad) >= 0;

    // 1. 倾斜 + 翻面弹簧 + 抬升 + 揭晓蓄力
    setTransform(tilt, 'rotateX(' + rx.toFixed(2) + 'deg) rotateY(' + ry.toFixed(2) + 'deg)');
    var tz = liftFrac * 40 + charge * 18;
    var flipTf = 'translateZ(' + tz.toFixed(2) + 'px) rotateY(' + turn.toFixed(2) + 'deg)';
    if (charge > 0.002) flipTf += ' scale(' + (1 - charge * 0.03).toFixed(4) + ')';
    setTransform(card, flipTf);

    // 2. 地面落影（向抬起反方向漂移，侧转时收窄并下沉）
    if (shadow && !cardState.lowPerf) {
      var shx = (-ry * 1.8).toFixed(1);
      var shy = (rx * 1.2 + liftFrac * 14).toFixed(1);
      var shScale = (1 - liftFrac * 0.45).toFixed(3);
      setTransform(shadow, 'translate3d(' + shx + 'px,' + shy + 'px,0) scaleX(' + shScale + ')');
    }

    // 3. 10px 切边切片（仅在翻转经过侧面且非低端机时显现，揭晓前保持暗房中性色）
    if (edges) {
      var showEdges = !cardState.lowPerf && liftFrac > 0.04;
      var edgeCls = 'holo-edges' + (showEdges ? ' is-showing' : '') + (cardState.revealed ? ' is-revealed' : '');
      if (edges.className !== edgeCls) edges.className = edgeCls;
    }

    if (cardState.lowPerf) return;

    var nx = clamp11(ry / 12);
    var ny = clamp11(-rx / 12);
    var hyp = Math.min(1, Math.sqrt(nx * nx + ny * ny));
    var sinX = Math.sin(rx * rad);

    // 4. 仅更新当前可见面的光照、反光、动态边光与多层景深视差
    if (showingFront) {
      var px = lx.toFixed(1) + '%';
      var py = ly.toFixed(1) + '%';
      var bgx = (50 + (lx - 50) * 0.92).toFixed(1) + '%';
      var bgy = (50 + (ly - 50) * 0.92).toFixed(1) + '%';
      if (fx) {
        fx.style.setProperty('--px', px);
        fx.style.setProperty('--py', py);
        fx.style.setProperty('--bgx', bgx);
        fx.style.setProperty('--bgy', bgy);
        fx.style.setProperty('--hyp', Math.min(1, Math.max(hyp, on * 0.72)).toFixed(3));
      }
      if (glare) {
        var gx = ((lx - 50) * 0.5).toFixed(2);
        var gy = ((ly - 50) * 0.5).toFixed(2);
        setTransform(glare, 'translate3d(' + gx + '%,' + gy + '%,0)');
        var mat = (cardState.sampleMode ? cardState.sampleMat : state.material) || 'rainbow';
        var gOp = (mat === 'prism' || mat === 'noir') ? (0.26 + on * 0.44) :
          (mat === 'pearl' ? (0.46 + on * 0.46) :
          (mat === 'etched' ? (0.20 + on * 0.40) :
          (mat === 'cateye' ? (0.30 + on * 0.50) : (0.34 + on * 0.56))));
        glare.style.opacity = gOp.toFixed(3);
      }
      if (rim) {
        rim.style.opacity = (0.60 + on * 0.40).toFixed(3);
      }
      // 照片窗随倾斜产生视差，预放大以覆盖移动时的边缘。
      var sinYf = Math.sin((ry + turn) * rad);
      setTransform($('card-photo'),
        'translate3d(' + (-22 * sinYf).toFixed(2) + 'px,' + (22 * sinX).toFixed(2) + 'px,0) scale(1.09)');
    } else {
      var blx = 100 - lx;
      var bpx = blx.toFixed(1) + '%';
      var bpy = ly.toFixed(1) + '%';
      if (back) {
        back.style.setProperty('--px', bpx);
        back.style.setProperty('--py', bpy);
      }
      if (backShine) {
        backShine.style.setProperty('--px', bpx);
        backShine.style.setProperty('--py', bpy);
      }
      if (backGlare) {
        var bgx2 = ((blx - 50) * 0.5).toFixed(2);
        var bgy2 = ((ly - 50) * 0.5).toFixed(2);
        setTransform(backGlare, 'translate3d(' + bgx2 + '%,' + bgy2 + '%,0)');
        backGlare.style.opacity = (0.32 + on * 0.48).toFixed(3);
      }
      if (backRim) {
        backRim.style.opacity = (0.60 + on * 0.40).toFixed(3);
      }
      // 背面多层景深视差：水印 +32、外环 +22、虚线环 +14（逆转）、叶片 +8、红点 -6
      var sinYb = Math.sin((ry + turn - 180) * rad);
      setTransform($('holo-back-watermark'),
        'translate3d(' + (-32 * sinYb).toFixed(2) + 'px,' + (32 * sinX).toFixed(2) + 'px,0)');
      var svgScale = 1.25;
      var elOuter = $('emblem-outer');
      var elDash = $('emblem-dash');
      var elBlades = $('emblem-blades');
      var elCore = $('emblem-core');
      if (elOuter) {
        elOuter.setAttribute('transform', 'translate(' + (-22 * sinYb * svgScale).toFixed(2) + ',' + (22 * sinX * svgScale).toFixed(2) + ')');
      }
      if (elDash) {
        elDash.setAttribute('transform', 'translate(' + (-14 * sinYb * svgScale).toFixed(2) + ',' + (14 * sinX * svgScale).toFixed(2) + ') rotate(' + dash.toFixed(1) + ',60,60)');
      }
      if (elBlades) {
        elBlades.setAttribute('transform', 'translate(' + (-8 * sinYb * svgScale).toFixed(2) + ',' + (8 * sinX * svgScale).toFixed(2) + ')');
      }
      if (elCore) {
        elCore.setAttribute('transform', 'translate(' + (6 * sinYb * svgScale).toFixed(2) + ',' + (-6 * sinX * svgScale).toFixed(2) + ')');
      }
    }
  }

  function cardTick(ts) {
    if (!cardState.open || cardState.binderOpen) return;
    if (isReducedMotion()) {
      cardState.rx = 0; cardState.ry = 0; cardState.vx = 0; cardState.vy = 0;
      cardState.turn = cardState.flipped ? 180 : 0; cardState.vTurn = 0; cardState.charge = 0;
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
    var targetLx = 34, targetLy = 22, onTarget = 0;
    var hasActiveInput = cardState.dragging || (now - cardState.lastInputTs < 420) ||
      (cardState.hovering && !cardState.sweeping);

    if (hasActiveInput) {
      cardState.sweeping = false;
      targetRy = cardState.tx * 12;
      targetRx = -cardState.ty * 12;
      targetLx = (cardState.tx + 1) * 50;
      targetLy = (cardState.ty + 1) * 50;
      onTarget = 1;
    } else if (cardState.sweeping) {
      var p = (now - cardState.sweepStart) / 760;
      if (p >= 1) {
        cardState.sweeping = false;
      } else if (p >= 0) {
        var env = Math.sin(p * Math.PI);
        var sweepX = -Math.cos(p * Math.PI) * 0.72 * env;
        var sweepY = -Math.cos(p * Math.PI) * 0.48 * env;
        targetRy = sweepX * 12;
        targetRx = -sweepY * 12;
        targetLx = (sweepX + 1) * 50;
        targetLy = (sweepY + 1) * 50;
        onTarget = env;
      }
    } else {
      // Standard 双频手持呼吸微晃，光点随之在左上方自然游动
      var t = ts / 1000;
      targetRx = 2.2 * Math.sin(0.9 * t + 0.6) + 0.8 * Math.sin(2.3 * t);
      targetRy = 3.2 * Math.sin(0.7 * t) + 0.9 * Math.sin(1.9 * t + 1.2);
      targetLx = clamp01((34 + cardState.ry * 3) / 100) * 100;
      targetLy = clamp01((22 - cardState.rx * 3) / 100) * 100;
    }

    // 2 步子积分保证低帧率下 140/160 弹簧绝对稳定
    var steps = dt > 0.022 ? 2 : 1;
    var subDt = dt / steps;
    var targetTurn = cardState.flipped ? 180 : 0;
    var chargeTarget = cardState.revealing ? 1 : 0;
    for (var s = 0; s < steps; s += 1) {
      // 倾斜弹簧（140 / 15，带微弱回弹）
      var ax = (targetRx - cardState.rx) * 140 - cardState.vx * 15;
      var ay = (targetRy - cardState.ry) * 140 - cardState.vy * 15;
      cardState.vx += ax * subDt;
      cardState.vy += ay * subDt;
      cardState.rx += cardState.vx * subDt;
      cardState.ry += cardState.vy * subDt;

      // 光点弹簧（160 / 25.3，临界阻尼无过冲）
      var alx = (targetLx - cardState.lx) * 160 - cardState.vlx * 25.3;
      var aly = (targetLy - cardState.ly) * 160 - cardState.vly * 25.3;
      cardState.vlx += alx * subDt;
      cardState.vly += aly * subDt;
      cardState.lx += cardState.vlx * subDt;
      cardState.ly += cardState.vly * subDt;

      // 翻面弹簧（70 / 11，约 0.8s 带微弱过冲回稳）
      var aTurn = (targetTurn - cardState.turn) * 70 - cardState.vTurn * 11;
      cardState.vTurn += aTurn * subDt;
      cardState.turn += cardState.vTurn * subDt;
    }

    cardState.on += (onTarget - cardState.on) * (1 - Math.exp(-7 * dt));
    cardState.charge += (chargeTarget - cardState.charge) * (1 - Math.exp(-10 * dt));
    if (!cardState.revealing && cardState.charge < 0.002) cardState.charge = 0;
    if (!cardState.lowPerf) cardState.dashAngle = (cardState.dashAngle - dt * 8) % 360;

    applyCardVisual(cardState.rx, cardState.ry);
    cardState.raf = requestAnimationFrame(cardTick);
  }

  function startCardLoop() {
    if (!cardState.open || cardState.binderOpen) return;
    if (cardState.revealing && !cardState.revealed) { lightRevealAura(); finishReveal(); }
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
    var elIntroBtn = $('open-binder-intro');
    var elIntro = $('binder-count-intro');
    var elRes = $('binder-count-result');
    var elCard = $('binder-count-card');
    var elHead = $('card-collect-count');
    if (elIntro) elIntro.textContent = shortText;
    if (elIntroBtn) elIntroBtn.hidden = got === 0;
    if (elRes) elRes.textContent = shortText;
    if (elCard) elCard.textContent = shortText;
    if (elHead) elHead.textContent = '已收集 ' + shortText;
    var seal = $('binder-complete-seal');
    if (seal) seal.hidden = got < MATERIALS.length;
    var prog = $('binder-progress');
    if (prog) {
      prog.className = got >= MATERIALS.length ? 'binder-progress is-complete' : 'binder-progress';
      var segs = prog.querySelectorAll('.bp-seg');
      for (var i = 0; i < segs.length; i += 1) {
        segs[i].className = i < got ? 'bp-seg is-filled' : 'bp-seg';
      }
    }
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
        var isCurrent = !!(revealedNow && state.material && key === state.material);
        var card = document.createElement('div');
        card.className = 'pocket-card';
        card.setAttribute('data-material', key);

        if (isCurrent && cardState.thumb && cardState.thumb.round === state.round && cardState.thumb.material === key && cardState.thumb.url) {
          var thumb = document.createElement('div');
          thumb.className = 'pocket-thumb';
          thumb.style.backgroundImage = 'url("' + cardState.thumb.url + '")';
          card.appendChild(thumb);
        }

        var head = document.createElement('div');
        head.className = 'pocket-head';
        var num = document.createElement('span');
        num.textContent = pad(idx + 1, 2);
        head.appendChild(num);
        if (isCurrent) {
          var badge = document.createElement('span');
          badge.className = 'pocket-now';
          badge.textContent = '本次';
          head.appendChild(badge);
        } else {
          var tierTag = document.createElement('span');
          tierTag.className = 'pocket-tier pocket-tier-' + meta.code.toLowerCase();
          tierTag.textContent = meta.code;
          head.appendChild(tierTag);
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
        origin.textContent = meta.tag;

        card.appendChild(head);
        card.appendChild(center);
        card.appendChild(origin);

        var hit = document.createElement('button');
        hit.type = 'button';
        hit.className = 'pocket-hit';
        hit.setAttribute('aria-label', isCurrent ? ('查看本次冲出的' + meta.name + '小卡') : ('赏光预览' + meta.name + '工艺样卡'));
        hit.addEventListener('click', function () {
          var binderOpener = cardState.binderOpener;
          if (isCurrent) {
            if (cardState.open && !cardState.sampleMode) {
              showRevealedFront(false);
              closeBinder();
              fitCard();
            } else {
              closeBinder(true);
              openCard(null, { alreadyRevealed: true, returnFocus: binderOpener || $('open-binder-result') });
            }
          } else {
            openSampleCard(key, binderOpener);
          }
        });
        card.appendChild(hit);

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
    closeCardFraming(true);
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

    // 内存缓存本次冲出的缩略图供卡册展示（绑定轮次+材质，不写 localStorage）
    cardState.thumb = null;
    if (state.photo) {
      try {
        var tc = document.createElement('canvas');
        tc.width = 165; tc.height = 255;
        Film.drawCardPhoto(state.photo, tc, cardState.photoBounds);
        cardState.thumb = { round: state.round, material: mat, url: tc.toDataURL('image/jpeg', 0.72) };
      } catch (err) { cardState.thumb = null; }
    }

    var scene = $('holo-scene');
    if (scene) scene.className = 'holo-scene';
    var card = $('holo-card');
    if (card) card.className = 'holo-flipper';
    var backEl = $('holo-back');
    if (backEl) backEl.className = 'holo-face holo-back is-revealed';

    $('card-caption-text').textContent = meta.name + ' · ' + meta.origin;
    $('card-caption-new').hidden = !state.isNewMaterial;
    $('card-caption').className = 'card-caption is-visible';
    $('card-tip').textContent = '轻晃赏光 · 轻点看背面';
    updateBinderCounts();

    var saveBtn = $('save-card');
    if (saveBtn) {
      saveBtn.hidden = false;
      saveBtn.disabled = state.busy;   // 上一次保存还没结束时先不让点，结束后由 saveCard 重新启用
      saveBtn.className = 'btn btn-primary';
    }
    $('card-save-options').hidden = false;
    fitCard();
    var dot = $('open-card-dot');
    if (dot) dot.hidden = true;

    if (!isReducedMotion()) {
      cardState.sweepStart = Date.now() + 260;
      cardState.sweeping = true;
    }
  }

  function triggerReveal() {
    if (cardState.framing || cardState.revealing || cardState.revealed) return;
    $('card-framing-entry').hidden = true;
    $('save-card').hidden = false;
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

    // 每张卡都先蓄力再翻开；越稀有停得越久、震得越重，光晕在翻开那一刻亮起
    var tier = meta.tier;
    cardState.revealing = true;
    Bridge.vibrate(tier === 'prism' ? 'heavy' : (tier === 'special' ? 'medium' : 'light'));
    $('holo-card').className = 'holo-flipper is-charging';
    cardState.revealTimer = setTimeout(function () {
      cardState.revealTimer = 0;
      lightRevealAura();
      finishReveal();
    }, tier === 'prism' ? 900 : (tier === 'special' ? 640 : 420));
  }

  /* 翻开那一刻点亮光晕：蓄力到时和「蓄力中被卡册打断、回来直接揭晓」两条路共用 */
  function lightRevealAura() {
    var aura = $('holo-aura');
    if (!aura) return;
    var tier = (MATERIAL_META[state.material || 'rainbow'] || MATERIAL_META.rainbow).tier;
    if (tier === 'prism') aura.className = 'holo-aura is-prism';
    else if (tier === 'special') aura.className = 'holo-aura is-special';
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
      ? '轻点回到正面'
      : '轻晃赏光 · 轻点看背面';
    Bridge.vibrate('light');
  }

  function drawMaterialSampleCanvas(canvas, mat) {
    var w = canvas.width, h = canvas.height;
    var ctx = canvas.getContext('2d');
    var schemes = {
      prism:   ['#0d193d', '#1c3b7a', '#2e1d5e', 'rgba(130, 224, 255, 0.28)'],
      noir:    ['#2b0d0b', '#4d1712', '#140605', 'rgba(244, 204, 132, 0.34)'],
      cateye:  ['#2a1832', '#4d2b5c', '#180d1e', 'rgba(236, 198, 248, 0.30)'],
      sparkle: ['#231814', '#3b281c', '#120b09', 'rgba(255, 224, 168, 0.28)'],
      etched:  ['#161619', '#24262c', '#0d0d10', 'rgba(210, 222, 240, 0.22)'],
      chrome:  ['#9ba3ae', '#dce2ea', '#7b838e', 'rgba(255, 255, 255, 0.36)'],
      sunleak: ['#4d2213', '#8c3f21', '#22100a', 'rgba(255, 206, 146, 0.32)'],
      pearl:   ['#e6dfd8', '#f6f1ec', '#ddd6e4', 'rgba(72, 58, 52, 0.16)'],
      rainbow: ['#2a1f1d', '#493530', '#1c1413', 'rgba(255, 220, 196, 0.22)']
    };
    var pal = schemes[mat] || schemes.rainbow;
    var g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, pal[0]); g.addColorStop(0.5, pal[1]); g.addColorStop(1, pal[2]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // 暗房工艺样卡中央光圈暗纹
    var cx = w / 2, cy = h * 0.45, R = w * 0.28;
    ctx.save();
    ctx.strokeStyle = pal[3];
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.68, 0, Math.PI * 2); ctx.stroke();
    for (var k = 0; k < 6; k += 1) {
      var a = k * Math.PI / 3;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * R * 0.68, cy + Math.sin(a) * R * 0.68);
      ctx.lineTo(cx + Math.cos(a + 2.0) * R * 0.26, cy + Math.sin(a + 2.0) * R * 0.26);
      ctx.stroke();
    }
    ctx.fillStyle = mat === 'pearl' || mat === 'chrome' ? 'rgba(36, 26, 22, 0.72)' : 'rgba(255, 244, 234, 0.82)';
    ctx.textAlign = 'center';
    ctx.font = '600 44px "Songti SC", "STSong", "SimSun", serif';
    ctx.fillText((MATERIAL_META[mat] || MATERIAL_META.rainbow).name, cx, cy + R + 72);
    ctx.font = '14px "SF Mono", Menlo, Consolas, monospace';
    ctx.fillStyle = mat === 'pearl' || mat === 'chrome' ? 'rgba(36, 26, 22, 0.50)' : 'rgba(255, 244, 234, 0.50)';
    ctx.fillText('DARKROOM LAB · SAMPLE', cx, cy + R + 106);
    ctx.restore();
  }

  function renderCardContent() {
    var isSample = !!cardState.sampleMode;
    var mat = isSample ? (cardState.sampleMat || 'rainbow') : (state.material || 'rainbow');
    var meta = MATERIAL_META[mat] || MATERIAL_META.rainbow;
    var noPad = pad(state.shotNo || state.count, 4);

    $('holo-front').setAttribute('data-material', mat);
    var edgesEl = $('holo-edges');
    if (edgesEl) edgesEl.setAttribute('data-material', mat);
    $('card-front-no').textContent = isSample ? 'SAMPLE' : ('NO.' + noPad);
    $('card-front-mat').textContent = meta.name;
    $('card-front-rarity').innerHTML = buildRarityMarkup(meta);
    $('card-back-no').textContent = isSample ? 'SAMPLE' : ('No.' + noPad);
    $('card-back-date').textContent = isSample ? 'ARCHIVE' : state.shotDate;

    var bt = $('card-back-title');
    if (bt) bt.textContent = isSample ? '暗房工艺样卡' : '冲印档案';
    var bm = $('card-back-mat');
    if (bm) bm.textContent = meta.name;
    var br = $('card-back-rarity');
    if (br) br.textContent = meta.rarity + ' ' + meta.code;
    var bo = $('card-back-origin');
    if (bo) bo.textContent = meta.origin;

    var fx = $('holo-fx');
    if (fx && mat === 'prism') {
      fx.style.setProperty('--prism-tex', getPrismTexture());
    }

    var photoCanvas = $('card-photo');
    if (isSample) {
      drawMaterialSampleCanvas(photoCanvas, mat);
    } else if (state.photo) {
      Film.drawCardPhoto(state.photo, photoCanvas, cardState.photoBounds);
    }

    updateBinderCounts();
  }

  function showRevealedFront(instant) {
    var mat = state.material || 'rainbow';
    var meta = MATERIAL_META[mat] || MATERIAL_META.rainbow;
    cardState.revealed = true;
    cardState.revealing = false;
    cardState.flipped = false;
    if (instant) {
      cardState.turn = 0; cardState.vTurn = 0; cardState.charge = 0;
    }

    var scene = $('holo-scene');
    if (scene && !instant) scene.className = 'holo-scene';
    var card = $('holo-card');
    if (card) card.className = instant ? 'holo-flipper is-instant' : 'holo-flipper';
    var aura = $('holo-aura');
    if (aura) aura.className = 'holo-aura';
    var backEl = $('holo-back');
    if (backEl) backEl.className = 'holo-face holo-back is-revealed';

    $('card-caption-text').textContent = meta.name + ' · ' + meta.origin;
    $('card-caption-new').hidden = true;
    $('card-caption').className = 'card-caption is-visible';
    $('card-tip').textContent = '轻晃赏光 · 轻点看背面';

    var saveBtn = $('save-card');
    $('card-framing-entry').hidden = true;
    $('card-save-options').hidden = false;
    if (saveBtn) {
      resetSaveFeedback('save-card');
      saveBtn.hidden = false;
      saveBtn.disabled = state.busy;
      saveBtn.className = 'btn btn-primary';
    }
  }

  function openSampleCard(mat, binderOpener) {
    var meta = MATERIAL_META[mat] || MATERIAL_META.rainbow;
    var previousCard = cardState.open ? { opener: cardState.cardOpener, revealed: cardState.revealed } : null;
    if (previousCard) closeCard(true);
    closeBinder(true);
    cardState.sampleMode = true;
    cardState.sampleMat = mat;
    cardState.sampleReturn = { binderOpener: binderOpener, previousCard: previousCard, material: mat };
    cardState.openSeq = (cardState.openSeq || 0) + 1;
    cardState.cardOpener = binderOpener || $('open-binder-result');
    renderCardContent();
    cardState.open = true;
    cardState.revealed = true;
    cardState.revealing = false;
    cardState.flipped = false;
    cardState.sweeping = false;
    cardState.rx = 0; cardState.ry = 0; cardState.vx = 0; cardState.vy = 0;
    cardState.lx = 34; cardState.ly = 22; cardState.vlx = 0; cardState.vly = 0; cardState.on = 0;
    cardState.turn = 0; cardState.vTurn = 0; cardState.charge = 0;
    cardState.tx = 0; cardState.ty = 0; cardState.dragging = false; cardState.hovering = false; cardState.lastInputTs = 0;
    cardState.slowFrames = 0; cardState.lastDraw = '';

    $('close-card-label').textContent = '返回卡册';
    $('close-card').setAttribute('aria-label', '返回卡册');
    $('open-binder-card').hidden = true;
    $('card-framing-entry').hidden = true;
    $('card-save-options').hidden = true;
    var saveBtn = $('save-card');
    if (saveBtn) { saveBtn.hidden = true; saveBtn.disabled = true; }
    var backEl = $('holo-back');
    if (backEl) backEl.className = 'holo-face holo-back is-revealed';
    var card = $('holo-card');
    card.className = 'holo-flipper is-instant';
    $('card-caption-text').textContent = meta.name + ' · ' + meta.origin;
    $('card-caption-new').hidden = true;
    $('card-caption').className = 'card-caption is-visible';
    $('card-tip').textContent = '轻晃赏光 · 轻点看背面';
    var scene = $('holo-scene');
    if (scene) {
      scene.className = 'holo-scene';
      void scene.offsetWidth;
      scene.className = 'holo-scene is-entering';
    }
    $('card-modal').hidden = false;
    fitCard();
    applyCardVisual(0, 0);
    void card.offsetWidth;
    card.className = 'holo-flipper';
    startCardLoop();
    startCardGyro();
    focusModal($('card-modal'), card);
  }

  function openCard(e, opts) {
    if (!state.photo) return;
    cardState.sampleMode = false;
    cardState.sampleMat = '';
    cardState.sampleReturn = null;
    cardState.saveMode = 'face';
    setChoice('card-save-options', cardState.saveMode);
    $('card-save-options').hidden = true;
    $('close-card-label').textContent = '返回相纸';
    $('close-card').setAttribute('aria-label', '返回出片页');
    $('open-binder-card').hidden = false;
    if (!cardState.photoBounds) cardState.photoBounds = Film.cardPhotoBounds(state.photo);
    cardState.openSeq = (cardState.openSeq || 0) + 1;   // 每次打开一个序号，存卡结果只回写发起它的那次
    var showFront = !!(opts && opts.alreadyRevealed && isCurrentRevealed());
    if (opts && opts.returnFocus) {
      cardState.cardOpener = opts.returnFocus;
    } else {
      cardState.cardOpener = (e && e.currentTarget && typeof e.currentTarget.focus === 'function')
        ? e.currentTarget : document.activeElement;
    }
    renderCardContent();
    cardState.open = true;
    cardState.sweeping = false;
    cardState.rx = 0; cardState.ry = 0; cardState.vx = 0; cardState.vy = 0;
    cardState.lx = 34; cardState.ly = 22; cardState.vlx = 0; cardState.vly = 0; cardState.on = 0;
    cardState.turn = showFront ? 0 : 180; cardState.vTurn = 0; cardState.charge = 0;
    cardState.tx = 0; cardState.ty = 0; cardState.dragging = false; cardState.hovering = false; cardState.lastInputTs = 0;
    cardState.slowFrames = 0; cardState.lastDraw = '';

    var card = $('holo-card');
    if (showFront) {
      showRevealedFront(true);
    } else {
      cardState.revealed = false;
      cardState.revealing = false;
      cardState.flipped = true;
      card.className = 'holo-flipper is-flipped is-instant';
      var aura = $('holo-aura');
      if (aura) aura.className = 'holo-aura';
      var backEl = $('holo-back');
      if (backEl) backEl.className = 'holo-face holo-back';
      $('card-caption').className = 'card-caption';
      $('card-caption-text').textContent = '';
      $('card-caption-new').hidden = true;
      var hasFraming = !isCurrentRevealed() && Math.abs(state.photo.width / state.photo.height - Film.cardPhotoAspect) > 0.01;
      $('card-framing-entry').hidden = !hasFraming;
      setUnrevealedCardTip();
      var saveBtn = $('save-card');
      if (saveBtn) {
        saveBtn.hidden = hasFraming;
        saveBtn.disabled = true;
        saveBtn.className = 'btn btn-primary is-pending';
      }
    }

    var scene = $('holo-scene');
    if (scene) {
      scene.className = 'holo-scene';
      void scene.offsetWidth;
      scene.className = showFront ? 'holo-scene is-entering' : 'holo-scene is-entering is-floating';
    }

    $('card-modal').hidden = false;
    fitCard();
    applyCardVisual(0, 0);
    // 解除无过渡锁，保证首次点击能平滑翻转
    void card.offsetWidth;
    card.className = showFront ? 'holo-flipper' : 'holo-flipper is-flipped';
    startCardLoop();
    startCardGyro();
    focusModal($('card-modal'), card);
  }

  function closeCard(noFocus) {
    if (!cardState.open) return;
    resetSaveFeedback('save-card');
    var sampleReturn = cardState.sampleReturn;
    closeCardFraming(true);
    cardState.open = false;
    cardState.sampleMode = false;
    cardState.sampleMat = '';
    cardState.sampleReturn = null;
    cardState.revealing = false;
    cardState.dragging = false;
    cardState.hovering = false;
    cardState.sweeping = false;
    $('close-card-label').textContent = '返回相纸';
    $('close-card').setAttribute('aria-label', '返回出片页');
    $('open-binder-card').hidden = false;
    stopCardLoop();
    stopCardGyro();
    $('card-modal').hidden = true;
    var opener = cardState.cardOpener;
    cardState.cardOpener = null;
    if (noFocus === true) return;
    if (sampleReturn) {
      var previousCard = sampleReturn.previousCard;
      if (previousCard) openCard(null, { alreadyRevealed: previousCard.revealed, returnFocus: previousCard.opener });
      openBinder({ currentTarget: sampleReturn.binderOpener || opener });
      var sampleSlot = $('card-collect-grid').querySelector('[data-material="' + sampleReturn.material + '"] .pocket-hit');
      restoreFocus(sampleSlot);
    } else {
      restoreFocus(opener);
    }
  }

  function setUnrevealedCardTip() {
    var tip = '轻触拆封';
    if (!$('card-framing-entry').hidden) {
      var side = state.photo.width / state.photo.height > Film.cardPhotoAspect ? '两侧' : '上下';
      tip += ' · 小卡会裁去照片' + side + '，可先调整取景';
    }
    $('card-tip').textContent = tip;
  }

  function drawRoundedRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  var CARD_FRAMING_WIDTH = 188;

  function renderCardFraming() {
    var canvas = $('card-framing-canvas'), ctx = canvas.getContext('2d');
    var crop = cardState.framingBounds, photo = state.photo;
    var w = canvas.width, h = canvas.height;
    var frameWidth = CARD_FRAMING_WIDTH, frameHeight = Math.round(frameWidth * crop.h / crop.w);
    var left = Math.round((w - frameWidth) / 2);
    var top = Math.round((h - frameHeight) / 2);
    var scale = frameWidth / crop.w;

    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(photo, left - crop.x * scale, top - crop.y * scale,
      photo.width * scale, photo.height * scale);

    // 窗外压暗遮罩
    ctx.fillStyle = 'rgba(10, 6, 6, 0.78)';
    ctx.fillRect(0, 0, w, top);
    ctx.fillRect(0, top + frameHeight, w, h - (top + frameHeight));
    ctx.fillRect(0, top, left, frameHeight);
    ctx.fillRect(left + frameWidth, top, w - (left + frameWidth), frameHeight);

    // 55:85 全出血小卡中性圆角轮廓 + 右下角微章位置示意（不剧透材质）
    ctx.save();
    drawRoundedRectPath(ctx, left, top, frameWidth, frameHeight, 10);
    ctx.strokeStyle = 'rgba(245, 232, 224, 0.34)';
    ctx.lineWidth = 1;
    ctx.stroke();
    drawRoundedRectPath(ctx, left + 6, top + 6, frameWidth - 12, frameHeight - 12, 6);
    ctx.strokeStyle = 'rgba(245, 232, 224, 0.16)';
    ctx.stroke();
    drawRoundedRectPath(ctx, left + frameWidth - 62, top + frameHeight - 24, 50, 14, 7);
    ctx.fillStyle = 'rgba(16, 10, 10, 0.45)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(245, 232, 224, 0.25)';
    ctx.stroke();
    ctx.restore();

    // 满版照片窗发丝框 + 四角 L 型光学角标
    ctx.strokeStyle = 'rgba(255, 244, 232, 0.38)';
    ctx.lineWidth = 1;
    ctx.strokeRect(left + 0.5, top + 0.5, frameWidth - 1, frameHeight - 1);

    var b = 12;
    ctx.strokeStyle = '#fff8f2';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(left, top + b); ctx.lineTo(left, top); ctx.lineTo(left + b, top);
    ctx.moveTo(left + frameWidth - b, top); ctx.lineTo(left + frameWidth, top); ctx.lineTo(left + frameWidth, top + b);
    ctx.moveTo(left, top + frameHeight - b); ctx.lineTo(left, top + frameHeight); ctx.lineTo(left + b, top + frameHeight);
    ctx.moveTo(left + frameWidth - b, top + frameHeight); ctx.lineTo(left + frameWidth, top + frameHeight); ctx.lineTo(left + frameWidth, top + frameHeight - b);
    ctx.stroke();

    // 拖动时显露三分线与中心十字微标
    if (cardState.framingDrag) {
      ctx.strokeStyle = 'rgba(255, 248, 240, 0.22)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(left + frameWidth / 3, top); ctx.lineTo(left + frameWidth / 3, top + frameHeight);
      ctx.moveTo(left + frameWidth * 2 / 3, top); ctx.lineTo(left + frameWidth * 2 / 3, top + frameHeight);
      ctx.moveTo(left, top + frameHeight / 3); ctx.lineTo(left + frameWidth, top + frameHeight / 3);
      ctx.moveTo(left, top + frameHeight * 2 / 3); ctx.lineTo(left + frameWidth, top + frameHeight * 2 / 3);
      ctx.stroke();
      var cx = left + frameWidth / 2, cy = top + frameHeight / 2;
      ctx.strokeStyle = 'rgba(255, 248, 240, 0.45)';
      ctx.beginPath();
      ctx.moveTo(cx - 5, cy); ctx.lineTo(cx + 5, cy);
      ctx.moveTo(cx, cy - 5); ctx.lineTo(cx, cy + 5);
      ctx.stroke();
    }
  }

  function openCardFraming() {
    if (!cardState.open || cardState.revealing || $('card-framing-entry').hidden) return;
    cardState.framingBounds = cardState.photoBounds;
    renderCardFraming();
    stopCardLoop();
    stopCardGyro();
    cardState.framing = true;
    $('card-stage-inner').hidden = true;
    $('card-framing').hidden = false;
    $('open-binder-card').hidden = true;
    $('close-card-label').textContent = '取消调整';
    $('close-card').setAttribute('aria-label', '取消调整');
    $('card-framing-entry').textContent = '用这个构图';
    $('card-framing-entry').className = 'btn btn-primary';
    restoreFocus($('card-framing-canvas'));
  }

  function closeCardFraming(silent) {
    if (!cardState.framing) return;
    cardState.framing = false;
    cardState.framingBounds = null;
    cardState.framingDrag = null;
    $('card-framing').hidden = true;
    $('card-stage-inner').hidden = false;
    $('open-binder-card').hidden = false;
    $('close-card-label').textContent = '返回相纸';
    $('close-card').setAttribute('aria-label', '返回出片页');
    $('card-framing-entry').textContent = '调整构图';
    $('card-framing-entry').className = 'btn btn-ghost';
    setUnrevealedCardTip();
    if (!silent) {
      fitCard();
      startCardLoop();
      startCardGyro();
      restoreFocus($('card-framing-entry'));
    }
  }

  function moveCardFraming(dx, dy) {
    var crop = cardState.framingBounds, photo = state.photo;
    cardState.framingBounds = Film.cardPhotoBounds(photo,
      (crop.x + crop.w / 2 - dx) / photo.width, (crop.y + crop.h / 2 - dy) / photo.height);
    renderCardFraming();
  }

  function bindCardFraming() {
    var canvas = $('card-framing-canvas');
    canvas.addEventListener('pointerdown', function (e) {
      if (!cardState.framing || e.button !== 0 || cardState.framingDrag) return;
      cardState.framingDrag = { id: e.pointerId, x: e.clientX, y: e.clientY };
      renderCardFraming();
      if (canvas.setPointerCapture) { try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* 指针已释放 */ } }
    });
    canvas.addEventListener('pointermove', function (e) {
      var drag = cardState.framingDrag;
      if (!drag || drag.id !== e.pointerId) return;
      var width = canvas.getBoundingClientRect().width;
      if (!width) return;
      var units = (canvas.width / width) * cardState.framingBounds.w / CARD_FRAMING_WIDTH;
      moveCardFraming((e.clientX - drag.x) * units, (e.clientY - drag.y) * units);
      drag.x = e.clientX;
      drag.y = e.clientY;
    });
    function release(e) {
      if (cardState.framingDrag && cardState.framingDrag.id === e.pointerId) {
        cardState.framingDrag = null;
        if (cardState.framing && cardState.framingBounds) renderCardFraming();
      }
    }
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
    canvas.addEventListener('lostpointercapture', release);
    canvas.addEventListener('pointerleave', release);
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    var directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    canvas.addEventListener('keydown', function (e) {
      var direction = directions[e.key];
      if (!cardState.framing || !direction) return;
      e.preventDefault();
      var step = cardState.framingBounds.w * 0.05;
      moveCardFraming(direction[0] * step, direction[1] * step);
    });
    $('card-framing-entry').addEventListener('click', function () {
      if (cardState.framing) {
        cardState.photoBounds = cardState.framingBounds;
        Film.drawCardPhoto(state.photo, $('card-photo'), cardState.photoBounds);
        closeCardFraming();
      } else {
        openCardFraming();
      }
    });
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

  /* ---------- 小卡导出 ---------- */
  var RARITY_MARK = { R: '●', SR: '✦', SSR: '✦✦' };

  function captureCardLight() {
    var still = isReducedMotion() || cardState.lowPerf;
    var scene = $('holo-scene');
    var width = scene.offsetWidth || 1;
    var height = scene.offsetHeight || 1;
    var rad = Math.PI / 180;
    function clampOffset(offset) { return Math.max(-0.045, Math.min(0.045, offset)); }
    return {
      x: clamp01(cardState.lx / 100), y: clamp01(cardState.ly / 100),
      strength: still ? 0.35 : Math.min(1, Math.max(cardState.on, Math.sqrt(cardState.rx * cardState.rx + cardState.ry * cardState.ry) / 12)),
      scale: still ? 1 : 1.09,
      dx: still ? 0 : clampOffset(-22 * Math.sin((cardState.ry + cardState.turn) * rad) / width),
      dy: still ? 0 : clampOffset(22 * Math.sin(cardState.rx * rad) / height)
    };
  }

  function ensureCardShot(mode, light) {
    var got = 0;
    MATERIALS.forEach(function (k) { if (state.collected.indexOf(k) >= 0) got += 1; });
    var mat = state.material || 'rainbow';
    var meta = MATERIAL_META[mat] || MATERIAL_META.rainbow;
    var no = 'No.' + pad(state.shotNo || state.count, 4);
    var compose = mode === 'both' ? Film.composePhotocard : Film.composeCardFace;
    var shot = compose(state.photo, {
      photoBounds: cardState.photoBounds,
      material: mat, name: meta.name, rarity: meta.rarity, code: meta.code, mark: RARITY_MARK[meta.code] || '',
      light: light,
      origin: meta.origin,
      no: no, date: state.shotDate || '',
      collection: '已收集 ' + got + '/' + MATERIALS.length
    });
    return Bridge.toTempFile(describePrint(shot).url);
  }

  var savedButtonFeedback = {};

  function resetSaveFeedback(id) {
    var reset = savedButtonFeedback[id];
    if (reset) reset();
  }

  function showSaveFeedback(id, label, successText) {
    resetSaveFeedback(id);
    var btn = $(id);
    var originalText = label.textContent;
    label.textContent = successText;
    btn.classList.add('is-saved');
    var timer = setTimeout(reset, 2000);
    savedButtonFeedback[id] = reset;

    function reset() {
      clearTimeout(timer);
      label.textContent = originalText;
      btn.classList.remove('is-saved');
      delete savedButtonFeedback[id];
    }
  }

  function saveCard() {
    var btn = $('save-card');
    if (state.busy || !state.photo || !cardState.open || !cardState.revealed || cardState.sampleMode) return;
    resetSaveFeedback('save-card');
    state.busy = true;
    btn.disabled = true;
    $('card-tip').textContent = '正在保存小卡…';
    var round = state.round, seq = cardState.openSeq;
    var mode = cardState.saveMode, light = captureCardLight();
    setTimeout(function () {
      // 合成放进 Promise 链：同步抛错也会走到失败分支，按钮和提示一定能恢复
      Promise.resolve().then(function () { return ensureCardShot(mode, light); }).then(Bridge.saveImage).then(function () {
        if (round !== state.round || seq !== cardState.openSeq || !cardState.open) return;
        $('card-tip').textContent = '已存入相册';
        showSaveFeedback('save-card', btn, '已保存');
      }, function (err) {
        if (round !== state.round || seq !== cardState.openSeq || !cardState.open) return;
        $('card-tip').textContent = failText(err, '保存小卡');
      }).then(releaseBusy);
    }, 30);
  }

  /* 存相纸、发笔记、存小卡共用 busy；任何一个结束都要把存卡按钮按当前弹层是否已揭晓恢复 */
  function releaseBusy() {
    state.busy = false;
    var btn = $('save-card');
    if (btn && cardState.open) btn.disabled = !cardState.revealed || cardState.sampleMode;
  }

  function bindCardInteraction() {
    var card = $('holo-card');
    var scene = $('holo-scene');
    var activeId = null, startX = 0, startY = 0, moved = false;

    function updateFromPointer(e) {
      var rect = scene.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      var nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      var ny = ((e.clientY - rect.top) / rect.height) * 2 - 1;
      setCardTilt(nx, ny);
    }

    card.addEventListener('pointerdown', function (e) {
      if (activeId !== null || e.button !== 0) return;
      activeId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      moved = false;
      cardState.dragging = true;
      if (card.setPointerCapture) { try { card.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ } }
      if (!isReducedMotion()) updateFromPointer(e);
    });

    scene.addEventListener('pointerenter', function (e) {
      if (e.pointerType === 'mouse') {
        cardState.hovering = true;
        if (!isReducedMotion()) updateFromPointer(e);
      }
    });

    scene.addEventListener('pointerleave', function (e) {
      if (e.pointerType === 'mouse') {
        cardState.hovering = false;
        if (activeId === null) cardState.lastInputTs = 0;
      }
    });

    scene.addEventListener('pointermove', function (e) {
      if (e.pointerId === activeId) {
        var dx = e.clientX - startX;
        var dy = e.clientY - startY;
        if (dx * dx + dy * dy > 64) moved = true;
        if (!isReducedMotion()) updateFromPointer(e);
      } else if (activeId === null && e.pointerType === 'mouse') {
        cardState.hovering = true;
        if (!isReducedMotion()) updateFromPointer(e);
      }
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
    card.addEventListener('lostpointercapture', function (e) { end(e, false); });

    card.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        toggleCardFlip();
      }
    });
  }

  /* ---------- 开灯出片 ---------- */
  function devLabel(dev) {
    if (dev < 0.75) return '柔淡影调';
    if (dev < 0.9) return '清浅影调';
    if (dev <= 1.12) return '自然影调';
    if (dev <= 1.4) return '浓郁影调';
    return '深暗影调';
  }

  function describePrint(canvas) {
    var url = canvas.toDataURL('image/jpeg', 0.95);
    if (url === 'data:,') throw new Error('Empty print');
    return { url: url, width: canvas.width, height: canvas.height, path: '' };
  }

  function setChoice(id, mode) {
    var options = $(id).querySelectorAll('button');
    for (var i = 0; i < options.length; i++) {
      options[i].setAttribute('aria-pressed', String(options[i].getAttribute('data-mode') === mode));
    }
  }

  function showPrint(mode) {
    if (!state.prints) return;
    if (!state.prints[mode]) state.prints[mode] = describePrint(Film.composeCard(state.photo, state.cardInfo));
    state.printMode = mode;
    setChoice('print-options', mode);
    $('result-img').src = state.prints[mode].url;
  }

  function openPreview(e) {
    if (!state.prints || previewState.open) return;
    previewState.open = true;
    previewState.printMode = state.printMode;
    previewState.opener = (e && e.currentTarget && typeof e.currentTarget.focus === 'function')
      ? e.currentTarget : $('open-preview');
    var modal = $('preview-modal');
    var img = $('preview-img');
    var tip = $('preview-tip');
    previewState.zoomed = false;
    previewState.lastTapTs = 0;
    clearTimeout(previewState.tapTimer);
    previewState.tapTimer = 0;
    if (img) img.src = state.prints[previewState.printMode].url;
    $('preview-compare').disabled = !state.base || !state.cardInfo;
    if (tip) {
      tip.textContent = '双击看细节 · 轻点返回';
      tip.className = 'preview-tip';
    }
    clearTimeout(previewState.tipTimer);
    previewState.tipTimer = setTimeout(function () {
      previewState.tipTimer = 0;
      if (tip) tip.className = 'preview-tip is-faded';
    }, 2000);
    modal.hidden = false;
    if (isReducedMotion()) {
      modal.className = 'preview-modal is-open';
    } else {
      modal.className = 'preview-modal';
      void modal.offsetWidth;
      modal.className = 'preview-modal is-open';
    }
    focusModal(modal, $('close-preview'));
  }

  function fitPreviewZoom() {
    var stage = $('preview-stage');
    var print = state.prints[previewState.printMode];
    var fitted = Math.min(stage.clientWidth - 32, (stage.clientHeight - 16) * print.width / print.height, print.width);
    stage.style.setProperty('--preview-zoom-width', Math.max(1, fitted * 1.9) + 'px');
  }

  function togglePreviewZoom() {
    var stage = $('preview-stage');
    var modal = $('preview-modal');
    previewState.zoomed = !previewState.zoomed;
    if (previewState.zoomed) fitPreviewZoom();
    modal.className = 'preview-modal is-open' +
      (previewState.compareBy !== null ? ' is-comparing' : '') +
      (previewState.zoomed ? ' is-zoomed' : '');
    stage.scrollLeft = (stage.scrollWidth - stage.clientWidth) / 2;
    stage.scrollTop = (stage.scrollHeight - stage.clientHeight) / 2;
  }

  function closePreview(noFocus) {
    if (!previewState.open) return;
    previewState.open = false;
    showDevelopedPreview();
    if (previewState.original) {
      $('preview-stage').removeChild(previewState.original);
      previewState.original = null;
    }
    previewState.zoomed = false;
    clearTimeout(previewState.tapTimer);
    previewState.tapTimer = 0;
    clearTimeout(previewState.tipTimer);
    previewState.tipTimer = 0;
    var modal = $('preview-modal');
    modal.className = 'preview-modal';
    modal.hidden = true;
    var opener = previewState.opener;
    previewState.opener = null;
    if (noFocus !== true) restoreFocus(opener || $('open-preview'));
  }

  function showOriginalPreview(by) {
    if (!previewState.open || previewState.compareBy !== null || !state.base || !state.cardInfo) return;
    if (!previewState.original) {
      var original;
      try {
        original = previewState.printMode === 'paper' ? Film.composeCard(state.base, state.cardInfo) : state.base;
      } catch (err) {
        var tip = $('preview-tip');
        clearTimeout(previewState.tipTimer);
        previewState.tipTimer = 0;
        tip.textContent = '暂时无法查看冲印前的照片';
        tip.className = 'preview-tip';
        return;
      }
      original.className = 'preview-img';
      original.setAttribute('role', 'img');
      original.setAttribute('aria-label', '冲印前照片');
      $('preview-stage').appendChild(original);
      previewState.original = original;
    }
    previewState.compareBy = by;
    $('preview-img').hidden = true;
    previewState.original.hidden = false;
    $('preview-compare').setAttribute('aria-pressed', 'true');
    $('preview-modal').className = 'preview-modal is-open is-comparing' + (previewState.zoomed ? ' is-zoomed' : '');
  }

  function showDevelopedPreview() {
    if (previewState.compareBy === null) return;
    previewState.compareBy = null;
    previewState.original.hidden = true;
    $('preview-img').hidden = false;
    $('preview-compare').setAttribute('aria-pressed', 'false');
    if (previewState.open) $('preview-modal').className = 'preview-modal is-open' + (previewState.zoomed ? ' is-zoomed' : '');
  }

  function bindPreviewComparison() {
    var button = $('preview-compare');
    button.addEventListener('pointerdown', function (e) {
      if (e.button === 0) showOriginalPreview(e.pointerId);
    });
    function releasePointer(e) {
      if (previewState.compareBy === e.pointerId) showDevelopedPreview();
    }
    button.addEventListener('pointerup', releasePointer);
    button.addEventListener('pointercancel', releasePointer);
    button.addEventListener('pointerleave', releasePointer);
    button.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    function compareKey(e) {
      return e.key === ' ' || e.key === 'Spacebar' || e.key === 'Enter';
    }
    button.addEventListener('keydown', function (e) {
      if (!compareKey(e)) return;
      e.preventDefault();
      showOriginalPreview(e.key);
    });
    button.addEventListener('keyup', function (e) {
      if (!compareKey(e)) return;
      e.preventDefault();
      if (previewState.compareBy === e.key) showDevelopedPreview();
    });
    button.addEventListener('click', function (e) {
      e.stopPropagation();
      if (e.detail !== 0) return;
      if (previewState.compareBy === 'activation') showDevelopedPreview();
      else showOriginalPreview('activation');
    });
    button.addEventListener('blur', showDevelopedPreview);
    window.addEventListener('blur', showDevelopedPreview);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) showDevelopedPreview();
    });
  }

  function lightsOn() {
    if (state.busy || state.fix < 1) return;
    state.busy = true;
    $('lights-on').disabled = true;
    $('lights-on').hidden = true;
    $('screen-fix').className = 'screen screen-fix';
    setStatus('fix-hint', '开灯见片…');
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
      uneven: clamp01(1 - avgAgi / 0.65),
      fix: state.fix,
      leak: false,
      dust: false
    };
    // 等存档读回（最多 1.5 秒）再出片，编号和卡册才不会被迟到的读数覆盖
    saved.ready.then(function () { setTimeout(function () {
      try {
        var photo = Film.develop(state.base, params);
        var print = describePrint(photo);
        var no = state.count + 1;
        var d = new Date();
        state.shotDate = d.getFullYear() + '.' + pad(d.getMonth() + 1, 2) + '.' + pad(d.getDate(), 2);
        var cardInfo = {
          no: 'No.' + pad(no, 4),
          date: state.shotDate
        };
        state.prints = { clean: print, paper: null };
        state.cardInfo = cardInfo;
        // 成片生成成功才提交本轮：编号、小卡照片、收集
        state.photo = photo;   // 小卡正面用这张成片（canvas），不带白边
        state.count = no;
        state.shotNo = no;   // 本轮编号定下来，相纸、小卡和晒卡图都用它
        if (saved.count.state === 'pending') saved.count.rounds += 1;
        else saveCount();
        var prevCollectedLen = state.collected.length;
        state.material = pickMaterial();
        collectMaterial(state.material);
        state.isNewMaterial = state.collected.length > prevCollectedLen;
        showPrint('clean');
        setStatus('result-report', '显影 ' + Math.round(state.devTime) + ' 秒 · ' + devLabel(params.dev) +
          (params.uneven > 0.3 ? ' · 显影不均' : ''));
        $('open-card-text').textContent = '拆封暗房小卡';
        $('open-card-dot').hidden = !state.isNewMaterial;
        updateBinderCounts();

        setStatus('result-status', Bridge.inApp() ? '' : '在小红书 App 内打开，即可存图与发布');
        show('result');
        document.querySelector('.result-scroll').scrollTop = 0;
        $('result-title').focus();
      } catch (e) {
        clearFlash();
        document.body.className = '';
        setStatus('fix-hint', '暂时无法生成成片');
        $('lights-on').hidden = false;
      }
      state.busy = false;
      $('lights-on').disabled = false;
    }, 60); });
  }

  function ensureTempFile(print) {
    if (print.path) return Promise.resolve(print.path);
    return Bridge.toTempFile(print.url).then(function (p) { print.path = p; return p; });
  }

  function failText(err, action) {
    if (err && err.errMsg === 'unsupported') return '在小红书 App 内打开，即可存图与发布';
    return action + '未完成，请再试一次';
  }

  function savePhoto() {
    if (state.busy || !state.prints) return;
    resetSaveFeedback('save-photo');
    var btn = $('save-photo');
    var label = btn.querySelector('span');
    state.busy = true;
    btn.disabled = true;
    setStatus('result-status', '正在保存成片…');
    var round = state.round, mode = state.printMode;
    ensureTempFile(state.prints[mode]).then(Bridge.saveImage).then(function () {
      if (round !== state.round) return;
      state.keptRound = round;
      if (mode === state.printMode && label) showSaveFeedback('save-photo', label, '已存入相册');
      var savedLabel = mode === 'paper' ? '暗房相纸' : '纯净成片';
      setStatus('result-status', savedLabel + '已存入相册');
    }, function (err) {
      if (round === state.round) setStatus('result-status', failText(err, '存相册'));
    }).then(function () { releaseBusy(); btn.disabled = false; });
  }

  function postNote() {
    if (state.busy || !state.prints) return;
    state.busy = true;
    $('post-note').disabled = true;
    setStatus('result-status', '');
    ensureTempFile(state.prints[state.printMode]).then(function (path) {
      return Bridge.postNote(path, '在红灯下，等一张照片显影',
        '挑了一张喜欢的照片，试了次模拟暗房冲印。相纸上的画面一点点显出来，开灯才看见完整的成片。\n#暗房冲印店 #胶片感调色');
    }).catch(function (err) {
      setStatus('result-status', failText(err, '发笔记'));
    }).then(function () { releaseBusy(); $('post-note').disabled = false; });
  }

  function again() {
    closeBinder(true);
    closeCard(true);
    resetSaveFeedback('save-photo');
    clearFlash();
    document.body.className = '';
    state.base = null; state.prints = null; state.cardInfo = null; state.photo = null; state.material = '';
    state.isNewMaterial = false; state.round += 1;
    cardState.photoBounds = null;
    $('result-img').removeAttribute('src');
    setStatus('intro-status', '');
    show('intro');
  }

  /* ---------- 启动 ---------- */
  /* 成片还没存进相册：第一下只提醒，3 秒内再点一次才清掉。
     只认存相册成功（savePhoto 记下的 keptRound）；存失败、发笔记、存小卡都不算存了这张照片 */
  function bindAgainConfirm() {
    var btn = $('again'), armedUntil = 0, timer = 0;
    var label = btn.querySelector('.again-text') || btn;
    var notice = '';
    function reset() {
      clearTimeout(timer); timer = 0; armedUntil = 0;
      label.textContent = '再洗一张';
      btn.className = 'btn btn-again';
      if (notice && $('result-status').textContent === notice) setStatus('result-status', '');
      notice = '';
    }
    btn.addEventListener('click', function () {
      if (state.busy) return;   // 正在存或正在发：等它结束
      var unsaved = state.keptRound !== state.round;
      var unopened = !isCurrentRevealed();   // 本轮的小卡还没拆
      if ((unsaved || unopened) && Date.now() > armedUntil) {
        armedUntil = Date.now() + 3000;
        clearTimeout(timer);
        timer = setTimeout(reset, 3000);
        label.textContent = '确认离开';
        notice = unsaved ? '成片尚未保存，再点离开' : '小卡尚未拆封，再点离开';
        setStatus('result-status', notice);
        btn.className = 'btn btn-again again-confirm';
        return;
      }
      reset();
      again();
    });
    // 离开出片页再回来，要重新点两下
    $('open-card').addEventListener('click', reset);
    $('open-binder-result').addEventListener('click', reset);
    document.addEventListener('visibilitychange', function () { if (document.hidden) reset(); });
  }

  function boot() {
    if (!Bridge || !Film) {
      setStatus('intro-status', '暗房没准备好，请退出后重新打开。');
      return;
    }
    avoidHostButtons();
    loadSaved();
    bindTrayRub();
    bindFix();
    bindCrop();
    bindCardInteraction();
    bindCardFraming();
    bindModalFocusTrap();
    $('print-options').addEventListener('click', function (e) {
      var mode = e.target.getAttribute('data-mode');
      if (mode !== 'clean' && mode !== 'paper') return;
      try { showPrint(mode); }
      catch (err) { setStatus('result-status', '暂时无法生成暗房相纸'); }
    });
    $('card-save-options').addEventListener('click', function (e) {
      var mode = e.target.getAttribute('data-mode');
      if (mode !== 'face' && mode !== 'both') return;
      cardState.saveMode = mode;
      setChoice('card-save-options', mode);
    });
    $('pull-out').addEventListener('click', pullOut);
    $('lights-on').addEventListener('click', function () {
      if (!$('lights-on').hidden) lightsOn();
    });
    $('open-card').addEventListener('click', openCard);
    $('close-card').addEventListener('click', function () {
      if (cardState.framing) closeCardFraming();
      else closeCard();
    });
    $('save-card').addEventListener('click', saveCard);
    $('open-binder-intro').addEventListener('click', openBinder);
    $('open-binder-result').addEventListener('click', openBinder);
    $('open-binder-card').addEventListener('click', openBinder);
    $('close-binder').addEventListener('click', closeBinder);
    $('save-photo').addEventListener('click', savePhoto);
    $('post-note').addEventListener('click', postNote);
    $('open-preview').addEventListener('click', openPreview);
    $('close-preview').addEventListener('click', function (e) { e.stopPropagation(); closePreview(); });
    $('preview-modal').addEventListener('click', function (e) {
      if (e.target === $('preview-img') || e.target === previewState.original) {
        var now = Date.now();
        if (now - previewState.lastTapTs < 260) {
          clearTimeout(previewState.tapTimer);
          previewState.tapTimer = 0;
          previewState.lastTapTs = 0;
          togglePreviewZoom();
          return;
        }
        previewState.lastTapTs = now;
        clearTimeout(previewState.tapTimer);
        previewState.tapTimer = setTimeout(function () {
          previewState.tapTimer = 0;
          if (!previewState.zoomed) closePreview();
        }, 260);
        return;
      }
      closePreview();
    });
    (function bindDevReselect() {
      var btn = $('dev-reselect'), armed = 0, t = 0;
      function reset() {
        clearTimeout(t); t = 0; armed = 0;
        btn.textContent = '重选';
        btn.className = 'dev-reselect-btn';
      }
      btn.addEventListener('click', function () {
        if (Date.now() > armed) {
          armed = Date.now() + 2600;
          clearTimeout(t);
          t = setTimeout(reset, 2600);
          btn.textContent = '确认重选';
          btn.className = 'dev-reselect-btn is-armed';
          return;
        }
        reset();
        stopDevelopLoop();
        state.sweetBuzzedRound = -1;
        var ds = $('screen-develop');
        if (ds) ds.className = 'screen screen-develop';
        show('intro');
      });
    }());
    bindPreviewComparison();
    bindAgainConfirm();
    window.addEventListener('resize', function () {
      fitTrays();
      fitCard();
      fitCrop();
      if (previewState.zoomed) fitPreviewZoom();
    });
    fitTrays();
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        if (cropState) {
          cropState.drag = null;
          cropState.pointers = [];
          cropState.pinchDist = 0;
          clearTimeout(cropState.gridTimer);
          cropState.gridTimer = 0;
          $('crop-frame').className = 'crop-frame';
        }
        if (cardState.framingDrag) {
          cardState.framingDrag = null;
          renderCardFraming();
        }
        cardState.hovering = false;
        stopCardLoop();
        stopCardGyro();   // 后台不再占着陀螺仪订阅
      } else {
        state.lastTs = 0;
        if (cardState.open && !cardState.binderOpen && !cardState.framing) { startCardLoop(); startCardGyro(); }
      }
    });
    initIntro();
  }

  boot();
}());
