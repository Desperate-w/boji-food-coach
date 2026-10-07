const path = require('node:path');
const net = require('node:net');
const {Store} = require('./store.js');

function positiveInteger(value, fallback, name) {
  if (value === undefined || value === '') return fallback;
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1) throw new Error(`${name} 必须是正整数。`);
  return result;
}

function clientAddress(req, trustedProxies = []) {
  const peer = req.socket.remoteAddress || 'unknown';
  // The supplied Caddy config overwrites X-Real-IP. Never trust a public peer's header.
  const forwarded = req.headers['x-real-ip'];
  return trustedProxies.includes(peer) && typeof forwarded === 'string' && net.isIP(forwarded)
    ? forwarded : peer;
}

class Gate {
  constructor(limit) { this.limit = limit; this.active = 0; }
  acquire() {
    if (this.active >= this.limit) return null;
    this.active++;
    let released = false;
    return () => { if (!released) { released = true; this.active--; } };
  }
}

class UserStores {
  constructor(dataDir, {limit = 64, idleMs = 300_000, factory = filename => new Store(filename)} = {}) {
    this.dataDir = dataDir;
    this.limit = limit;
    this.idleMs = idleMs;
    this.factory = factory;
    this.entries = new Map();
  }
  sweep(now = Date.now()) {
    for (const [id, entry] of this.entries) {
      if (!entry.refs && now - entry.usedAt >= this.idleMs) {
        entry.store.close(); this.entries.delete(id);
      }
    }
  }
  acquire(account) {
    this.sweep();
    let entry = this.entries.get(account.id);
    if (!entry) {
      if (this.entries.size >= this.limit) {
        const idle = [...this.entries].filter(([, value]) => !value.refs).sort((a, b) => a[1].usedAt - b[1].usedAt)[0];
        if (!idle) { const error = new Error('服务繁忙，请稍后重试。'); error.status = 503; throw error; }
        idle[1].store.close(); this.entries.delete(idle[0]);
      }
      const filename = account.storageKey === 'legacy' ? path.join(this.dataDir, 'boji.sqlite')
        : path.join(this.dataDir, 'users', account.id, 'boji.sqlite');
      entry = {store: this.factory(filename), refs: 0, usedAt: Date.now()};
      this.entries.set(account.id, entry);
    }
    entry.refs++;
    let released = false;
    return {store: entry.store, release: () => {
      if (!released) { released = true; entry.refs--; entry.usedAt = Date.now(); }
    }};
  }
  close() { for (const {store} of this.entries.values()) store.close(); this.entries.clear(); }
}

module.exports = {positiveInteger, clientAddress, Gate, UserStores};
