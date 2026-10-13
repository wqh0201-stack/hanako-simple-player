/** 音频权威独立于播放快照：旧 iframe 的排队 POST/beacon 不能夺回 owner。
 * 宿主 storage 原子落盘不是 CAS；所有授权/让位/交接在这条 App 请求链内串行。
 * 没有静默过期：未收到暂停确认的 owner 仍视为活着，超时只能待命。 */
export const AUDIO_OWNER_KEY = 'player-audio-owner';
const services = new WeakMap();
const copy = (value) => JSON.parse(JSON.stringify(value));
const invalid = (message) => Object.assign(new Error(message), { code: 400 });

export function createAudioOwner({ storage, writePlayback }) {
  let tail = Promise.resolve(), current = null;
  const serial = (work) => {
    const next = tail.then(work);
    tail = next.catch(() => {});
    return next;
  };
  const load = async () => {
    if (current) return current;
    const saved = await storage.get(AUDIO_OWNER_KEY, null);
    current = saved && typeof saved.ownerId === 'string' && Number.isSafeInteger(saved.revision)
      ? copy(saved) : { ownerId: '', at: 0, revision: 0, generation: 0, claimId: '', pending: null, resume: false };
    return current;
  };
  const commit = async (next) => {
    await storage.set(AUDIO_OWNER_KEY, next);
    current = next; // 写失败绝不返回“已获准”，也不能污染后续申请。
    return copy(next);
  };
  const identity = (input) => {
    if (!input || typeof input.ownerId !== 'string' || !/^[a-z0-9-]{1,96}$/i.test(input.ownerId)) throw invalid('ownerId required');
    if (typeof input.claimId !== 'string' || !/^[a-z0-9-]{1,160}$/i.test(input.claimId)) throw invalid('claimId required');
  };
  const owns = (record, input) => record.ownerId === input.ownerId && record.generation === Number(input.generation);
  const grant = (record, ownerId, claimId) => ({ ownerId, claimId, at: Date.now(), revision: record.revision + 1,
    generation: record.revision + 1, pending: null, resume: false });
  const cleared = (record, resume, cause = 'stop') => ({ ownerId: '', claimId: '', at: Date.now(), revision: record.revision + 1,
    generation: record.revision + 1, pending: null, resume: !!resume, cause });
  const result = (record, input) => ({ ok: true, granted: owns(record, { ...input, generation: record.generation }) && !record.pending,
    record: copy(record) });

  return {
    read: () => serial(async () => copy(await load())),
    command(input) {
      identity(input);
      return serial(async () => {
        let record = await load();
        if (input.action === 'claim') {
          // 浏览器证明只对所读的旧 owner/generation 有效；延迟 reap 不能清掉后来者。
          if (input.reap === true && record.ownerId && record.ownerId !== input.ownerId
            && record.ownerId === input.reapOwnerId && record.generation === input.reapGeneration) {
            record = await commit(cleared(record, false, 'reap'));
          }
          if (input.reason === 'restore' && (record.ownerId || record.pending) && record.ownerId !== input.ownerId) return result(record, input);
          if (record.ownerId === input.ownerId && !record.pending) return result(record, input);
          if (!record.ownerId) return result(await commit(grant(record, input.ownerId, input.claimId)), input);
          const next = { ...record, revision: record.revision + 1, at: Date.now(),
            pending: { ownerId: input.ownerId, claimId: input.claimId, fromGeneration: record.generation } };
          return result(await commit(next), input);
        }
        if (input.action === 'yield') {
          if (!owns(record, input) || !record.pending || record.pending.claimId !== input.claimId) return result(record, input);
          // 暂停者的 false 先落盘，再发布新授权；接管者不能抢在这一步前出声。
          if (input.snapshot) await writePlayback({ ...input.snapshot, playing: false });
          const pending = record.pending;
          const next = pending.ownerId ? grant(record, pending.ownerId, pending.claimId) : cleared(record, false);
          return result(await commit(next), input);
        }
        if (input.action === 'stop') {
          if (owns(record, input) || !record.ownerId || (input.reap === true
            && record.ownerId === input.reapOwnerId && record.generation === input.reapGeneration)) {
            if (input.snapshot) await writePlayback({ ...input.snapshot, playing: false });
            return result(await commit(cleared(record, false)), input);
          }
          return result(await commit({ ...record, revision: record.revision + 1, at: Date.now(),
            pending: { ownerId: '', claimId: input.claimId, fromGeneration: record.generation } }), input);
        }
        if (input.action === 'handoff' || input.action === 'release') {
          // 后来者已有申请时，卸载只能完成那次让位，不能把旧曲目的续播意图压回去。
          if (!owns(record, input)) return result(record, input);
          if (record.pending) {
            if (input.snapshot) await writePlayback({ ...input.snapshot, playing: false });
            const pending = record.pending;
            return result(await commit(pending.ownerId ? grant(record, pending.ownerId, pending.claimId) : cleared(record, false)), input);
          }
          const resume = input.action === 'handoff' && !!input.snapshot?.playing;
          if (input.snapshot) await writePlayback({ ...input.snapshot, playing: resume });
          return result(await commit(cleared(record, resume, input.action)), input);
        }
        throw invalid('unknown audio owner action');
      });
    },
    savePlayback(snapshot, input) {
      return serial(async () => {
        const record = await load();
        // 零 revision 保留旧包首次迁移；启用仲裁后，无身份/旧 generation 全部拒写。
        const accepted = record.revision === 0 || (!record.ownerId && !record.pending && !record.resume && !snapshot.playing && !!input.ownerId)
          || (owns(record, input) && record.ownerId && !(record.pending && snapshot.playing));
        if (accepted) await writePlayback(snapshot);
        return { ok: true, accepted: !!accepted };
      });
    }
  };
}

export function audioOwnerFor(ctx, writePlayback) {
  if (!services.has(ctx)) services.set(ctx, createAudioOwner({ storage: ctx.storage.global, writePlayback }));
  return services.get(ctx);
}
