/* 本地性能原型。网格速度以格/秒计，所有缓冲区在启动时分配。 */
(function () {
  'use strict';

  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

  function sample(field, size, x, y) {
    var sx = clamp(x, 0, size - 1), sy = clamp(y, 0, size - 1);
    var left = sx | 0, top = sy | 0;
    var right = Math.min(left + 1, size - 1), bottom = Math.min(top + 1, size - 1);
    var a = field[top * size + left], b = field[bottom * size + left];
    var upper = a + (field[top * size + right] - a) * (sx - left);
    var lower = b + (field[bottom * size + right] - b) * (sx - left);
    return upper + (lower - upper) * (sy - top);
  }

  function advect(dst, src, u, v, size, dt) {
    for (var y = 0, i = 0; y < size; y++) {
      for (var x = 0; x < size; x++, i++) {
        dst[i] = sample(src, size, x - u[i] * dt, y - v[i] * dt);
      }
    }
  }

  function create(size, densitySize) {
    var cells = size * size;
    var u = new Float32Array(cells), v = new Float32Array(cells);
    var nextU = new Float32Array(cells), nextV = new Float32Array(cells);
    var pressure = new Float32Array(cells), nextPressure = new Float32Array(cells);
    var divergence = new Float32Array(cells);
    var developer = new Float32Array(cells), bromide = new Float32Array(cells);
    var nextDeveloper = new Float32Array(cells), nextBromide = new Float32Array(cells);
    var density = new Float32Array(densitySize * densitySize);
    var target = new Float32Array(density.length);
    developer.fill(1);
    for (var y = 0, p = 0; y < densitySize; y++) {
      for (var x = 0; x < densitySize; x++, p++) {
        var stripe = Math.floor(x * 5 / densitySize) / 4;
        target[p] = 0.22 + 0.65 * stripe;
      }
    }

    function walls(uField, vField) {
      var last = size - 1;
      for (var i = 0; i < size; i++) {
        uField[i * size] = uField[i * size + last] = 0;
        vField[i] = vField[last * size + i] = 0;
      }
    }

    function project(uField, vField) {
      walls(uField, vField);
      pressure.fill(0);
      for (var y = 1; y < size - 1; y++) {
        for (var x = 1, i = y * size + 1; x < size - 1; x++, i++) {
          divergence[i] = (uField[i + 1] - uField[i - 1] + vField[i + size] - vField[i - size]) * 0.5;
        }
      }
      for (var iteration = 0; iteration < 8; iteration++) {
        for (var row = 1; row < size - 1; row++) {
          for (var col = 1, q = row * size + 1; col < size - 1; col++, q++) {
            nextPressure[q] = (pressure[q - 1] + pressure[q + 1] + pressure[q - size] + pressure[q + size] - divergence[q]) * 0.25;
          }
        }
        var swap = pressure;
        pressure = nextPressure;
        nextPressure = swap;
      }
      for (var py = 1; py < size - 1; py++) {
        for (var px = 1, j = py * size + 1; px < size - 1; px++, j++) {
          uField[j] -= (pressure[j + 1] - pressure[j - 1]) * 0.5;
          vField[j] -= (pressure[j + size] - pressure[j - size]) * 0.5;
        }
      }
    }

    function stir(x, y, dx, dy) {
      var cx = clamp(x, 0, 1) * (size - 1), cy = clamp(y, 0, 1) * (size - 1);
      var radius = Math.max(2, size * 0.13);
      var pushX = clamp(dx * size * 23, -2 * size, 2 * size);
      var pushY = clamp(dy * size * 23, -2 * size, 2 * size);
      for (var row = Math.max(1, Math.floor(cy - radius)); row < Math.min(size - 1, cy + radius); row++) {
        for (var col = Math.max(1, Math.floor(cx - radius)); col < Math.min(size - 1, cx + radius); col++) {
          var influence = Math.max(0, 1 - Math.hypot(col - cx, row - cy) / radius);
          var i = row * size + col;
          u[i] = clamp(u[i] + pushX * influence, -2 * size, 2 * size);
          v[i] = clamp(v[i] + pushY * influence, -2 * size, 2 * size);
        }
      }
    }

    function step(delta) {
      var dt = clamp(delta, 0, 0.04);
      project(u, v);
      advect(nextU, u, u, v, size, dt);
      advect(nextV, v, u, v, size, dt);
      var damping = 1 / (1 + 1.8 * dt);
      for (var i = 0; i < cells; i++) {
        u[i] = nextU[i] * damping;
        v[i] = nextV[i] * damping;
      }
      project(u, v);

      advect(nextDeveloper, developer, u, v, size, dt);
      advect(nextBromide, bromide, u, v, size, dt);
      for (var cy = 0, cell = 0; cy < size; cy++) {
        var sampleRow = Math.floor((cy + 0.5) * densitySize / size) * densitySize;
        for (var cx = 0; cx < size; cx++, cell++) {
          var paper = sampleRow + Math.floor((cx + 0.5) * densitySize / size);
          var activity = Math.abs(u[cell]) + Math.abs(v[cell]);
          var exchange = (0.09 + Math.min(1, activity * 5 / size) * 1.5) * dt;
          var fresh = nextDeveloper[cell], waste = nextBromide[cell];
          var consumed = (target[paper] - density[paper]) * fresh * dt * 0.85 / (1 + 3 * waste);
          developer[cell] = clamp(fresh + (1 - fresh) * exchange - consumed, 0, 1);
          bromide[cell] = clamp(waste * (1 - exchange) + consumed, 0, 1);
        }
      }
      for (var row = 0, p = 0; row < densitySize; row++) {
        var fy = (row + 0.5) * size / densitySize - 0.5;
        for (var col = 0; col < densitySize; col++, p++) {
          var fx = (col + 0.5) * size / densitySize - 0.5;
          var chemical = sample(developer, size, fx, fy);
          var inhibitor = sample(bromide, size, fx, fy);
          density[p] += (target[p] - density[p]) * chemical * dt * 0.85 / (1 + 3 * inhibitor);
        }
      }
    }

    return { stir: stir, step: step, density: density };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { create: create };
  else window.FluidPrototype = { create: create };
}());
