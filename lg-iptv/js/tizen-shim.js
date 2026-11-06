// Samsung Tizen TVs: register remote keys so color/media/number buttons reach the app.
(function () {
  if (!window.tizen || !tizen.tvinputdevice) return;
  ['MediaPlayPause','MediaPlay','MediaPause','MediaStop','MediaFastForward','MediaRewind','ColorF0Red','ColorF1Green','ColorF2Yellow','ColorF3Blue','ChannelUp','ChannelDown','0','1','2','3','4','5','6','7','8','9','Info','Guide']
    .forEach(function (k) { try { tizen.tvinputdevice.registerKey(k); } catch (e) {} });
})();
