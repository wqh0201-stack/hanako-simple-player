/** 网易云官方元数据/取词的全局节流与 405/429 冷却。
 *  真实请求起始间隔至少 2s；405/429 后 60s 冷却；并发/重试共用同一闸门。
 *  冷却会立即拒绝已排队/等待中的任务，避免 60s 后补发。 */
export class CooldownError extends Error {
  constructor(message, { code = 429, stage = '', retryAfterMs = 0 } = {}) {
    super(message || '上游暂时拒绝请求');
    this.name = 'CooldownError';
    this.cooldown = true;
    this.code = code;
    this.stage = stage;
    this.retryAfterMs = Math.max(0, retryAfterMs);
  }
}
function abortError() {
  const e = new Error('Aborted'); e.name = 'AbortError'; return e;
}
export function createRequestGate({ minInterval = 2000, cooldownMs = 60000, now = () => Date.now(), sleep } = {}) {
  let nextAt = 0, coolingUntil = 0, coolingInfo = null, generation = 0, tail = Promise.resolve();
  const waiters = new Set();
  const pause = (ms, signal) => new Promise((resolve, reject) => {
    let timer = null, done = false;
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    };
    const finish = ok => { if (done) return; done = true; cleanup(); ok ? resolve() : reject(abortError()); };
    const onAbort = () => finish(false);
    if (signal?.aborted) return finish(false);
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    if (sleep) {
      Promise.resolve(sleep(ms, signal)).then(() => finish(true), () => finish(false));
    } else {
      timer = setTimeout(() => finish(true), ms);
    }
  });
  function state() {
    return { minInterval, cooldownMs, cooling: coolingUntil > now(),
      retryAfterMs: Math.max(0, coolingUntil - now()),
      code: coolingInfo?.code || 0, stage: coolingInfo?.stage || '' };
  }
  function cooldownError() {
    return new CooldownError('上游暂时拒绝请求，请稍后重试', {
      code: coolingInfo?.code || 429, stage: coolingInfo?.stage || '',
      retryAfterMs: Math.max(0, coolingUntil - now()) });
  }
  function cool(code, stage) {
    coolingUntil = Math.max(coolingUntil, now() + cooldownMs);
    coolingInfo = { code: Number(code) || 429, stage: stage || '' };
    generation++;
    const list = Array.from(waiters);
    waiters.clear();
    list.forEach(w => w.reject(cooldownError()));
    return coolingUntil - now();
  }
  function schedule(signal) {
    if (signal?.aborted) return Promise.reject(abortError());
    if (coolingUntil > now()) return Promise.reject(cooldownError());
    const gen = generation;
    let waiter;
    const gatePromise = new Promise((resolve, reject) => {
      waiter = { reject, resolve };
      waiters.add(waiter);
      // 关键：run 必须等 tail（上一项真正放行后）再启动，不能只把结果挂到 tail。
      const work = tail.catch(() => {}).then(async () => {
        try {
          while (true) {
            if (signal?.aborted) throw abortError();
            if (gen !== generation || coolingUntil > now()) throw cooldownError();
            const delay = Math.max(0, nextAt - now());
            if (delay > 0) await pause(delay, signal);
            if (signal?.aborted) throw abortError();
            if (gen !== generation || coolingUntil > now()) throw cooldownError();
            nextAt = now() + minInterval;
            waiter.resolve();
            return;
          }
        } catch (e) { waiter.reject(e); }
        finally { waiters.delete(waiter); }
      });
      tail = work;
    });
    return gatePromise;
  }
  return { schedule, cool, state };
}

export const neteaseGate = createRequestGate();
