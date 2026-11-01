// Standalone start. The TV's service bus does not always launch this
// service, and playback then stays on the browser User-Agent.
var fs = require('fs');
var proxy = require('./proxy');

function log(line) {
  try { fs.appendFileSync('/tmp/lumio-proxy.log', String(line) + '\n'); } catch (e) {}
}

proxy.listen(18491, function (err, port) {
  log(err ? String(err.message || err) : ('boot ' + port));
});
