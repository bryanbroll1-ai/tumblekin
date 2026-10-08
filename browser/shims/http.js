module.exports = { createServer: () => ({ listen() {}, close(cb) { cb?.(); } }) };
