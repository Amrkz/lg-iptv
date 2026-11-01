var fs = require('fs');
var Service = require('webos-service');
var pkg = require('./package.json');
var proxy = require('./proxy');

var service = new Service(pkg.name);
var port = 0;
var starting = false;
var waiters = [];
var subscribers = {};

function log(line) {
  try { fs.appendFileSync('/tmp/lumio-proxy.log', String(line) + '\n'); } catch (e) {}
}

function answer(message, err) {
  if (err || !port) {
    message.respond({ returnValue: false, errorText: err ? String(err.message || err) : 'proxy failed' });
    return;
  }
  // A subscription that stays open is what keeps this service from exiting.
  var payload = { returnValue: true, port: port };
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
  proxy.listen(18491, function (err, p) {
    ready(err, p);
    if (!err && p && service.activityManager && service.activityManager.create) {
      try { service.activityManager.create('keepAlive', function () {}); } catch (e) { log('activity ' + e); }
    }
  });
}, function (message) {
  if (message && message.uniqueToken) delete subscribers[message.uniqueToken];
});
