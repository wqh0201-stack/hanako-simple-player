import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { listsFor, DEFAULT_LISTS, LIBRARY_CHANGED_KEY } from "./lists.js";

const invalid = (message) => Object.assign(new Error(message), { code: 400 });
export async function publishLibraryChange(ctx) {
  await ctx.storage.global.set(LIBRARY_CHANGED_KEY, randomUUID());
}
export function readLibrary(ctx) {
  const file = path.join(ctx.dataDir, "playlist.json");
  if (!fs.existsSync(file)) return [];
  const tracks = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(tracks)) throw new Error("invalid playlist.json");
  return tracks;
}

/** 老 UI 仍可全量替换；新 UI 附已读快照，只应用自己真正改过的字段和删除。 */
export function mergeLibrarySnapshot(latest, base, incoming, keyOf) {
  const before = new Map(base.map((track) => [keyOf(track), track]));
  const after = new Map(incoming.map((track) => [keyOf(track), track]));
  const current = new Map(latest.filter((track) => !before.has(keyOf(track)) || after.has(keyOf(track)))
    .map((track) => [keyOf(track), { ...track }]));
  for (const entry of incoming) {
    const key = keyOf(entry), old = before.get(key), found = current.get(key);
    if (old && !found) continue; // agent 已删掉的条目不会因 UI 的旧快照复活。
    if (!old) { current.set(key, { ...found, ...entry }); continue; }
    const merged = { ...found };
    for (const field of new Set([...Object.keys(old), ...Object.keys(entry)])) {
      if (JSON.stringify(old[field]) === JSON.stringify(entry[field])) continue;
      if (Object.hasOwn(entry, field)) merged[field] = entry[field];
      else delete merged[field];
    }
    current.set(key, merged);
  }
  // 新导入仍置顶；没有改顺序的旧快照不能撤销另一窗口刚完成的排序。
  const added = incoming.filter((track) => !before.has(keyOf(track))).map((track) => current.get(keyOf(track))).filter(Boolean);
  const addedKeys = new Set(added.map(keyOf));
  let result = added.concat([...current.values()].filter((track) => !addedKeys.has(keyOf(track))));
  const scopes = new Set(incoming.map((track) => String(track.list || '')));
  for (const list of scopes) {
    const common = (track) => String(track.list || '') === list && before.has(keyOf(track)) && after.has(keyOf(track)) && current.has(keyOf(track));
    const oldOrder = base.filter(common).map(keyOf), newOrder = incoming.filter(common).map(keyOf);
    if (JSON.stringify(oldOrder) === JSON.stringify(newOrder)) continue;
    const keys = new Set(newOrder);
    let at = 0;
    result = result.map((track) => keys.has(keyOf(track)) ? current.get(newOrder[at++]) : track);
  }
  return result;
}

function withFixedLists(lists) {
  const next = lists.map((x) => ({ ...x }));
  for (const item of DEFAULT_LISTS) if (!next.some((x) => x.id === item.id)) next.push({ ...item });
  return next;
}

export function nextListId(lists, tracks) {
  let max = 0;
  for (const id of [...lists.map((x) => x.id), ...tracks.map((x) => x?.list)]) {
    const match = /^imp:(\d+)$/.exec(String(id || ""));
    if (match) max = Math.max(max, Number(match[1]));
  }
  if (!Number.isSafeInteger(max + 1)) throw new Error("import list id exhausted");
  return `imp:${max + 1}`;
}

/** UI 也向这同一个写者预留编号；不存在「前端先猜一个，后端再另算一个」。 */
export function reserveList(ctx, { name, prefix = "歌单" } = {}) {
  if (name !== undefined && (typeof name !== "string" || !name.trim())) throw invalid("name required");
  if (typeof prefix !== "string" || !prefix.trim()) throw invalid("prefix required");
  const service = listsFor(ctx);
  return service.serial(async () => {
    const lists = withFixedLists(await service.read());
    const id = nextListId(lists, readLibrary(ctx));
    const item = { id, name: name?.trim() || `${prefix.trim()} ${id.slice(4)}` };
    await service.write([...lists, item]);
    return item;
  });
}

