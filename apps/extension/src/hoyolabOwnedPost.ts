import type { SourceIntakeItem } from "./sourceIntake";

type ObjectValue = Record<string, any>;

export type HoYoLabArticleIdentity = {
  postId: string;
  sourceUrl: string;
};

export function detectHoYoLabArticle(value: string | undefined) {
  if (!value) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (!/(^|\.)hoyolab\.com$/i.test(url.hostname)) return undefined;
  const match = url.pathname.match(/^\/article\/(\d+)\/?$/i);
  if (!match?.[1]) return undefined;
  return {
    postId: match[1],
    sourceUrl: `https://www.hoyolab.com/article/${match[1]}`,
  } satisfies HoYoLabArticleIdentity;
}

export function hoyolabOwnedPost(
  value: unknown,
  identity: HoYoLabArticleIdentity,
  expectedUid: string,
): SourceIntakeItem {
  if (!/^\d+$/.test(expectedUid)) {
    throw new Error("HoYoLAB owned-profile UID is invalid.");
  }
  const envelope = asObject(value);
  if (Number(envelope.retcode ?? 0) !== 0 || !envelope.data) {
    throw new Error(String(envelope.message || "HoYoLAB post metadata unavailable."));
  }
  const data = asObject(envelope.data);
  const aggregate = asObject(data.post);
  const post = asObject(aggregate.post);
  const postId = String(post.post_id ?? "");
  if (postId !== identity.postId) {
    throw new Error("HoYoLAB post metadata identity mismatch.");
  }
  const authorUid = String(post.uid ?? aggregate.user?.uid ?? "");
  if (authorUid !== expectedUid) {
    throw new Error("HoYoLAB post publisher does not match the owned profile.");
  }
  if (aggregate.user?.uid !== undefined && String(aggregate.user.uid) !== expectedUid) {
    throw new Error("HoYoLAB post author metadata disagrees with the owned profile.");
  }
  if (Number(post.is_deleted ?? 0) !== 0) {
    throw new Error("HoYoLAB post is deleted.");
  }

  const images = orderedImages(aggregate.image_list, post.images);
  const createdAt = unixSecondsToIso(post.created_at);
  const updatedAt = unixSecondsToIso(
    aggregate.last_modify_time ?? post.updated_at,
  );
  const topics = Array.isArray(aggregate.topics)
    ? aggregate.topics
        .map((topic: unknown) => {
          const value = objectOrUndefined(topic);
          return typeof value?.name === "string" ? value.name.trim() : "";
        })
        .filter(Boolean)
    : [];

  return {
    providerId: identity.postId,
    sourceUrl: identity.sourceUrl,
    ...(typeof post.subject === "string" && post.subject.trim()
      ? { title: post.subject.trim() }
      : {}),
    ...(typeof aggregate.user?.nickname === "string" && aggregate.user.nickname.trim()
      ? { authorName: aggregate.user.nickname.trim() }
      : {}),
    ...(createdAt ? { publishedAt: createdAt } : {}),
    ...(images.length ? { assetUrls: images.map((image) => image.url) } : {}),
    sensitive: "unknown",
    tags: topics,
    metadata: {
      availability: "available",
      provenance: {
        platform: "hoyolab",
        containerType: "owned_profile_post",
        containerKey: expectedUid,
        containerUrl: identity.sourceUrl,
        containerName: "HoYoLAB creator post",
      },
      post: {
        postId: identity.postId,
        uid: expectedUid,
        subject: typeof post.subject === "string" ? post.subject : null,
        content: typeof post.content === "string" ? post.content : null,
        viewType: post.view_type ?? null,
        isOriginal: post.is_original ?? null,
        createdAt: createdAt ?? null,
        updatedAt: updatedAt ?? null,
      },
      user: aggregate.user ?? null,
      forum: aggregate.forum ?? null,
      topics: aggregate.topics ?? [],
      stat: aggregate.stat ?? null,
      imagePages: images,
    },
  };
}

export function hoyolabFullPostEndpoint(postId: string) {
  if (!/^\d+$/.test(postId)) throw new Error("HoYoLAB post ID is invalid.");
  return `https://bbs-api-os.hoyolab.com/community/post/wapi/getPostFull?post_id=${postId}`;
}

function orderedImages(primary: unknown, fallback: unknown) {
  if (Array.isArray(primary) && primary.length) {
    return primary.map((raw, sourceIndex) => {
      const image = asObject(raw);
      const url = hoyolabImageUrl(image.url);
      return {
        url,
        ...(positiveNumber(image.width) ? { width: Number(image.width) } : {}),
        ...(positiveNumber(image.height) ? { height: Number(image.height) } : {}),
        sourceIndex,
        sourceCount: primary.length,
        ...(typeof image.image_id === "string" && image.image_id
          ? { imageId: image.image_id }
          : {}),
      };
    });
  }
  if (!Array.isArray(fallback)) return [];
  const urls = fallback
    .map((raw) =>
      typeof raw === "string"
        ? raw
        : typeof objectOrUndefined(raw)?.url === "string"
          ? objectOrUndefined(raw)!.url
          : undefined,
    )
    .filter((url): url is string => Boolean(url));
  return urls.map((url, sourceIndex) => ({
    url: hoyolabImageUrl(url),
    sourceIndex,
    sourceCount: urls.length,
  }));
}

function hoyolabImageUrl(value: unknown) {
  if (typeof value !== "string") {
    throw new Error("HoYoLAB image URL is unavailable.");
  }
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    !(
      url.hostname === "upload-os-bbs.hoyolab.com" ||
      url.hostname.endsWith(".hoyolab.com")
    )
  ) {
    throw new Error("HoYoLAB image host is not trusted.");
  }
  url.hash = "";
  return url.toString();
}

function unixSecondsToIso(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
  const milliseconds = numeric < 10_000_000_000 ? numeric * 1_000 : numeric;
  return new Date(milliseconds).toISOString();
}

function positiveNumber(value: unknown) {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

function asObject(value: unknown): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid HoYoLAB provider response.");
  }
  return value as ObjectValue;
}

function objectOrUndefined(value: unknown): ObjectValue | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as ObjectValue)
    : undefined;
}
