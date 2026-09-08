/** 샌드박스 iframe(뷰어)과 통신하는 부모 쪽 래퍼 */

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
    this.ready.catch(() => {});   // 부팅 실패는 호출부에서 처리한다

    // 뷰어가 살아나지 못하면 무한 로딩 대신 원인을 알린다
    this._bootTimer = setTimeout(() => {
      this._failBoot('뷰어(3D 샌드박스)를 초기화하지 못했습니다. three.js CDN(unpkg.com) 접근이 차단되지 않았는지 확인해 주세요.');
    }, 20000);

    addEventListener('message', (e) => {
      if (e.source !== this.iframe.contentWindow) return;   // 우리 샌드박스만 신뢰
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
      setTimeout(() => reject(new Error('뷰어 응답 시간 초과 (' + type + ')')), timeout);
    });
  }

  async _post(msg, transfer) {
    if (this.bootError) throw this.bootError;
    await this.ready;
    this.iframe.contentWindow.postMessage(msg, '*', transfer || []);
  }

  /** 코드 실행 → 성공 시 통계 객체, 실패 시 reject */
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