function idFromSource(source, name) {
  const media = /\/widget\/media\/([^/?#]+)/.exec(source);
  if (media) return decodeURIComponent(media[1]);
  const go = /\/music\/go\/([A-Za-z0-9_-]+)(?:\?[^#]*)?/.exec(source);
  const server = /[?&]server=([^&#]+)/.exec(source);
  if (go) return (server ? decodeURIComponent(server[1]) : "netease") + ":" + go[1];
  const id = /[?&]id=([^&#]+)/.exec(source);
  if (id && server) return decodeURIComponent(server[1]) + ":" + decodeURIComponent(id[1]);
  // 无平台 id 时沿用 UI deriveId 的 name: 格式，不为心情歌单另造一套曲目身份。
  return "name:" + name;
}

function validateTrack(track) {
  if (!track || typeof track.source !== "string" || !track.source.trim()) throw invalid("track source required");
  for (const key of ["name", "author", "pic", "lrcUrl"]) {
    if (track[key] !== undefined && typeof track[key] !== "string") throw invalid(`invalid track ${key}`);
  }
  if (track.dur !== undefined && (!Number.isFinite(track.dur) || track.dur < 0)) throw invalid("invalid track dur");
  return { ...track, source: track.source.trim() };
}

function writeLibrary(file, tracks) {
  const temp = `${file}.tmp-${randomUUID()}`;
  try {
    fs.writeFileSync(temp, JSON.stringify(tracks, null, 2), "utf8");
    fs.renameSync(temp, file);
  } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}

export function createList(ctx, { name, tracks } = {}) {
  if (typeof name !== "string" || !name.trim()) throw invalid("name required");
  if (!Array.isArray(tracks)) throw invalid("tracks must be an array");
  const incoming = tracks.map(validateTrack); // 一条坏曲目也不能造成同名歌单被先清空。
  const title = name.trim(), service = listsFor(ctx);
  return service.serial(async () => {
    const lists = withFixedLists(await service.read()), previous = readLibrary(ctx);
    const found = lists.find((x) => x.name === title);
    const listId = found?.id || nextListId(lists, previous);
    const entries = new Map();
    for (const track of incoming) {
      const original = previous.find((x) => x?.url === track.source);
      const trackName = track.name?.trim() || track.source.split("/").pop().split("?")[0] || "音频";
      const entry = original ? { ...original } : {
        id: idFromSource(track.source, trackName), url: track.source,
        name: trackName,
        mode: /^https?:\/\/|\/music\/go\//i.test(track.source) ? "在线" : "本地",
        dur: 0, group: /^https?:\/\/|\/music\/go\//i.test(track.source) ? "在线音乐" : "本地音乐",
      };
      entry.list = listId;
      if (track.name !== undefined) entry.name = track.name.trim() || entry.name;
      for (const key of ["author", "pic", "lrcUrl", "dur"]) if (track[key] !== undefined) entry[key] = track[key];
      // 已在库里的录音沿用 id/url 和未知字段；只有新副本的归属变化。
      entries.set(String(entry.id || entry.url), entry);
    }
    const keep = previous.filter((x) => x?.list !== listId);
    const next = [...entries.values(), ...keep];
    fs.mkdirSync(ctx.dataDir, { recursive: true });
    const file = path.join(ctx.dataDir, "playlist.json");
    const existed = fs.existsSync(file);
    // .bak-* 沿用仓库备份命名；UUID 防同毫秒两次覆盖把备份也盖掉。
    const backup = `${file}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`;
    if (existed) fs.copyFileSync(file, backup, fs.constants.COPYFILE_EXCL);
    writeLibrary(file, next);
    try {
      if (found) {
        // 名称未变时宿主可以不广播 player-lists；单独改一个小 revision 才能兑现即时覆盖。
        await publishLibraryChange(ctx);
      } else {
        await service.write([...lists, { id: listId, name: title }]);
      }
    } catch (err) {
      if (existed) fs.copyFileSync(backup, file);
      else fs.unlinkSync(file);
      throw err;
    }
    return { listId, name: title, count: entries.size, created: !found, replaced: !!found };
  });
}
