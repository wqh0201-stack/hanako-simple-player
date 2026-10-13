import { createList } from "../lib/library.js";

export function makeCreateListTool(ctx) {
  return {
    name: "hana_simple_create_list",
    description: "把一个歌单落进播放器，用户在播放器里就能看到并播放。当用户说「帮我弄个歌单」「按今天的心情来一个」「建个 XX 的歌单」时用。曲目先经 hana_simple_list_music（库里已有的）或 hana_simple_search_music（网上搜的）拿到，再把 source 原样传进来。歌单名已存在时会替换它的全部曲目（覆盖语义），不会越攒越多；传一个新名字就是新建。如果用户没说清想要什么，先问他今天什么状态再选曲。",
    parameters: {
      type: "object", required: ["name", "tracks"],
      properties: {
        name: { type: "string", description: "歌单名；同名覆盖全部曲目，新名字新建。" },
        tracks: { type: "array", items: { type: "object", required: ["source"], properties: {
          source: { type: "string", description: "list_music / search_music 返回的 source，原样传入。" },
          name: { type: "string" }, author: { type: "string" }, pic: { type: "string" },
          lrcUrl: { type: "string", description: "歌词地址，可用 search_music 返回的 lrcUrl。" }, dur: { type: "number" },
        } } },
      },
    },
    async execute(args) {
      try { return { content: [{ type: "text", text: JSON.stringify(await createList(ctx, args)) }] }; }
      catch (err) { return { isError: true, content: [{ type: "text", text: err?.message || String(err) }] }; }
    },
  };
}
