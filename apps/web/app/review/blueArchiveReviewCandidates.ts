export type BlueArchiveReviewCandidate = {
  character: string;
  title: string;
  sourceUrl: string;
  previewImageUrl?: string;
  artist?: string;
  sourceKind: "official" | "official-mirror" | "fan-art" | "fan-index";
};

export const blueArchiveReviewCandidates: BlueArchiveReviewCandidate[] = [
  {
    character: "Abydos / Shiroko",
    title: "Classic key visual",
    sourceUrl: "https://bluearchive.nexon.com/",
    previewImageUrl: "https://ogre.natalie.mu/media/news/comic/2023/0122/bluearchive_key.jpg?imdensity=1&impolicy=lt&imwidth=1200",
    sourceKind: "official-mirror",
  },
  {
    character: "4th Anniversary ensemble",
    title: "4th Anniversary visual",
    sourceUrl: "https://4th-anniversary.bluearchive.jp/",
    previewImageUrl: "https://cdn.byline.network/wp-content/uploads/2025/02/BlueArchive_1.jpg",
    sourceKind: "official-mirror",
  },
  {
    character: "Yuuka",
    title: "Character profile graphic",
    sourceUrl: "https://bluearchive.nexon.com/",
    previewImageUrl: "https://cdn.9000.jp/upload/2024/03/07/202403071815347917.jpg",
    sourceKind: "official-mirror",
  },
  {
    character: "Hina",
    title: "Action / military wallpaper lead",
    sourceUrl: "https://www.pixiewall.com/wallpaper/hina-military-blue-archive-4k-32932",
    previewImageUrl: "https://www.pixiewall.com/content/wallpapers/medium/63/pixiewall-hina-military-blue-archive-4k-f1g8kf.jpg",
    sourceKind: "fan-index",
  },
  {
    character: "Ensemble",
    title: "Rooftop 4K group visual",
    sourceUrl: "https://www.bizhi99.com/tuji-336407.html",
    previewImageUrl: "https://pic.dmjnb.com/pic/d9b262abdb547e3cad40370df6eab916",
    sourceKind: "official-mirror",
  },
  {
    character: "Problem Solver 68",
    title: "Opera event PC/tablet digital goods",
    sourceUrl: "https://forum.nexon.com/bluearchive/board_view?board=1044&thread=2628256",
    sourceKind: "official",
  },
  {
    character: "Event ensemble",
    title: "Center-stage digital goods",
    sourceUrl: "https://forum.nexon.com/bluearchive/board_view?allBoard=1&board=1044&thread=2735342",
    sourceKind: "official",
  },
  {
    character: "Raid-boss themed",
    title: "2026 Heart-Raid digital goods",
    sourceUrl: "https://forum.nexon.com/bluearchive/board_view?board=1039&stickyBoard=1&thread=3407408",
    sourceKind: "official",
  },
];
