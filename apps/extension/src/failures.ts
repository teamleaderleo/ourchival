import {
  FAILURE_LOG_KEY,
  safeFailureUrl,
  type FailureRecord,
} from "./failureLog";
let records: FailureRecord[] = [];
let limit = 100;
const filter = document.getElementById("filter") as HTMLSelectElement;
const container = document.getElementById("records")!;
const more = document.getElementById("more") as HTMLButtonElement;
function node<K extends keyof HTMLElementTagNameMap>(tag: K, text: string) {
  const element = document.createElement(tag);
  element.textContent = text;
  return element;
}
function render() {
  const shown = records.filter(
    (r) =>
      filter.value === "all" ||
      (filter.value === "resolved" ? r.resolvedAt : !r.resolvedAt),
  );
  document.getElementById("summary")!.textContent =
    `${records.filter((r) => !r.resolvedAt).length} unresolved · ${records.filter((r) => r.resolvedAt).length} recovered · showing ${Math.min(limit, shown.length)} of ${shown.length}`;
  container.replaceChildren();
  for (const record of shown.slice(0, limit)) {
    const article = node("article", "");
    article.append(
      node(
        "h2",
        `${record.resolvedAt ? "Recovered" : "Unresolved"} · ${record.stage}${record.httpStatus ? ` · HTTP ${record.httpStatus}` : ""}${record.imagePage ? ` · Image ${record.imagePage}${record.imageCount ? ` of ${record.imageCount}` : ""}` : ""}`,
      ),
    );
    const url = safeFailureUrl(record.sourceUrl);
    if (url) {
      const link = node("a", url);
      link.href = url;
      link.target = "_blank";
      link.rel = "noreferrer";
      article.append(link);
    }
    const error = node("p", record.message);
    error.className = "error";
    article.append(error);
    if (record.importedFromCheckpoint)
      article.append(
        node(
          "p",
          "Imported from a retained checkpoint. Earlier attempt counts and exact failure times are unknown; the recorded date is the checkpoint date.",
        ),
      );
    const details = node("dl", "");
    for (const [label, value] of [
      ["Provider", record.provider],
      ["Failed attempts", String(record.attempts)],
      ["First failure", record.firstAt],
      ["Last failure", record.lastAt],
      ["Recovered", record.resolvedAt],
      ["Import", record.importId],
      ["Image URL", record.assetUrl],
    ]) {
      if (value) details.append(node("dt", label!), node("dd", value));
    }
    article.append(details);
    container.append(article);
  }
  if (!shown.length)
    container.append(node("p", "No recorded failures in this view."));
  more.hidden = shown.length <= limit;
}
async function load() {
  const values = await chrome.storage.local.get(FAILURE_LOG_KEY);
  records = Object.values(
    (values[FAILURE_LOG_KEY] ?? {}) as Record<string, FailureRecord>,
  ).sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  render();
}
filter.addEventListener("change", () => {
  limit = 100;
  render();
});
more.addEventListener("click", () => {
  limit += 100;
  render();
});
document.getElementById("export")!.addEventListener("click", () => {
  const url = URL.createObjectURL(
    new Blob(
      [
        JSON.stringify(
          { version: 1, exportedAt: new Date().toISOString(), records },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    ),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `ourchival-import-failures-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[FAILURE_LOG_KEY]) void load();
});
void load();
