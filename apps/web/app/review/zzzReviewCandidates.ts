export type ZzzReviewCandidate = {
  character: string;
  title: string;
  sourceUrl: string;
  artist?: string;
  sourceKind: "official" | "fan-art" | "fan-index" | "conversion" | "watch";
};

export const zzzReviewCandidates: ZzzReviewCandidate[] = [
  { character: "Jane Doe", title: "Agent Record", sourceUrl: "https://zenless.hoyoverse.com/en-us/news/124682", sourceKind: "official" },
  { character: "Jane Doe", title: "Media index", sourceUrl: "https://zenless-zone-zero.fandom.com/wiki/Jane_Doe/Media", sourceKind: "official" },
  { character: "Jane Doe", title: "Dynamic Wallpaper", sourceUrl: "https://zenless-zone-zero.fandom.com/wiki/Dynamic_Wallpaper%3A_Jane", sourceKind: "official" },
  { character: "Jane Doe", title: "Pixiv 121350488", sourceUrl: "https://www.pixiv.net/en/artworks/121350488", artist: "Ane O", sourceKind: "fan-art" },
  { character: "Jane Doe", title: "Community art thread", sourceUrl: "https://www.reddit.com/r/ZenlessZoneZero/comments/1fjv45m", artist: "includes @Hem_Oo_", sourceKind: "fan-index" },
  { character: "Jane Doe", title: "Procreate fanart", sourceUrl: "https://www.reddit.com/r/ZZZ_Official/comments/1uxvssr/fanart_jane_doe_procreate_timelapse/", artist: "@KueRangin_", sourceKind: "fan-art" },

  { character: "Remielle Dan", title: "Themed Wallpapers", sourceUrl: "https://zenless.hoyoverse.com/m/en-us/news/165585", sourceKind: "official" },
  { character: "Remielle Dan", title: "Agent Record", sourceUrl: "https://zenless.hoyoverse.com/en-us/news/164908", sourceKind: "official" },
  { character: "Remielle Dan", title: "Version 3.1 outfit material", sourceUrl: "https://zenless.hoyoverse.com/en-us/news/165365", sourceKind: "official" },
  { character: "Remielle Dan", title: "Pixivision feature", sourceUrl: "https://www.pixivision.net/en/a/12011", sourceKind: "fan-index" },
  { character: "Remielle Dan", title: "Swimsuit", sourceUrl: "https://www.pixiv.net/en/artworks/148011139", artist: "笑顏", sourceKind: "fan-art" },
  { character: "Remielle Dan", title: "KuroiDa", sourceUrl: "https://www.pixiv.net/en/artworks/147889286", artist: "KuroiDa", sourceKind: "fan-art" },
  { character: "Remielle Dan", title: "Megu", sourceUrl: "https://www.pixiv.net/en/artworks/148051190", artist: "Megu", sourceKind: "fan-art" },
  { character: "Remielle Dan", title: "Caba", sourceUrl: "https://www.pixiv.net/en/artworks/146201485", artist: "Caba", sourceKind: "fan-art" },
  { character: "Remielle Dan", title: "honelfir", sourceUrl: "https://www.reddit.com/r/ZenlessZoneZero/comments/1v7ignb/remielle_dan_fanart_by_honelfir/", artist: "honelfir", sourceKind: "fan-art" },
  { character: "Remielle Dan", title: "Live/static collection from official shorts", sourceUrl: "https://www.reddit.com/r/ZenlessZoneZero/comments/1v9qd0r/remielle_live_and_static_wallpaper_collection/", sourceKind: "conversion" },

  { character: "Velina Airgid", title: "Themed Wallpapers", sourceUrl: "https://zenless.hoyoverse.com/en-us/news/164981", sourceKind: "official" },
  { character: "Velina Airgid", title: "Agent Record", sourceUrl: "https://zenless.hoyoverse.com/en-us/news/163753", sourceKind: "official" },
  { character: "Velina Airgid", title: "Dynamic Wallpaper", sourceUrl: "https://zenless-zone-zero.fandom.com/wiki/Dynamic_Wallpaper%3A_Velina", sourceKind: "official" },
  { character: "Velina Airgid", title: "Traditional art 1", sourceUrl: "https://x.com/i/status/2071069089565696006", artist: "Bozsbots9785", sourceKind: "fan-art" },
  { character: "Velina Airgid", title: "Traditional art 2", sourceUrl: "https://x.com/i/status/2071182553357382132", artist: "Bozsbots9785", sourceKind: "fan-art" },
  { character: "Velina Airgid", title: "Tempest21", sourceUrl: "https://www.reddit.com/r/VelinaMains/comments/1txyz9k/velina_art_by_me_tempest21/", artist: "@Tempest21", sourceKind: "fan-art" },
  { character: "Velina Airgid", title: "Graphic", sourceUrl: "https://www.hoyolab.com/article/45947723", artist: "_caiserr", sourceKind: "fan-art" },

  { character: "Promeia", title: "Themed Wallpapers", sourceUrl: "https://zenless.hoyoverse.com/en-us/news/163994", sourceKind: "official" },
  { character: "Promeia", title: "Agent Record", sourceUrl: "https://zenless.hoyoverse.com/en-us/news/163280", sourceKind: "official" },
  { character: "Promeia", title: "The Judge's Downtime", sourceUrl: "https://zenless.hoyoverse.com/en-us/news/163898", sourceKind: "official" },
  { character: "Promeia", title: "Wallpaper-friendly OC", sourceUrl: "https://www.reddit.com/r/PromeiaMains/comments/1t4mw3y/did_a_promeia_fanart_excited_for_her/", artist: "Reddit OP / OC", sourceKind: "fan-art" },
  { character: "Promeia", title: "Fanart collection", sourceUrl: "https://www.reddit.com/r/PromeiaMains/comments/1usz7n1/i_combined_every_one_of_my_promeia_fanarts_whichs/", artist: "Reddit OP / OC", sourceKind: "fan-index" },
  { character: "Promeia", title: "aiden", sourceUrl: "https://www.reddit.com/r/PromeiaMains/comments/1tnxur1/promeia_art_by_aiden/", artist: "aiden", sourceKind: "fan-art" },
  { character: "Promeia", title: "Second fanart", sourceUrl: "https://www.reddit.com/r/ZenlessZoneZero/comments/1suervj/second_promeia_fanart_done_by_me/", artist: "Reddit OP / OC", sourceKind: "fan-art" },

  { character: "Cissia", title: "Themed Wallpapers", sourceUrl: "https://zenless.hoyoverse.com/en-us/news/163603", sourceKind: "official" },
  { character: "Cissia", title: "Agent Record", sourceUrl: "https://zenless.hoyoverse.com/en-us/news/162632", sourceKind: "official" },
  { character: "Cissia", title: "Character Demo", sourceUrl: "https://zenless.hoyoverse.com/en-us/news/163365", sourceKind: "official" },
  { character: "Cissia", title: "Dynamic wallpaper release note", sourceUrl: "https://zenless.hoyoverse.com/en-us/news/163253", sourceKind: "official" },
  { character: "Cissia", title: "yuki0art", sourceUrl: "https://x.com/yuki0art/status/2051764082751988051", artist: "yuki0art", sourceKind: "fan-art" },
  { character: "Cissia", title: "Game-night art", sourceUrl: "https://x.com/aragik3n/status/2046655424251003069", artist: "aragik3n", sourceKind: "fan-art" },
  { character: "Cissia", title: "icetea_art", sourceUrl: "https://www.reddit.com/r/CissiaMainsZZZ/comments/1svrp0i/cissia_icetea_art/", artist: "icetea_art", sourceKind: "fan-art" },
  { character: "Cissia", title: "WKojinak", sourceUrl: "https://www.reddit.com/r/ZenlessZoneZero/comments/1qzzbze/cissia_is_stunning_fanart_by_wkojinak/", artist: "WKojinak", sourceKind: "fan-art" },

  { character: "Claret Flint", title: "Agent Record", sourceUrl: "https://zenless.hoyoverse.com/en-us/news/165573", sourceKind: "official" },
  { character: "Claret Flint", title: "Version 3.2 Special Program", sourceUrl: "https://zenless.hoyoverse.com/en-us/news/165865?catchSpider=1", sourceKind: "official" },
  { character: "Claret Flint", title: "maxwelzyy", sourceUrl: "https://www.reddit.com/r/ZenlessZoneZero/comments/1szydzp/claret_maxwelzyy/", artist: "maxwelzyy", sourceKind: "fan-art" },
  { character: "Claret Flint", title: "AzureLotus", sourceUrl: "https://x.com/azl_1214/status/2020443789211410700/photo/1", artist: "AzureLotus", sourceKind: "fan-art" },
  { character: "Claret Flint", title: "Full-color Mindscape after official release", sourceUrl: "https://zenless.hoyoverse.com/en-us/main", sourceKind: "watch" },
];
