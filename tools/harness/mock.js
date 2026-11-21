/* 模拟宿主：只用于本地测试，绝不进 zip。由 tools/harness/build.py 插到页面里、排在 bridge.js 之前。
   URL 参数：init=prism,rainbow 预置已收集材质；count=12 预置冲洗次数；sd/wd 存储读/写延迟毫秒；rf=1 读取失败；
   wf=N 前 N 次写卡册失败；td 写临时文件延迟；manualgyro=1 陀螺仪启动结果手动放行（window.__g.starts[i].res()）。
   window.__g 里能看到存储、陀螺仪订阅、存相册记录；最近一次导出图的 data URL 在 window.__g.lastData。
   测试助手：window.__round(devMs) 自动跑一轮到出片页；window.__reveal() 领取并翻开小卡。 */
/* 测试宿主：rAF 改用 setTimeout，Orca 后台标签页里也能推进显影（后台约 1 帧/秒，dt 上限 0.5s） */
(function () { window.requestAnimationFrame = function (cb) { return setTimeout(function () { cb(performance.now()); }, 16); }; window.cancelAnimationFrame = function (id) { clearTimeout(id); }; })();

(function () {
  var q = {}; location.search.slice(1).split('&').forEach(function (kv) { var p = kv.split('='); if (p[0]) q[p[0]] = decodeURIComponent(p[1] || ''); });
  var store = {};
  if (q.init) store['darkroom.cards'] = JSON.stringify(q.init.split(','));
  if (q.count) store['darkroom.count'] = JSON.stringify(Number(q.count));
  var G = window.__g = { regs: [], starts: [], stopCalls: 0, running: false, saved: [], temp: [], store: store, tempDelay: Number(q.td || 0), storeDelay: Number(q.sd || 0) };
  function later(ms, v) { return new Promise(function (res) { setTimeout(function () { res(v); }, ms); }); }
  window.xhs = { launchOptions: { miniToolEnv: { buildVersion: 9999000 } }, miniTool: {
    getStorage: function (o) { if (q.rf) return later(G.storeDelay, null).then(function () { throw { errMsg: 'getStorage:fail' }; }); return later(G.storeDelay, { data: store[o.key] == null ? null : store[o.key] }); },
    setStorage: function (o) { var wd = Number(q.wd || 0); G.inflight = G.inflight || {}; G.maxInflight = G.maxInflight || {}; G.writes = G.writes || []; G.inflight[o.key] = (G.inflight[o.key] || 0) + 1; G.maxInflight[o.key] = Math.max(G.maxInflight[o.key] || 0, G.inflight[o.key]); G.writes.push(o.key + '=' + o.data); G.fails = G.fails || {}; var failN = Number(q.wf || 0); var fk = o.key === 'darkroom.cards'; return later(wd, null).then(function () { G.inflight[o.key]--; if (fk && (G.fails.cards || 0) < failN) { G.fails.cards = (G.fails.cards || 0) + 1; return { errMsg: 'setStorage:fail' }; } store[o.key] = o.data; return { errMsg: 'setStorage:ok' }; }); },
    onGyroscopeChange: function (cb) { if (G.regs.indexOf(cb) < 0) G.regs.push(cb); },
    offGyroscopeChange: function (cb) { G.regs = cb ? G.regs.filter(function (x) { return x !== cb; }) : []; },
    startGyroscope: function () { G.running = true; var d = {}; d.p = new Promise(function (res) { d.res = res; }); G.starts.push(d); if (!q.manualgyro) d.res({}); return d.p; },
    stopGyroscope: function () { G.stopCalls++; G.running = false; return Promise.resolve(); },
    vibrateShort: function () { return Promise.resolve(); },
    writeTempFile: function (o) { var n = G.temp.length + 1; G.temp.push(n); G.lastData = o.data; return later(G.tempDelay, { filePath: 'tmp://shot' + n + '.jpg' }); },
    saveImageToPhotosAlbum: function (o) { G.saved.push(o.filePath); return Promise.resolve({ errMsg: 'saveImageToPhotosAlbum:ok' }); }
  } };
})();

window.__round = function (devMs) {
  return new Promise(function (resolve) {
    (function go() { var s = document.getElementById('use-sample'); if (s.disabled || !document.getElementById('screen-intro').offsetParent && document.getElementById('screen-intro').hidden) { return setTimeout(go, 150); } s.click();
      setTimeout(function () { document.getElementById('pull-out').click();
        setTimeout(function () { document.getElementById('fix-hold').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, isPrimary: true }));
          setTimeout(function () { document.getElementById('lights-on').click();
            (function wait() { if (!document.getElementById('screen-result').hidden) return setTimeout(resolve, 300); setTimeout(wait, 150); })();
          }, 4400); }, 600); }, devMs || 9500); })();
  });
};
window.__reveal = function () { document.getElementById('open-card').click(); return new Promise(function (r) { setTimeout(function () { var c = document.getElementById('holo-card'), b = c.getBoundingClientRect(), x = b.left + b.width / 2, y = b.top + b.height / 2; c.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 77, isPrimary: true, clientX: x, clientY: y })); c.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 77, isPrimary: true, clientX: x, clientY: y })); setTimeout(r, 1600); }, 600); }); };
