import {
  collectXLikesTimelinePostIds,
  isXLikesTimelineRequest,
  xTimelineAuditChannel,
} from "./xTimelineAudit";

type AuditedWindow = Window & { __ourchivalXTimelineAudit?: boolean };

const auditedWindow = window as AuditedWindow;
if (!auditedWindow.__ourchivalXTimelineAudit) {
  auditedWindow.__ourchivalXTimelineAudit = true;
  installFetchAudit();
  installXhrAudit();
}

function installFetchAudit() {
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await Reflect.apply(originalFetch, this, args);
    const requestUrl = requestUrlFromFetch(args[0]);
    inspectResponse(requestUrl, response.clone());
    return response;
  };
}

function installXhrAudit() {
  const requestUrls = new WeakMap<XMLHttpRequest, string>();
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ) {
    requestUrls.set(this, String(url));
    return Reflect.apply(originalOpen, this, [method, url, ...rest] as never);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener(
      "load",
      () => {
        const requestUrl = requestUrls.get(this);
        if (!requestUrl || !isXLikesTimelineRequest(requestUrl)) return;
        try {
          publish(JSON.parse(this.responseText));
        } catch {
          // A non-JSON or inaccessible response is not a usable receipt.
        }
      },
      { once: true },
    );
    return Reflect.apply(originalSend, this, args);
  };
}

function inspectResponse(requestUrl: string | undefined, response: Response) {
  if (!requestUrl || !isXLikesTimelineRequest(requestUrl)) return;
  void response
    .json()
    .then(publish)
    .catch(() => undefined);
}

function publish(payload: unknown) {
  const postIds = collectXLikesTimelinePostIds(payload);
  if (postIds.length === 0) return;
  window.postMessage(
    {
      channel: xTimelineAuditChannel,
      kind: "timeline_page",
      postIds,
    },
    location.origin,
  );
}

function requestUrlFromFetch(input: RequestInfo | URL) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}
