/* 胶片冲洗：裁切照片、按显影程度出片、叠加瑕疵、合成相纸卡片。只用 Canvas 2D */
(function () {
  'use strict';

  var PORTRAIT = { w: 900, h: 1200 };
  var LANDSCAPE = { w: 1200, h: 900 };
  var BUCKETS = 16;
  var DEV_MIN = 0.4;
  var DEV_MAX = 2.0;
  var luts = null;

  function makeCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  function clamp01(x) { return x < 0 ? 0 : (x > 1 ? 1 : x); }
  function rand(a, b) { return a + Math.random() * (b - a); }

  /* 每个显影档位一套查找表：S 曲线 + 抬高黑位 + 暖高光 / 偏冷暗部 */
  function buildLuts() {
    if (luts) return luts;
    luts = [];
    for (var b = 0; b < BUCKETS; b++) {
      var dev = DEV_MIN + b * (DEV_MAX - DEV_MIN) / (BUCKETS - 1);
      var r = new Uint8ClampedArray(256), g = new Uint8ClampedArray(256), bl = new Uint8ClampedArray(256);
      var gamma = Math.max(0.45, Math.min(2.2, 1 + (dev - 1) * 1.1));
      var contrast = 1 + (dev - 1) * 0.5;
      for (var v = 0; v < 256; v++) {
        var x = v / 255;
        var s = x * x * (3 - 2 * x);
        var c = x + (s - x) * 0.6;
        var y = Math.pow(c, gamma);
        y = (y - 0.5) * contrast + 0.5;
        if (dev < 1) y = y + (1 - dev) * 0.28 * (1 - y);
        y = clamp01(y);
        r[v] = 255 * clamp01(0.04 + y * 0.95);
        g[v] = 255 * clamp01(0.035 + y * 0.92);
        bl[v] = 255 * clamp01(0.065 + y * 0.84 - 0.03 * y * y);
      }
      luts.push({ r: r, g: g, b: bl });
    }
    return luts;
  }

  function cropToCanvas(img) {
    var sw = img.naturalWidth || img.width, sh = img.naturalHeight || img.height;
    if (!sw || !sh) throw new Error('empty image');
    var target = sw >= sh ? LANDSCAPE : PORTRAIT;
    var aspect = target.w / target.h;
    var cw = sw, ch = sw / aspect;
    if (ch > sh) { ch = sh; cw = sh * aspect; }
    var sx = (sw - cw) / 2, sy = (sh - ch) / 2;
    var scale = Math.min(1, target.w / cw);
    var out = makeCanvas(Math.round(cw * scale), Math.round(ch * scale));
    var ctx = out.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, sx, sy, cw, ch, 0, 0, out.width, out.height);
    return out;
  }

  function loadFile(file) {
    return new Promise(function (resolve, reject) {
      if (!file || !/^image\//.test(file.type || 'image/')) { reject(new Error('not image')); return; }
      var url = URL.createObjectURL(file);
      var img = new Image();
      var done = false;
      var timer = setTimeout(function () { finish(new Error('timeout')); }, 15000);
      function finish(err, canvas) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        URL.revokeObjectURL(url);
        if (err) reject(err); else resolve(canvas);
      }
      img.onload = function () {
        try { finish(null, cropToCanvas(img)); } catch (e) { finish(e); }
      };
      img.onerror = function () { finish(new Error('decode')); };
      img.src = url;
    });
  }

  /* 示例底片：海边日落，现场画出来，不打包图片 */
  function makeSample() {
    var w = PORTRAIT.w, h = PORTRAIT.h;
    var c = makeCanvas(w, h), ctx = c.getContext('2d');
    var horizon = h * 0.56;
    var sky = ctx.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, '#31446e'); sky.addColorStop(0.55, '#d98b72'); sky.addColorStop(1, '#f6d4a2');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, w, horizon);
    var sun = ctx.createRadialGradient(w * 0.62, horizon - 70, 10, w * 0.62, horizon - 70, 260);
    sun.addColorStop(0, 'rgba(255,246,220,1)'); sun.addColorStop(0.18, 'rgba(255,226,170,0.9)'); sun.addColorStop(1, 'rgba(255,200,150,0)');
    ctx.fillStyle = sun; ctx.fillRect(0, 0, w, horizon);
    ctx.fillStyle = '#3a3550';
    ctx.beginPath(); ctx.moveTo(0, horizon);
    ctx.quadraticCurveTo(w * 0.18, horizon - 90, w * 0.4, horizon - 20);
    ctx.quadraticCurveTo(w * 0.52, horizon - 45, w * 0.6, horizon); ctx.closePath(); ctx.fill();
    var sea = ctx.createLinearGradient(0, horizon, 0, h * 0.88);
    sea.addColorStop(0, '#8a7f95'); sea.addColorStop(1, '#2c3b57');
    ctx.fillStyle = sea; ctx.fillRect(0, horizon, w, h * 0.88 - horizon);
    for (var i = 0; i < 26; i++) {
      var yy = horizon + 8 + i * i * 0.55;
      ctx.fillStyle = 'rgba(255,225,180,' + (0.5 - i * 0.017) + ')';
      ctx.fillRect(w * 0.62 - (30 + i * 9), yy, 60 + i * 18, 2 + i * 0.12);
    }
    var sand = ctx.createLinearGradient(0, h * 0.8, 0, h);
    sand.addColorStop(0, '#5b4a48'); sand.addColorStop(1, '#2a2124');
    ctx.fillStyle = sand;
    ctx.beginPath(); ctx.moveTo(0, h * 0.84); ctx.quadraticCurveTo(w * 0.5, h * 0.79, w, h * 0.83);
    ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#1a1418';
    var fx = w * 0.3, fy = h * 0.815;
    ctx.beginPath(); ctx.arc(fx, fy - 92, 13, 0, Math.PI * 2); ctx.fill();
    ctx.fillRect(fx - 11, fy - 78, 22, 52);
    ctx.fillRect(fx - 9, fy - 28, 7, 34); ctx.fillRect(fx + 2, fy - 28, 7, 34);
    ctx.strokeStyle = '#2a2433'; ctx.lineWidth = 3;
    [[0.2, 0.2], [0.26, 0.17], [0.74, 0.25]].forEach(function (p) {
      var bx = w * p[0], by = h * p[1];
      ctx.beginPath(); ctx.moveTo(bx - 14, by); ctx.quadraticCurveTo(bx - 6, by - 8, bx, by);
      ctx.quadraticCurveTo(bx + 6, by - 8, bx + 14, by); ctx.stroke();
    });
    return c;
  }

  function drawFit(src, dst) {
    var ctx = dst.getContext('2d');
    ctx.clearRect(0, 0, dst.width, dst.height);
    ctx.drawImage(src, 0, 0, dst.width, dst.height);
  }

  /* 显影不匀用的低频遮罩：4x5 的随机格子放大成柔和的明暗斑 */
  function unevenMask(w, h) {
    var small = makeCanvas(4, 5), sctx = small.getContext('2d');
    for (var y = 0; y < 5; y++) for (var x = 0; x < 4; x++) {
      var v = Math.round(rand(0, 255));
      sctx.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')';
      sctx.fillRect(x, y, 1, 1);
    }
    var mw = Math.ceil(w / 8), mh = Math.ceil(h / 8);
    var m = makeCanvas(mw, mh), mctx = m.getContext('2d');
    mctx.imageSmoothingEnabled = true;
    mctx.drawImage(small, 0, 0, mw, mh);
    return { w: mw, data: mctx.getImageData(0, 0, mw, mh).data };
  }

  function applyTone(ctx, w, h, p) {
    var tables = buildLuts();
    var img = ctx.getImageData(0, 0, w, h), d = img.data;
    var mask = p.uneven > 0.05 ? unevenMask(w, h) : null;
    var grain = 14 + Math.max(0, p.dev - 1) * 26 + (p.dev < 0.8 ? 6 : 0);
    var span = DEV_MAX - DEV_MIN;
    var baseBucket = Math.round((clamp01((p.dev - DEV_MIN) / span)) * (BUCKETS - 1));
    for (var y = 0, i = 0; y < h; y++) {
      var row = mask ? (y >> 3) * mask.w : 0;
      for (var x = 0; x < w; x++, i += 4) {
        var t = tables[baseBucket];
        if (mask) {
          var mv = mask.data[(row + (x >> 3)) * 4] / 255;
          var local = p.dev * (1 + p.uneven * 0.7 * (mv - 0.5));
          t = tables[Math.round(clamp01((local - DEV_MIN) / span) * (BUCKETS - 1))];
        }
        var r = t.r[d[i]], g = t.g[d[i + 1]], b = t.b[d[i + 2]];
        var lum = 0.3 * r + 0.59 * g + 0.11 * b;
        var n = (Math.random() - 0.5) * grain;
        d[i] = lum + (r - lum) * 0.86 + n;
        d[i + 1] = lum + (g - lum) * 0.86 + n;
        d[i + 2] = lum + (b - lum) * 0.86 + n;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  function vignette(ctx, w, h) {
    var g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(120,80,60,1)');
    ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = 0.45;
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); ctx.restore();
  }

  function lightLeak(ctx, w, h) {
    var fromLeft = Math.random() < 0.5;
    var cx = fromLeft ? rand(-0.1, 0.05) * w : rand(0.95, 1.1) * w;
    var cy = rand(0.1, 0.9) * h;
    var radius = rand(0.45, 0.8) * w;
    var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    g.addColorStop(0, 'rgba(255,170,80,0.95)');
    g.addColorStop(0.35, 'rgba(255,90,40,0.6)');
    g.addColorStop(1, 'rgba(255,60,30,0)');
    ctx.save(); ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); ctx.restore();
  }

  function dust(ctx, w, h) {
    ctx.save();
    var count = Math.round(rand(18, 40));
    for (var i = 0; i < count; i++) {
      ctx.fillStyle = 'rgba(250,248,240,' + rand(0.45, 0.9).toFixed(2) + ')';
      ctx.beginPath(); ctx.arc(rand(0, w), rand(0, h), rand(0.6, 2.4), 0, Math.PI * 2); ctx.fill();
    }
    var lines = Math.round(rand(1, 3));
    ctx.strokeStyle = 'rgba(250,248,240,0.35)'; ctx.lineWidth = 1;
    for (var j = 0; j < lines; j++) {
      var x0 = rand(0.1, 0.9) * w;
      ctx.beginPath(); ctx.moveTo(x0, rand(0, 0.3) * h);
      ctx.bezierCurveTo(x0 + rand(-20, 20), h * 0.4, x0 + rand(-30, 30), h * 0.6, x0 + rand(-40, 40), rand(0.7, 1) * h);
      ctx.stroke();
    }
    ctx.restore();
  }

  function fixStain(ctx, w, h, amount) {
    ctx.save(); ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = 'rgba(245,225,170,' + (amount * 0.7).toFixed(2) + ')';
    ctx.fillRect(0, 0, w, h);
    var blots = 2 + Math.round(amount * 3);
    for (var i = 0; i < blots; i++) {
      var edge = Math.random() < 0.5;
      var cx = edge ? (Math.random() < 0.5 ? 0 : w) : rand(0, w);
      var cy = edge ? rand(0, h) : (Math.random() < 0.5 ? 0 : h);
      var r = rand(0.15, 0.35) * w;
      var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, 'rgba(170,120,50,' + (0.4 + amount * 0.4).toFixed(2) + ')');
      g.addColorStop(1, 'rgba(170,120,50,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    }
    ctx.restore();
  }

  /* p: { dev, uneven, fix, leak, dust } */
  function develop(base, p) {
    var w = base.width, h = base.height;
    var out = makeCanvas(w, h), ctx = out.getContext('2d');
    ctx.drawImage(base, 0, 0);
    applyTone(ctx, w, h, p);
    vignette(ctx, w, h);
    if (p.leak) lightLeak(ctx, w, h);
    if (p.dust) dust(ctx, w, h);
    if (p.fix < 1) fixStain(ctx, w, h, 1 - p.fix);
    return out;
  }

  /* 相纸卡片 1080x1440（小红书 3:4） */
  function composeCard(photo, info) {
    var W = 1080, H = 1440, box = { x: 90, y: 70, w: 900, h: 1200 };
    var c = makeCanvas(W, H), ctx = c.getContext('2d');
    var paper = ctx.createLinearGradient(0, 0, W, H);
    paper.addColorStop(0, '#f6f2ea'); paper.addColorStop(1, '#ece5d8');
    ctx.fillStyle = paper; ctx.fillRect(0, 0, W, H);
    var scale = Math.min(box.w / photo.width, box.h / photo.height);
    var pw = Math.round(photo.width * scale), ph = Math.round(photo.height * scale);
    var px = box.x + Math.round((box.w - pw) / 2);
    var py = photo.width > photo.height ? box.y + 60 : box.y;
    ctx.drawImage(photo, px, py, pw, ph);
    var textY = photo.width > photo.height ? py + ph + 110 : 1345;
    ctx.fillStyle = '#2a1d18';
    ctx.textBaseline = 'alphabetic';
    ctx.font = '44px "Songti SC", "STSong", "SimSun", serif';
    ctx.textAlign = 'left';
    ctx.fillText(info.title, box.x, textY);
    ctx.fillStyle = '#8a7166';
    ctx.font = '26px "SF Mono", Menlo, Consolas, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(info.no + '  ' + info.date, box.x + box.w, textY);
    ctx.textAlign = 'left';
    ctx.font = '26px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText(info.footer, box.x, textY + 48);
    return c;
  }

  window.Film = {
    loadFile: loadFile,
    makeSample: makeSample,
    drawFit: drawFit,
    develop: develop,
    composeCard: composeCard
  };
}());
