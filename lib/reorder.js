/** Move one existing entry. Never accept a stale full library as a sort request. */
export function moveBefore(items, key, beforeKey, keyOf) {
  const bad = (message, code = 400) => Object.assign(new Error(message), { code });
  if (typeof key !== 'string' || !key || (beforeKey !== null && (typeof beforeKey !== 'string' || !beforeKey))) throw bad('invalid reorder target');
  if (key === beforeKey) throw bad('cannot move an entry before itself');
  if (new Set(items.map(keyOf)).size !== items.length) throw bad('duplicate reorder identities', 409);
  const source = items.find((item) => keyOf(item) === key);
  if (!source) throw bad('reorder target no longer exists', 409);
  const next = items.filter((item) => keyOf(item) !== key);
  const at = beforeKey === null ? next.length : next.findIndex((item) => keyOf(item) === beforeKey);
  if (at < 0) throw bad('reorder anchor no longer exists', 409);
  next.splice(at, 0, source);
  return next;
}

/** Other lists keep their exact entries and slots, including unknown metadata. */
export function reorderTracks(tracks, { list, id, beforeId, url, beforeUrl } = {}) {
  const bad = (message, code = 400) => Object.assign(new Error(message), { code });
  if (typeof list !== 'string' || !list.trim() || list === 'recent') throw bad('this list cannot be manually reordered');
  if (typeof id !== 'string' || !id || (beforeId !== null && (typeof beforeId !== 'string' || !beforeId))) throw bad('invalid track reorder');
  const own = tracks.filter((t) => t && t.list === list);
  // Legacy recordings without an id are matched by their complete URL, never a stripped query.
  const locate = (wanted, source) => own.find((t) => t.id ? String(t.id) === wanted : typeof source === 'string' && source && t.url === source);
  const target = locate(id, url), anchor = beforeId === null ? null : locate(beforeId, beforeUrl);
  if (!target || (beforeId !== null && !anchor)) throw bad('track or anchor no longer exists', 409);
  const keyOf = (t) => t.id ? 'id:' + String(t.id) : 'url:' + String(t.url);
  const ordered = moveBefore(own, keyOf(target), anchor ? keyOf(anchor) : null, keyOf);
  let at = 0;
  return tracks.map((t) => t && t.list === list ? ordered[at++] : t);
}
