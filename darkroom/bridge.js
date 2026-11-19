/* 平台能力封装：只调用在线文档列出的 window.xhs.miniTool 接口，缺失时降级 */
(function () {
  'use strict';

  var MIN = { storage: 9460, windowInfo: 9490, vibrate: 9500, gyro: 9500 };
  var versionPromise = null;

  function mt() { return window.xhs && window.xhs.miniTool; }
  function has(name) { var m = mt(); return !!m && typeof m[name] === 'function'; }
  function readBuild(o) { var env = o && o.miniToolEnv; return Number(env && env.buildVersion) || 0; }

  function clientVersion() {
    if (versionPromise) return versionPromise;
    versionPromise = (function () {
      var sync = readBuild(window.xhs && window.xhs.launchOptions);
      if (sync) return Promise.resolve(Math.floor(sync / 1000));
      if (!has('getLaunchOptions')) return Promise.resolve(0);
      return mt().getLaunchOptions().then(function (o) {
        return Math.floor(readBuild(o) / 1000);
      }, function () { return 0; });
    }());
    return versionPromise;
  }

  function atLeast(min, name) {
    return clientVersion().then(function (v) { return v >= min && has(name); });
  }

  var Bridge = {
    inApp: function () { return !!mt(); },

    getWindowInfo: function () {
      return atLeast(MIN.windowInfo, 'getWindowInfo').then(function (ok) {
        return ok ? mt().getWindowInfo().catch(function () { return null; }) : null;
      });
    },

    getNumber: function (key) {
      return atLeast(MIN.storage, 'getStorage').then(function (ok) {
        if (!ok) return null;
        return mt().getStorage({ key: key }).then(function (r) {
          var n = r && r.data != null ? Number(JSON.parse(r.data)) : 0;
          return isFinite(n) ? n : 0;
        }, function () { return null; });
      });
    },

    setNumber: function (key, n) {
      return atLeast(MIN.storage, 'setStorage').then(function (ok) {
        if (!ok) return false;
        return mt().setStorage({ key: key, data: JSON.stringify(n) }).then(function (r) {
          return !!r && r.errMsg === 'setStorage:ok';
        }, function () { return false; });
      });
    },

    vibrate: function (type) {
      atLeast(MIN.vibrate, 'vibrateShort').then(function (ok) {
        if (ok) mt().vibrateShort({ type: type || 'light' }).catch(function () {});
      });
    },

    /* 陀螺仪：回调拿到绕三轴的角速度（rad/s）。返回 Promise<boolean> 表示是否开始采集 */
    startGyro: function (cb) {
      return atLeast(MIN.gyro, 'startGyroscope').then(function (ok) {
        if (!ok || !has('onGyroscopeChange')) return false;
        mt().onGyroscopeChange(cb);
        return mt().startGyroscope({ interval: 'ui' }).then(function () { return true; }, function () {
          if (has('offGyroscopeChange')) mt().offGyroscopeChange(cb);
          return false;
        });
      });
    },

    stopGyro: function (cb) {
      if (has('offGyroscopeChange')) mt().offGyroscopeChange(cb);
      if (has('stopGyroscope')) mt().stopGyroscope().catch(function () {});
    },

    /* 把 data URI 写成临时文件，存相册和发笔记都用文件路径 */
    toTempFile: function (dataUrl) {
      if (!has('writeTempFile')) return Promise.reject({ errMsg: 'unsupported' });
      return mt().writeTempFile({ data: dataUrl }).then(function (r) { return r.filePath; });
    },

    saveImage: function (filePath) {
      if (!has('saveImageToPhotosAlbum')) return Promise.reject({ errMsg: 'unsupported' });
      return mt().saveImageToPhotosAlbum({ filePath: filePath });
    },

    postNote: function (filePath, title, content) {
      if (!has('postNote')) return Promise.reject({ errMsg: 'unsupported' });
      return mt().postNote({
        title: title,
        content: content,
        pageType: 'photo_publish',
        mediaInfo: { image_resources: [{ url: filePath }] }
      });
    }
  };

  window.Bridge = Bridge;
}());
