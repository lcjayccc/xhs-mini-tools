(function () {
  'use strict';

  var canvas = document.getElementById('paper');
  var grid = document.getElementById('grid');
  var reset = document.getElementById('reset');
  var benchmark = document.getElementById('benchmark');
  var results = document.getElementById('results');
  var ctx = canvas.getContext('2d');
  var image = ctx.createImageData(canvas.width, canvas.height);
  var model, lastFrame, pointer, measure;

  function restart() {
    model = window.FluidPrototype.create(Number(grid.value), canvas.width);
    lastFrame = 0;
    pointer = null;
  }

  function paint() {
    var rgba = image.data, density = model.density;
    for (var i = 0, p = 0; i < density.length; i++, p += 4) {
      rgba[p] = 235 - density[i] * 207;
      rgba[p + 1] = 191 - density[i] * 173;
      rgba[p + 2] = 159 - density[i] * 151;
      rgba[p + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
  }

  function finishBenchmark() {
    var times = measure.times.sort(function (a, b) { return a - b; });
    var intervals = measure.intervals.sort(function (a, b) { return a - b; });
    var median = (times[59] + times[60]) / 2;
    results.textContent = '流场 ' + grid.value + ' × ' + grid.value + '，密度图 256 × 256\n' +
      '120 帧，已去除前 30 帧预热\n' +
      '计算加绘制，中位数 ' + median.toFixed(1) + ' 毫秒，P95 ' + times[113].toFixed(1) + ' 毫秒\n' +
      '帧间隔 P95 ' + intervals[113].toFixed(1) + ' 毫秒';
    measure = null;
    grid.disabled = reset.disabled = benchmark.disabled = false;
  }

  function frame(now) {
    var interval = lastFrame ? now - lastFrame : 1000 / 60;
    lastFrame = now;
    var start = performance.now();
    if (measure) {
      var phase = measure.frames * 0.13;
      model.stir(0.5 + 0.3 * Math.sin(phase), 0.5 + 0.25 * Math.sin(phase * 0.7),
        0.04 * Math.cos(phase), 0.025 * Math.cos(phase * 0.7));
    }
    model.step(measure ? 1 / 60 : interval / 1000);
    paint();
    if (measure && ++measure.frames > 30) {
      measure.times.push(performance.now() - start);
      measure.intervals.push(interval);
      if (measure.times.length === 120) finishBenchmark();
    }
    requestAnimationFrame(frame);
  }

  function point(event) {
    var bounds = canvas.getBoundingClientRect();
    return { id: event.pointerId, x: (event.clientX - bounds.left) / bounds.width, y: (event.clientY - bounds.top) / bounds.height };
  }

  canvas.addEventListener('pointerdown', function (event) {
    if (measure || pointer) return;
    pointer = point(event);
    if (canvas.setPointerCapture) canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', function (event) {
    if (!pointer || pointer.id !== event.pointerId) return;
    var next = point(event);
    model.stir(next.x, next.y, next.x - pointer.x, next.y - pointer.y);
    pointer = next;
  });
  function release(event) {
    if (pointer && pointer.id === event.pointerId) pointer = null;
  }
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  document.addEventListener('visibilitychange', function () {
    lastFrame = 0;
    pointer = null;
    if (document.hidden && measure) {
      measure = null;
      results.textContent = '测试已暂停，请保持页面在前台后重试。';
      grid.disabled = reset.disabled = benchmark.disabled = false;
    }
  });
  grid.addEventListener('change', restart);
  reset.addEventListener('click', restart);
  benchmark.addEventListener('click', function () {
    restart();
    measure = { frames: 0, times: [], intervals: [] };
    grid.disabled = reset.disabled = benchmark.disabled = true;
    results.textContent = '正在测试，请保持页面在前台…';
  });
  restart();
  requestAnimationFrame(frame);
}());
