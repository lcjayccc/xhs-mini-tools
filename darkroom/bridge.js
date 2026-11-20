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

  var gyroUsers = [], gyroCancelled = [];
  function releaseGyro(cb) {
    var i = gyroUsers.indexOf(cb);
    if (i >= 0) gyroUsers.splice(i, 1);
    if (has('offGyroscopeChange')) mt().offGyroscopeChange(cb);
    if (!gyroUsers.length && has('stopGyroscope')) mt().stopGyroscope().catch(function () {});
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

    /* 存一个字符串数组（如已收集的小卡材质）。容器不支持时返回 null，数据损坏时当作空列表 */
    getList: function (key) {
      return atLeast(MIN.storage, 'getStorage').then(function (ok) {
        if (!ok) return null;
        return mt().getStorage({ key: key }).then(function (r) {
          if (!r || r.data == null) return [];
          try {
            var v = JSON.parse(r.data);
            return Array.isArray(v) ? v : [];
          } catch (e) { return []; }
        }, function () { return null; });
      });
    },

    setList: function (key, list) {
      return atLeast(MIN.storage, 'setStorage').then(function (ok) {
        if (!ok) return false;
        return mt().setStorage({ key: key, data: JSON.stringify(list) }).then(function (r) {
          return !!r && r.errMsg === 'setStorage:ok';
        }, function () { return false; });
      });
    },

    vibrate: function (type) {
      atLeast(MIN.vibrate, 'vibrateShort').then(function (ok) {
        if (ok) mt().vibrateShort({ type: type || 'light' }).catch(function () {});
      });
    },

    /* 陀螺仪：回调拿到绕三轴的角速度（rad/s）。返回 Promise<boolean> 表示是否开始采集。
       原生采集是全局的，多个使用者（显影、小卡）共用：最后一个使用者释放时才停采集 */
    startGyro: function (cb) {
      return atLeast(MIN.gyro, 'startGyroscope').then(function (ok) {
        // 启动还没到这一步就被 stopGyro 取消了：不再登记
        var c = gyroCancelled.indexOf(cb);
        if (c >= 0) { gyroCancelled.splice(c, 1); return false; }
        if (!ok || !has('onGyroscopeChange')) return false;
        mt().onGyroscopeChange(cb);
        if (gyroUsers.indexOf(cb) < 0) gyroUsers.push(cb);
        return mt().startGyroscope({ interval: 'ui' }).then(function () {
          return gyroUsers.indexOf(cb) >= 0;
        }, function () {
          releaseGyro(cb);
          return false;
        });
      });
    },

    stopGyro: function (cb) {
      if (gyroUsers.indexOf(cb) < 0) { if (gyroCancelled.indexOf(cb) < 0) gyroCancelled.push(cb); }
      releaseGyro(cb);
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
