import { moveBefore } from './reorder.js';
/** 列表名字仍落宿主的 player-lists；路由和工具共用串行写者，避免跨 await 抢号。 */
export const LISTS_KEY = "player-lists";
export const LIBRARY_CHANGED_KEY = "player-library-revision";
export const DEFAULT_LISTS = [
  { id: "fav", name: "我的喜欢" },
  { id: "recent", name: "最近播放" },
  { id: "local", name: "本地" },
];

const services = new WeakMap();
const invalid = (message) => Object.assign(new Error(message), { code: 400 });

export function validateLists(lists) {
  if (!Array.isArray(lists)) throw invalid("lists must be an array");
  const seen = new Set();
  const clean = lists.map((item) => {
    if (!item || typeof item.id !== "string" || !item.id.trim()) throw invalid("list id required");
    if (seen.has(item.id)) throw invalid("duplicate list id");
    seen.add(item.id);
    if (typeof item.name !== "string" || !item.name.trim()) throw invalid("list name required");
    return { id: item.id, name: item.name };
  });
  for (const item of DEFAULT_LISTS) {
    if (!seen.has(item.id)) throw invalid(`missing fixed list: ${item.id}`);
  }
  return clean;
}

export function listsFor(ctx) {
  if (services.has(ctx)) return services.get(ctx);
  let tail = Promise.resolve();
  const serial = (work) => {
    const next = tail.then(work);
    tail = next.catch(() => {}); // 一次失败不能把后面的合法写入也毒死。
    return next;
  };
  const read = async () => {
    // APPS.md 的 global 是异步 RPC；按请求 await，不假定 apply 内同 tick 可读。
    const value = await ctx.storage.global.get(LISTS_KEY, []);
    if (value == null || (Array.isArray(value) && !value.length)) return DEFAULT_LISTS.map((x) => ({ ...x }));
    if (!Array.isArray(value)) throw new Error("invalid stored player-lists");
    return value.map(({ id, name }) => ({ id, name }));
  };
  const write = async (lists) => {
    await ctx.storage.global.set(LISTS_KEY, lists);
    return lists;
  };
  const service = {
    read,
    serial,
    write,
    reorder(id, beforeId) {
      return serial(async () => {
        const latest = await read();
        return write(validateLists(moveBefore(latest, id, beforeId, (item) => item.id)));
      });
    },
    put(lists, baseLists) {
      const clean = validateLists(lists); // 整份先验，400 绝不半写。
      const base = baseLists === undefined ? null : validateLists(baseLists);
      return serial(async () => {
        if (!base) return write(clean);
        // 前端全量快照只应用相对其已见版本的改动，保住同时由 agent 新建的歌单。
        const latest = await read();
        if (!latest.length) return write(clean);
        const before = new Map(base.map((x) => [x.id, x.name]));
        const after = new Map(clean.map((x) => [x.id, x.name]));
        const merged = latest.filter((x) => !before.has(x.id) || after.has(x.id));
        for (const item of clean) {
          if (before.get(item.id) === item.name) continue;
          const at = merged.findIndex((x) => x.id === item.id);
          if (at >= 0) merged[at] = item;
          else merged.push(item);
        }
        const oldOrder = base.filter((x) => after.has(x.id)).map((x) => x.id);
        const newOrder = clean.filter((x) => before.has(x.id)).map((x) => x.id);
        if (JSON.stringify(oldOrder) !== JSON.stringify(newOrder)) {
          const byId = new Map(merged.map((x) => [x.id, x]));
          return write(validateLists([...clean.map((x) => byId.get(x.id)), ...merged.filter((x) => !after.has(x.id))]));
        }
        return write(validateLists(merged));
      });
    },
  };
  services.set(ctx, service);
  return service;
}
