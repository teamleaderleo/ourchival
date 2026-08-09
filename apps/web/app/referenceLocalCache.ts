"use client";

import {
  isUsableCachedReferencePage,
  referenceCacheKey,
  type CachedReferencePage,
} from "./referenceCacheModel";
import type { VaultView } from "./VaultNavigation";

const databaseName = "ourchival-reference-cache";
const databaseVersion = 1;
const pageStore = "pages";
const savedAtIndex = "savedAt";
const maxCachedPages = 24;

export async function loadCachedReferencePage(args: {
  view: VaultView;
  query: string;
  now?: number;
}) {
  const database = await openReferenceCache();
  if (!database) return undefined;
  try {
    const transaction = database.transaction(pageStore, "readonly");
    const value = await requestResult<unknown>(
      transaction
        .objectStore(pageStore)
        .get(referenceCacheKey(args.view, args.query)),
    );
    return isUsableCachedReferencePage(value, args) ? value : undefined;
  } finally {
    database.close();
  }
}

export async function saveCachedReferencePage(page: CachedReferencePage) {
  const database = await openReferenceCache();
  if (!database) return;
  try {
    const transaction = database.transaction(pageStore, "readwrite");
    const done = transactionDone(transaction);
    transaction.objectStore(pageStore).put(page);
    await done;
    await pruneReferenceCache(database);
  } finally {
    database.close();
  }
}

export async function clearReferenceCache() {
  const database = await openReferenceCache();
  if (!database) return;
  try {
    const transaction = database.transaction(pageStore, "readwrite");
    const done = transactionDone(transaction);
    transaction.objectStore(pageStore).clear();
    await done;
  } finally {
    database.close();
  }
}

async function pruneReferenceCache(database: IDBDatabase) {
  const countTransaction = database.transaction(pageStore, "readonly");
  const countDone = transactionDone(countTransaction);
  const count = await requestResult<number>(
    countTransaction.objectStore(pageStore).count(),
  );
  await countDone;
  const overflow = count - maxCachedPages;
  if (overflow <= 0) return;

  const transaction = database.transaction(pageStore, "readwrite");
  const done = transactionDone(transaction);
  const store = transaction.objectStore(pageStore);
  const index = store.index(savedAtIndex);
  let removed = 0;
  await new Promise<void>((resolve, reject) => {
    const request = index.openCursor();
    request.onerror = () =>
      reject(request.error ?? new Error("Reference cache cursor failed."));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || removed >= overflow) {
        resolve();
        return;
      }
      store.delete(cursor.primaryKey);
      removed += 1;
      cursor.continue();
    };
  });
  await done;
}

async function openReferenceCache() {
  if (typeof indexedDB === "undefined") return undefined;
  return await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion);
    request.onerror = () =>
      reject(request.error ?? new Error("Could not open reference cache."));
    request.onupgradeneeded = () => {
      const database = request.result;
      const store = database.objectStoreNames.contains(pageStore)
        ? request.transaction!.objectStore(pageStore)
        : database.createObjectStore(pageStore, { keyPath: "key" });
      if (!store.indexNames.contains(savedAtIndex)) {
        store.createIndex(savedAtIndex, "savedAt");
      }
    };
    request.onsuccess = () => resolve(request.result);
  }).catch(() => undefined);
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed."));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
  });
}
