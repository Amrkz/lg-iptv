var fs = require('fs');
var Service = require('webos-service');
var pkg = require('./package.json');
var proxy = require('./proxy');

var service = new Service(pkg.name);
var port = 0;
var starting = false;
var waiters = [];
var subscribers = {};
var dlSubs = {};

function log(line) {
  try { fs.appendFileSync('/tmp/kayan-proxy.log', String(line) + '\n'); } catch (e) {}
}

function answer(message, err) {
  var tok = proxy.token();
  if (err || !port || !tok) {
    message.respond({ returnValue: false, errorText: err ? String(err.message || err) : 'proxy failed' });
    return;
  }
  var payload = { returnValue: true, port: port, token: tok };
  if (message.isSubscription) {
    payload.subscribed = true;
    subscribers[message.uniqueToken] = message;
  }
  message.respond(payload);
}

function ready(err, p) {
  starting = false;
  if (!err && p) port = p;
  log('listen ' + (err ? String(err.message || err) : port));
  var pending = waiters;
  waiters = [];
  pending.forEach(function (message) { answer(message, err); });
}

function keepAlive() {
  if (service.activityManager && service.activityManager.create) {
    try { service.activityManager.create('keepAlive', function () {}); } catch (e) { log('activity ' + e); }
  }
}

// A helper started earlier (boot.js) may already hold the port. Its token is
// the file written at listen time. Wait briefly so we return that token
// instead of opening a second port.
function openProxy() {
  proxy.listen(18491, function (err, p) {
    if (!err && p) {
      ready(null, p);
      keepAlive();
      return;
    }
    if (err && err.code === 'EADDRINUSE') {
      var tries = 0;
      var spin = function () {
        if (proxy.token()) { ready(null, 18491); return; }
        if (++tries > 20) { ready(err); return; }
        setTimeout(spin, 50);
      };
      spin();
      return;
    }
    ready(err || new Error('proxy failed'));
  });
}

function ensureListen(cb) {
  if (port) { cb(null, port); return; }
  waiters.push({
    isSubscription: false,
    respond: function () { cb(port ? null : new Error('proxy failed'), port); }
  });
  if (starting) return;
  starting = true;
  openProxy();
}

function dls() { return proxy.dls(); }

function withDl(message, fn) {
  ensureListen(function () {
    try { fn(dls()); }
    catch (e) { message.respond({ returnValue: false, errorText: String(e && e.message || e) }); }
  });
}

// subscribe:true keeps this process alive while the app is open
service.register('alive', function (message) {
  log('alive');
  if (port) {
    answer(message);
    return;
  }
  waiters.push(message);
  if (starting) return;
  starting = true;
  openProxy();
}, function (message) {
  if (message && message.uniqueToken) delete subscribers[message.uniqueToken];
});

service.register('dlSpace', function (message) {
  withDl(message, function (d) {
    d.space(function (err, sp) {
      message.respond(Object.assign({ returnValue: !err }, sp || {}, err ? { errorText: String(err.message || err) } : {}));
    });
  });
});

service.register('dlList', function (message) {
  withDl(message, function (d) {
    var snap = d.list();
    message.respond(Object.assign({ returnValue: true }, snap));
  });
});

service.register('dlStart', function (message) {
  withDl(message, function (d) {
    var body = message.payload || {};
    d.start(body, !!body.force, function (err, result) {
      if (err) message.respond({ returnValue: false, errorText: String(err.message || err) });
      else message.respond(Object.assign({ returnValue: !!(result && result.ok) }, result || {}));
    });
  });
});

service.register('dlPause', function (message) {
  withDl(message, function (d) {
    d.pause((message.payload || {}).id, function (err, r) {
      message.respond(Object.assign({ returnValue: !!(r && r.ok) }, r || {}));
    });
  });
});

service.register('dlResume', function (message) {
  withDl(message, function (d) {
    d.resume((message.payload || {}).id, function (err, r) {
      message.respond(Object.assign({ returnValue: !!(r && r.ok) }, r || {}));
    });
  });
});

service.register('dlCancel', function (message) {
  withDl(message, function (d) {
    d.cancel((message.payload || {}).id, function (err, r) {
      message.respond(Object.assign({ returnValue: !!(r && r.ok) }, r || {}));
    });
  });
});

service.register('dlRemove', function (message) {
  withDl(message, function (d) {
    d.remove((message.payload || {}).id, function (err, r) {
      message.respond(Object.assign({ returnValue: !!(r && r.ok) }, r || {}));
    });
  });
});

service.register('dlStatus', function (message) {
  withDl(message, function (d) {
    var snap = d.list();
    var payload = Object.assign({ returnValue: true }, snap);
    if (message.isSubscription) {
      payload.subscribed = true;
      var token = message.uniqueToken;
      dlSubs[token] = d.subscribe(function (s) {
        try { message.respond(Object.assign({ returnValue: true, subscribed: true }, s)); }
        catch (e) { delete dlSubs[token]; }
      });
    }
    message.respond(payload);
  });
}, function (message) {
  if (message && message.uniqueToken && dlSubs[message.uniqueToken]) {
    try { dlSubs[message.uniqueToken](); } catch (e) {}
    delete dlSubs[message.uniqueToken];
  }
});
