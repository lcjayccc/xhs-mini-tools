/* 胶片冲洗：裁切照片、按显影程度出片、叠加瑕疵、合成相纸卡片。只用 Canvas 2D */
(function () {
  'use strict';

  var PORTRAIT = { w: 900, h: 1200 };
  var LANDSCAPE = { w: 1200, h: 900 };
  var CARD_PHOTO_ASPECT = 3 / 4;
  var BUCKETS = 16;
  var DEV_MIN = 0.4;
  var DEV_MAX = 2.0;
  var MASK_COLS = 4;
  var MASK_ROWS = 5;
  var luts = null;

  function makeCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  function clamp01(x) { return x < 0 ? 0 : (x > 1 ? 1 : x); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function rand(a, b) { return a + Math.random() * (b - a); }

  /* 每个显影档位一套查找表：S 曲线 + 抬高黑位 + 暖高光 / 偏冷暗部 */
  function buildLuts() {
    if (luts) return luts;
    luts = [];
    for (var b = 0; b < BUCKETS; b++) {
      var dev = DEV_MIN + b * (DEV_MAX - DEV_MIN) / (BUCKETS - 1);
      var r = new Float32Array(256), g = new Float32Array(256), bl = new Float32Array(256);
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

  function cropBounds(img, aspect, zoom, centerX, centerY) {
    var sw = img.naturalWidth || img.width, sh = img.naturalHeight || img.height;
    if (!sw || !sh) throw new Error('empty image');
    var target = sw >= sh ? LANDSCAPE : PORTRAIT;
    var ratio = aspect || target.w / target.h;
    var ch = Math.min(sh, sw / ratio) / (zoom || 1);
    var cw = ch * ratio;
    var x = Math.max(0, Math.min(sw - cw, sw * (centerX == null ? 0.5 : centerX) - cw / 2));
    var y = Math.max(0, Math.min(sh - ch, sh * (centerY == null ? 0.5 : centerY) - ch / 2));
    return { x: x, y: y, w: cw, h: ch };
  }

  function cropToCanvas(img, bounds) {
    var crop = bounds || cropBounds(img);
    var target = crop.w > crop.h ? LANDSCAPE : PORTRAIT;
    var scale = Math.min(1, target.w / crop.w, target.h / crop.h);
    var width = Math.max(1, Math.round(crop.w * scale));
    var height = Math.max(1, Math.round(crop.h * scale));
    // 成片按 3:4 成组取整，避免小卡因像素取整再次裁切。
    if (bounds && Math.abs(crop.w / crop.h - CARD_PHOTO_ASPECT) < 1e-9) {
      var units = Math.max(1, Math.round(crop.h * scale / 4));
      width = units * 3;
      height = units * 4;
    }
    var out = makeCanvas(width, height);
    var ctx = out.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, out.width, out.height);
    return out;
  }

  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      if (!file || !/^image\//.test(file.type || 'image/')) { reject(new Error('not image')); return; }
      var url = URL.createObjectURL(file);
      var img = new Image();
      var done = false;
      var timer = setTimeout(function () { finish(new Error('timeout')); }, 15000);
      function finish(err) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        URL.revokeObjectURL(url);
        if (err) reject(err); else resolve(img);
      }
      img.onload = function () {
        finish(img.naturalWidth && img.naturalHeight ? null : new Error('empty image'));
      };
      img.onerror = function () { finish(new Error('decode')); };
      img.src = url;
    });
  }

  function loadFile(file) {
    return loadImage(file).then(function (img) { return cropToCanvas(img); });
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

  /* 保持比例铺满目标，多出的部分居中裁掉；用于比例和源图不同的画布（如小卡） */
  function drawCover(src, dst) {
    var sw = src.width, sh = src.height, dw = dst.width, dh = dst.height;
    var scale = Math.max(dw / sw, dh / sh);
    var cw = dw / scale, ch = dh / scale;
    var ctx = dst.getContext('2d');
    ctx.clearRect(0, 0, dw, dh);
    ctx.drawImage(src, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, 0, dw, dh);
  }

  function cardPhotoBounds(photo, centerX, centerY) {
    return cropBounds(photo, CARD_PHOTO_ASPECT, 1, centerX, centerY);
  }

  function paintCardPhoto(ctx, photo, x, y, w, h, bounds) {
    var crop = bounds || cardPhotoBounds(photo);
    ctx.drawImage(photo, crop.x, crop.y, crop.w, crop.h, x, y, w, h);
  }

  function drawCardPhoto(photo, canvas, bounds) {
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    paintCardPhoto(ctx, photo, 0, 0, canvas.width, canvas.height, bounds);
  }

  /* 低频不匀遮罩保留 4×5 个控制点，按像素在相邻控制点之间取样。 */
  function unevenMask() {
    var mask = new Float32Array(MASK_COLS * MASK_ROWS);
    for (var i = 0; i < mask.length; i++) mask[i] = Math.random();
    return mask;
  }

  function maskPosition(pixel, size, cells) {
    return Math.max(0, Math.min(cells - 1, (pixel + 0.5) * cells / size - 0.5));
  }

  function tonePosition(dev) {
    return clamp01((dev - DEV_MIN) / (DEV_MAX - DEV_MIN)) * (BUCKETS - 1);
  }

  function applyTone(ctx, w, h, p) {
    var tables = buildLuts();
    var img = ctx.getImageData(0, 0, w, h), d = img.data;
    var mask = p.uneven > 0.05 ? unevenMask() : null;
    var columns = null, maskRow = null;
    if (mask) {
      columns = new Float32Array(w);
      for (var col = 0; col < w; col++) columns[col] = maskPosition(col, w, MASK_COLS);
      maskRow = new Float32Array(MASK_COLS + 1);
    }
    var grain = 14 + Math.max(0, p.dev - 1) * 26 + (p.dev < 0.8 ? 6 : 0);
    var baseLevel = tonePosition(p.dev);
    var bucket = Math.floor(baseLevel);
    var from = tables[bucket], to = tables[Math.min(bucket + 1, BUCKETS - 1)];
    var blend = baseLevel - bucket;
    for (var y = 0, i = 0; y < h; y++) {
      if (mask) {
        var maskY = maskPosition(y, h, MASK_ROWS);
        var top = Math.floor(maskY), bottom = Math.min(top + 1, MASK_ROWS - 1);
        for (var c = 0; c < MASK_COLS; c++) {
          maskRow[c] = lerp(mask[top * MASK_COLS + c], mask[bottom * MASK_COLS + c], maskY - top);
        }
        maskRow[MASK_COLS] = maskRow[MASK_COLS - 1];
      }
      for (var x = 0; x < w; x++, i += 4) {
        if (mask) {
          var maskX = columns[x];
          var left = maskX | 0;
          var amount = lerp(maskRow[left], maskRow[left + 1], maskX - left);
          var level = tonePosition(p.dev * (1 + p.uneven * 0.7 * (amount - 0.5)));
          bucket = level | 0;
          from = tables[bucket];
          to = tables[bucket + (bucket < BUCKETS - 1 ? 1 : 0)];
          blend = level - bucket;
        }
        var r = lerp(from.r[d[i]], to.r[d[i]], blend);
        var g = lerp(from.g[d[i + 1]], to.g[d[i + 1]], blend);
        var b = lerp(from.b[d[i + 2]], to.b[d[i + 2]], blend);
        var lum = 0.3 * r + 0.59 * g + 0.11 * b;
        var brightness = lum / 255;
        var n = (Math.random() - 0.5) * grain * 4 * brightness * (1 - brightness);
        d[i] = lum + (r - lum) * 0.86 + n;
        d[i + 1] = lum + (g - lum) * 0.86 + n;
        d[i + 2] = lum + (b - lum) * 0.86 + n;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  /* 低分辨率高光遮罩做两次一维盒式模糊，成本与遮罩像素数成正比。 */
  function blurHighlights(src, dst, lines, length, lineStride, sampleStride, radius) {
    var weight = 1 / (radius * 2 + 1);
    for (var line = 0; line < lines; line++) {
      var start = line * lineStride, sum = 0;
      for (var s = -radius; s <= radius; s++) {
        sum += src[start + Math.max(0, Math.min(length - 1, s)) * sampleStride];
      }
      for (var p = 0; p < length; p++) {
        dst[start + p * sampleStride] = sum * weight;
        var next = Math.min(length - 1, p + radius + 1);
        var prev = Math.max(0, p - radius);
        sum += src[start + next * sampleStride] - src[start + prev * sampleStride];
      }
    }
  }

  function applyHalation(ctx, w, h) {
    var width = Math.ceil(w / 4), height = Math.ceil(h / 4);
    var layer = makeCanvas(width, height), light = layer.getContext('2d');
    light.drawImage(ctx.canvas, 0, 0, width, height);
    var image = light.getImageData(0, 0, width, height), rgba = image.data;
    var mask = new Float32Array(width * height), hasHighlights = false;
    for (var i = 0, c = 0; i < mask.length; i++, c += 4) {
      var lum = 0.3 * rgba[c] + 0.59 * rgba[c + 1] + 0.11 * rgba[c + 2];
      mask[i] = Math.max(0, (lum - 184) / 71) * rgba[c + 3] / 255;
      if (mask[i] > 0) hasHighlights = true;
    }
    if (!hasHighlights) return;

    var horizontal = new Float32Array(mask.length), blurred = new Float32Array(mask.length);
    var radius = Math.max(1, Math.round(Math.min(width, height) / 70));
    blurHighlights(mask, horizontal, height, width, width, 1, radius);
    blurHighlights(horizontal, blurred, width, height, 1, width, radius);
    for (var j = 0, k = 0; j < mask.length; j++, k += 4) {
      // 只叠加高光向周围扩散的部分，保留亮区本身的颜色。
      var halo = Math.max(0, blurred[j] - mask[j]);
      rgba[k] = 255;
      rgba[k + 1] = 58 + halo * 145;
      rgba[k + 2] = 24;
      rgba[k + 3] = Math.min(0.22, halo * 0.75) * 255;
    }
    light.putImageData(image, 0, 0);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.drawImage(layer, 0, 0, w, h);
    ctx.restore();
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
    applyHalation(ctx, w, h);
    vignette(ctx, w, h);
    if (p.leak) lightLeak(ctx, w, h);
    if (p.dust) dust(ctx, w, h);
    if (p.fix < 1) fixStain(ctx, w, h, 1 - p.fix);
    return out;
  }

  /* 相纸卡片 1080x1440（小红书 3:4） */
  function composeCard(photo, info) {
    var W = 1080, H = 1440, box = { x: 90, y: 70, w: 900, h: 1185 };
    var c = makeCanvas(W, H), ctx = c.getContext('2d');
    var paper = ctx.createLinearGradient(0, 0, W, H);
    paper.addColorStop(0, '#f6f2ea'); paper.addColorStop(1, '#ece5d8');
    ctx.fillStyle = paper; ctx.fillRect(0, 0, W, H);
    var scale = Math.min(box.w / photo.width, box.h / photo.height);
    var pw = Math.round(photo.width * scale), ph = Math.round(photo.height * scale);
    var px = box.x + Math.round((box.w - pw) / 2);
    // 画廊底锚式：横图/方图在上方画幅区光学居中，竖图贴合顶边，彻底消除底部死白
    var py = box.y + Math.round((box.h - ph) * 0.46);
    ctx.drawImage(photo, px, py, pw, ph);
    // 极细相纸压痕边，让照片自然嵌入纸面
    ctx.strokeStyle = 'rgba(42, 29, 24, 0.08)';
    ctx.lineWidth = 2;
    ctx.strokeRect(px + 1, py + 1, pw - 2, ph - 2);
    // 横图/方图底部留出画廊呼吸后，用极细发丝线锚定落款区
    if (py + ph < 1240) {
      ctx.fillStyle = 'rgba(42, 29, 24, 0.09)';
      ctx.fillRect(box.x, 1284, box.w, 1);
    }
    var textY = 1344;
    ctx.fillStyle = '#241914';
    ctx.textBaseline = 'alphabetic';
    ctx.font = '44px "Songti SC", "STSong", "SimSun", serif';
    ctx.textAlign = 'left';
    ctx.fillText(info.title, box.x, textY);
    ctx.fillStyle = '#6c584e';
    ctx.font = '26px "SF Mono", Menlo, Consolas, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(info.no + '  ' + info.date, box.x + box.w, textY);
    ctx.textAlign = 'left';
    ctx.font = '26px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText(info.footer, box.x, textY + 48);
    return c;
  }

  /* ---------- 小卡晒图 1080x1440：卡背斜放在后，正面装在卡套里在前，定格一道镭射光 ---------- */
  // 每种材质的卡纸、烫箔线、文字颜色，以及定格光带的颜色（与 style.css 的六种材质对应）
  var CARD_PAINT = {
    prism:   { stock: '#1d2340', trim: '#9fbaff', text: '#e4eaff', sub: 'rgba(228,234,255,0.55)', band: ['rgba(80,220,255,0.55)', 'rgba(170,110,255,0.6)', 'rgba(255,214,120,0.5)'] },
    rainbow: { stock: '#f3ede2', trim: '#b9b4ab', text: '#3a2f28', sub: 'rgba(58,47,40,0.5)',     band: ['rgba(255,120,150,0.35)', 'rgba(255,230,120,0.35)', 'rgba(120,230,200,0.35)', 'rgba(130,160,255,0.35)'] },
    sparkle: { stock: '#2a211d', trim: '#d9b77a', text: '#f1e2c4', sub: 'rgba(241,226,196,0.5)',  band: ['rgba(255,214,150,0.35)', 'rgba(255,190,120,0.45)'] },
    pearl:   { stock: '#f4f1ec', trim: '#ddd5ca', text: '#4a4038', sub: 'rgba(74,64,56,0.5)',     band: ['rgba(255,190,215,0.3)', 'rgba(200,240,255,0.3)', 'rgba(255,250,235,0.35)'] },
    etched:  { stock: '#1c1c1e', trim: '#8b8f96', text: '#d6d9de', sub: 'rgba(214,217,222,0.5)',  band: ['rgba(200,210,225,0.25)', 'rgba(230,236,245,0.3)'] },
    chrome:  { stock: '#b9bec5', trim: '#ffffff', text: '#2a2d31', sub: 'rgba(42,45,49,0.55)',    band: ['rgba(255,255,255,0.0)', 'rgba(255,255,255,0.75)', 'rgba(255,255,255,0.0)'] }
  };
  var SERIF = '"Songti SC", "STSong", "SimSun", serif';
  var MONO = '"SF Mono", Menlo, Consolas, monospace';

  // Chrome 61 没有 ctx.roundRect，自己画圆角路径
  function roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawCardBack(ctx, w, h, info) {
    var r = w * 0.047;
    ctx.save();
    roundRectPath(ctx, -w / 2, -h / 2, w, h, r);
    ctx.fillStyle = '#1a1412'; ctx.fill();
    ctx.clip();
    // 背印水印：斜向重复的极淡品牌字
    ctx.save();
    ctx.rotate(-Math.PI / 6);
    ctx.fillStyle = 'rgba(236,220,210,0.03)';
    ctx.font = '16px ' + MONO;
    for (var yy = -h; yy < h; yy += 44) {
      for (var xx = -w * 1.2; xx < w * 1.2; xx += 300) ctx.fillText('DARKROOM LAB · 35MM PAPER', xx + (yy % 88 ? 150 : 0), yy);
    }
    ctx.restore();
    // 双线框
    ctx.strokeStyle = 'rgba(214,190,160,0.45)'; ctx.lineWidth = 2;
    roundRectPath(ctx, -w / 2 + 22, -h / 2 + 22, w - 44, h - 44, r * 0.6); ctx.stroke();
    ctx.strokeStyle = 'rgba(214,190,160,0.22)'; ctx.lineWidth = 1;
    roundRectPath(ctx, -w / 2 + 32, -h / 2 + 32, w - 64, h - 64, r * 0.5); ctx.stroke();
    ctx.fillStyle = 'rgba(236,220,210,0.55)';
    ctx.textAlign = 'center';
    ctx.font = '15px ' + MONO;
    ctx.fillText('SAFETY FILM · 35MM', 0, -h / 2 + 70);
    ctx.font = '20px ' + MONO;
    ctx.fillText('DARKROOM LAB', 0, -h * 0.13);
    // 光圈徽章：同心圆 + 六片叶片 + 中心红点
    var R = w * 0.14;
    ctx.strokeStyle = 'rgba(214,190,160,0.6)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(0, 0, R * 0.78, 0, Math.PI * 2); ctx.stroke();
    for (var k = 0; k < 6; k++) {
      var a = k * Math.PI / 3;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * R * 0.78, Math.sin(a) * R * 0.78);
      ctx.lineTo(Math.cos(a + 2.1) * R * 0.32, Math.sin(a + 2.1) * R * 0.32);
      ctx.stroke();
    }
    ctx.fillStyle = '#d2412f';
    ctx.beginPath(); ctx.arc(0, 0, R * 0.09, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(236,220,210,0.8)';
    ctx.font = '34px ' + SERIF;
    ctx.fillText('暗房冲印店', 0, R + 60);
    // 冲印机背码
    ctx.fillStyle = 'rgba(236,220,210,0.5)';
    ctx.font = '15px ' + MONO;
    ctx.fillText(info.date + '   < ' + info.no + ' >   C-41 · 35MM', 0, h / 2 - 52);
    ctx.restore();
  }

  function drawCardFront(ctx, photo, w, h, info) {
    var paint = CARD_PAINT[info.material] || CARD_PAINT.rainbow;
    var r = w * 0.047, m = w * 0.036;
    ctx.save();
    roundRectPath(ctx, -w / 2, -h / 2, w, h, r);
    ctx.fillStyle = paint.stock; ctx.fill();
    ctx.clip();
    if (info.material === 'chrome') {
      // 拉丝银：细密的水平线
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      for (var ly = -h / 2; ly < h / 2; ly += 3) ctx.fillRect(-w / 2, ly, w, 1);
    }
    // 与页面小卡共用 3:4 照片窗和裁切区域。
    var px = -w / 2 + m, py = -h / 2 + m, pw = w - m * 2, ph = pw * 4 / 3;
    ctx.save();
    roundRectPath(ctx, px, py, pw, ph, r * 0.3);
    ctx.clip();
    paintCardPhoto(ctx, photo, px, py, pw, ph, info.photoBounds);
    ctx.restore();
    // 烫箔内框
    ctx.strokeStyle = paint.trim; ctx.globalAlpha = 0.85; ctx.lineWidth = 2;
    roundRectPath(ctx, px - 5, py - 5, pw + 10, ph + 10, r * 0.4); ctx.stroke();
    ctx.globalAlpha = 1;
    // 定格的镭射光：一条斜向光带，只在光带里提亮，照片其余部分不动
    var band = ctx.createLinearGradient(-w * 0.55, -h * 0.5, w * 0.35, h * 0.25);
    band.addColorStop(0, 'rgba(0,0,0,0)');
    var n = paint.band.length;
    for (var i = 0; i < n; i++) band.addColorStop(0.32 + 0.22 * i / Math.max(1, n - 1), paint.band[i]);
    band.addColorStop(0.62, 'rgba(0,0,0,0)');
    band.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = band; ctx.fillRect(-w / 2, -h / 2, w, h);
    if (info.material === 'sparkle') {
      // 光带里的闪粉颗粒
      ctx.fillStyle = 'rgba(255,236,190,0.9)';
      for (var d = 0; d < 140; d++) {
        var t = rand(0.3, 0.62), off = rand(-0.12, 0.12);
        var sx = -w * 0.55 + t * w * 0.9 + off * w, sy = -h * 0.5 + t * h * 0.75 - off * h * 0.6;
        ctx.globalAlpha = rand(0.35, 1);
        ctx.fillRect(sx, sy, rand(1.5, 3.5), rand(1.5, 3.5));
      }
      ctx.globalAlpha = 1;
    } else if (info.material === 'etched') {
      // 蚀刻线只在光点附近浮现
      ctx.strokeStyle = 'rgba(225,232,242,0.35)'; ctx.lineWidth = 1;
      for (var c = 1; c <= 6; c++) { ctx.beginPath(); ctx.arc(-w * 0.12, -h * 0.14, c * w * 0.05, 0, Math.PI * 2); ctx.stroke(); }
    }
    // 光点眩光
    var glare = ctx.createRadialGradient(-w * 0.12, -h * 0.14, 0, -w * 0.12, -h * 0.14, w * 0.5);
    glare.addColorStop(0, 'rgba(255,255,255,0.22)');
    glare.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = glare; ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.globalCompositeOperation = 'source-over';
    // 底部印刷栏
    var by = (py + ph + h / 2) / 2 - 5;
    ctx.textAlign = 'left';
    ctx.fillStyle = paint.sub; ctx.font = '13px ' + MONO;
    ctx.fillText('DARKROOM LAB · 35MM', -w / 2 + m, by - 8);
    ctx.fillStyle = paint.text; ctx.font = '20px ' + MONO;
    ctx.fillText(info.no.toUpperCase(), -w / 2 + m, by + 20);
    ctx.textAlign = 'right';
    ctx.font = '26px ' + SERIF;
    ctx.fillText(info.name + '  ' + info.mark + ' ' + info.code, w / 2 - m, by + 18);
    ctx.restore();
    // 卡纸切边高光
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1.5;
    roundRectPath(ctx, -w / 2 + 0.75, -h / 2 + 0.75, w - 1.5, h - 1.5, r); ctx.stroke();
  }

  /* info: { material, name, code, mark, no, date, footer1, footer2 } */
  function composePhotocard(photo, info) {
    var W = 1080, H = 1440;
    var c = makeCanvas(W, H), ctx = c.getContext('2d');
    var bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#1b0f0d'); bg.addColorStop(1, '#0c0706');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    var glow = ctx.createRadialGradient(W / 2, -120, 0, W / 2, -120, 900);
    glow.addColorStop(0, 'rgba(190,40,25,0.35)'); glow.addColorStop(1, 'rgba(190,40,25,0)');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
    var cw = 530, ch = Math.round(cw * 85 / 55);
    // 后景：卡背，向右错开、顺时针斜放
    ctx.save();
    ctx.translate(W / 2 + 235, 650); ctx.rotate(6 * Math.PI / 180);
    ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 18;
    roundRectPath(ctx, -cw / 2, -ch / 2, cw, ch, cw * 0.047); ctx.fillStyle = '#1a1412'; ctx.fill();
    ctx.shadowColor = 'rgba(0,0,0,0)';
    drawCardBack(ctx, cw, ch, info);
    ctx.restore();
    // 前景：正面，略向左倾，外面套一层硬壳卡套
    ctx.save();
    ctx.translate(W / 2 - 115, 690); ctx.rotate(-2 * Math.PI / 180);
    ctx.shadowColor = 'rgba(0,0,0,0.65)'; ctx.shadowBlur = 50; ctx.shadowOffsetY = 24;
    roundRectPath(ctx, -cw / 2, -ch / 2, cw, ch, cw * 0.047); ctx.fillStyle = '#000'; ctx.fill();
    ctx.shadowColor = 'rgba(0,0,0,0)';
    drawCardFront(ctx, photo, cw, ch, info);
    var tw = cw + 28, th = ch + 28;
    ctx.strokeStyle = 'rgba(235,240,248,0.35)'; ctx.lineWidth = 2;
    roundRectPath(ctx, -tw / 2, -th / 2, tw, th, 16); ctx.stroke();
    ctx.strokeStyle = 'rgba(235,240,248,0.15)'; ctx.lineWidth = 1;
    roundRectPath(ctx, -tw / 2 + 5, -th / 2 + 5, tw - 10, th - 10, 13); ctx.stroke();
    var film = ctx.createLinearGradient(-tw / 2, -th / 2, tw / 2, th / 2);
    film.addColorStop(0.18, 'rgba(255,255,255,0)'); film.addColorStop(0.24, 'rgba(255,255,255,0.10)'); film.addColorStop(0.3, 'rgba(255,255,255,0)');
    ctx.fillStyle = film; roundRectPath(ctx, -tw / 2, -th / 2, tw, th, 16); ctx.fill();
    ctx.restore();
    // 落款
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(236,220,210,0.85)'; ctx.font = '30px ' + SERIF;
    ctx.fillText(info.footer1, W / 2, H - 120);
    ctx.fillStyle = 'rgba(236,220,210,0.5)'; ctx.font = '22px ' + MONO;
    ctx.fillText(info.footer2, W / 2, H - 76);
    return c;
  }

  window.Film = {
    loadFile: loadFile,
    loadImage: loadImage,
    cropBounds: cropBounds,
    cropToCanvas: cropToCanvas,
    makeSample: makeSample,
    drawFit: drawFit,
    drawCover: drawCover,
    cardPhotoAspect: CARD_PHOTO_ASPECT,
    cardPhotoBounds: cardPhotoBounds,
    drawCardPhoto: drawCardPhoto,
    develop: develop,
    composeCard: composeCard,
    composePhotocard: composePhotocard
  };
}());
