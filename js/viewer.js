/** Parent-side wrapper that talks to the sandboxed viewer iframe */

export class Viewer {
  constructor(iframe) {
    this.iframe = iframe;
    this.waiters = new Map();          // type -> [resolve,reject][]
    this.onError = null;
    this.onOk = null;
    this.bootError = null;
    this._readyResolve = null;
    this._readyReject = null;
    this.ready = new Promise((res, rej) => { this._readyResolve = res; this._readyReject = rej; });
    this.ready.catch(() => {});   // boot failures are surfaced by the caller

    // if the viewer never comes up, report why instead of spinning forever
    this._bootTimer = setTimeout(() => {
      this._failBoot('The 3D sandbox viewer failed to start. Check that three.js on the CDN (unpkg.com) is reachable.');
    }, 20000);

    addEventListener('message', (e) => {
      if (e.source !== this.iframe.contentWindow) return;   // only trust our own sandbox
      this._handle(e.data);
    });

    iframe.src = './sandbox.html';
  }

  _handle(msg) {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.type) {
      case 'ready':
        clearTimeout(this._bootTimer);
        this._readyResolve?.();
        break;
      case 'boot-error':
        this._failBoot(msg.message);
        break;
      case 'ok':
        this._settle('run', msg.stats);
        this.onOk?.(msg.stats);
        break;
      case 'error':
        this._settle('run', null, new Error(msg.message));
        this.onError?.(msg.message);
        break;
      case 'shot':
      case 'thumb':
        this._settle(msg.type, msg.dataUrl);
        break;
      case 'glb':
        this._settle('export', msg.buffer);
        break;
    }
  }

  _failBoot(message) {
    if (this.bootError) return;
    clearTimeout(this._bootTimer);
    this.bootError = new Error(message);
    this._readyReject?.(this.bootError);
    this.onError?.(message);
  }

  _settle(type, value, error) {
    const list = this.waiters.get(type);
    if (!list?.length) return;
    this.waiters.set(type, []);
    for (const [resolve, reject] of list) error ? reject(error) : resolve(value);
  }

  _expect(type, timeout = 20000) {
    return new Promise((resolve, reject) => {
      const list = this.waiters.get(type) || [];
      list.push([resolve, reject]);
      this.waiters.set(type, list);
      setTimeout(() => reject(new Error('Viewer timed out (' + type + ')')), timeout);
    });
  }

  async _post(msg, transfer) {
    if (this.bootError) throw this.bootError;
    await this.ready;
    this.iframe.contentWindow.postMessage(msg, '*', transfer || []);
  }

  /** Run code — resolves with scene stats, rejects on failure */
  async run(code) {
    const done = this._expect('run', 30000);
    done.catch(() => {});
    await this._post({ type: 'run', code });
    return done;
  }

  async clear() { await this._post({ type: 'clear' }); }
  async setOptions(opts) { await this._post({ type: 'options', ...opts }); }

  async screenshot() {
    const done = this._expect('shot');
    await this._post({ type: 'shot' });
    return done;
  }

  async thumbnail() {
    const done = this._expect('thumb');
    await this._post({ type: 'thumb' });
    return done;
  }

  async exportGLB() {
    const done = this._expect('export', 60000);
    await this._post({ type: 'export' });
    return done;
  }
}
