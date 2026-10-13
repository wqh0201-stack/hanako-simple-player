/** 知识库《曲目元数据清洗》：版本保留、前缀 ≥3 才拆、UP 主不冒充歌手。 */
const VERSION = /版|remix|ver|cover|live|伴奏/i;
const NOISE = /\b(?:MV|PV|hi[ -]?res|hi[ -]?fi|flac|lossless|official(?:\s+(?:video|audio))?|LIVE)\b|(?:中日|双语|中文|日文|英文)字幕|中文字幕|中文翻译|[^\s（）()【】\[\]]*字幕组/gi;
const tidy = (s) => String(s || "").replace(/\u3000/g, " ").replace(/\s+/g, " ").trim();

function stripNoise(title) {
  const versions = [];
  let s = tidy(title).replace(/^\d{4}[年\s./-]+\d{1,2}[月\s./-]+\d{1,2}(?:日)?\s*/, "");
  s = s.replace(/【([^】]*)】|\[([^\]]*)\]|[（(]([^）)]*)[）)]/g, (_all, a, b, c) => {
    const inner = tidy(a ?? b ?? c);
    if (!VERSION.test(inner)) return " ";
    versions.push(`(${inner})`);
    return ` \u0001${versions.length - 1}\u0002 `;
  });
  s = s.replace(NOISE, " ").replace(/^\s*[-–—:：|｜]+|[-–—:：|｜]+\s*$/g, "");
  return tidy(s.replace(/\u0001(\d+)\u0002/g, (_all, index) => versions[Number(index)]));
}

function safeSinger(name) {
  const s = tidy(name);
  return s && s.length <= 32 && !/[\/|｜\d（）()【】\[\]]|账号已注销|UP主|字幕|录音|合集|大声听|官方/i.test(s) ? s : "";
}

export function singerPrefixes(tracks) {
  const counts = new Map();
  for (const track of tracks) {
    const m = /^(.+?)\s+[-–—]\s+(.+)$/.exec(stripNoise(track?.name || track?.title));
    if (m) counts.set(m[1], (counts.get(m[1]) || 0) + 1);
  }
  return counts;
}

export function cleanMusicMetadata(track, { server = "bilibili", prefixes = new Map() } = {}) {
  const original = tidy(track?.title || track?.name);
  let name = stripNoise(original), author = server === "bilibili" ? "" : tidy(track?.author);
  const book = /《([^》]+)》/.exec(name);
  if (book) {
    author = safeSinger(name.slice(0, book.index)) || author;
    // 书名号外是介绍文案；但任何版本标签都继续留在歌名里。
    const versions = name.replace(book[0], "").match(/[（(][^）)]*(?:版|remix|ver|cover|live|伴奏)[^）)]*[）)]/gi) || [];
    name = tidy(book[1] + (versions.length ? " " + versions.join(" ") : ""));
  } else {
    const split = /^(.+?)\s+[-–—]\s+(.+)$/.exec(name);
    if (split && (prefixes.get(split[1]) || 0) >= 3 && safeSinger(split[1])) {
      author = safeSinger(split[1]); name = tidy(split[2]);
    }
  }
  return { name: name || original || "未命名", author };
}

function titleKey(title) {
  return stripNoise(title).normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

export function pickMetadataMatch(clean, duration, candidates) {
  const wanted = titleKey(clean.name);
  if (!wanted) return null;
  const sameName = candidates.filter((candidate) => titleKey(candidate.title) === wanted);
  // 不设时长排除门槛；未知时长靠后，>60s 的最近候选依然可选，但要明确存疑。
  const delta = (candidate) => duration > 0 && candidate.dur > 0 ? Math.abs(candidate.dur - duration) : Infinity;
  sameName.sort((a, b) => delta(a) - delta(b));
  const hit = sameName[0];
  if (!hit) return null;
  const difference = delta(hit);
  return { hit, suspect: Number.isFinite(difference) && difference > 60, difference };
}
