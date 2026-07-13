const trackingParameterNames = new Set([
  "dclid",
  "fbclid",
  "gclid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "msclkid",
]);

const xTrackingParameterNames = new Set(["ref_src", "ref_url", "s", "t"]);

const xHostnames = new Set([
  "m.twitter.com",
  "mobile.twitter.com",
  "twitter.com",
  "www.twitter.com",
  "www.x.com",
  "x.com",
]);

export function normalizeSourceUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;

  try {
    const url = new URL(trimmed);
    url.hash = "";
    url.hostname = normalizeHostname(url.hostname);

    for (const name of Array.from(url.searchParams.keys())) {
      if (isTrackingParameter(name, url.hostname)) {
        url.searchParams.delete(name);
      }
    }

    sortSearchParameters(url);

    if (url.pathname.length > 1) {
      url.pathname = url.pathname.replace(/\/+$/, "");
    }

    return url.toString();
  } catch {
    return trimmed;
  }
}

export function sourceUrlsMatch(left: string, right: string) {
  return normalizeSourceUrl(left) === normalizeSourceUrl(right);
}

function normalizeHostname(hostname: string) {
  const lower = hostname.toLowerCase();
  return xHostnames.has(lower) ? "x.com" : lower;
}

function isTrackingParameter(name: string, hostname: string) {
  const lower = name.toLowerCase();
  if (lower.startsWith("utm_")) return true;
  if (trackingParameterNames.has(lower)) return true;
  return hostname === "x.com" && xTrackingParameterNames.has(lower);
}

function sortSearchParameters(url: URL) {
  const entries = Array.from(url.searchParams.entries()).sort(([leftKey, leftValue], [rightKey, rightValue]) => {
    const keyOrder = leftKey.localeCompare(rightKey);
    return keyOrder === 0 ? leftValue.localeCompare(rightValue) : keyOrder;
  });

  url.search = "";
  for (const [key, value] of entries) {
    url.searchParams.append(key, value);
  }
}
