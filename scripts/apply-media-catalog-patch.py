from pathlib import Path

path = Path("convex/lib/referenceCatalog.ts")
text = path.read_text()

old = '''  const assetsWithUrls = await Promise.all(
    assets.map(async (asset: any) => ({
      ...asset,
      storedUrl: asset.driveFileId
        ? `${origin}/drive-file?id=${encodeURIComponent(asset.driveFileId)}`
        : asset.originalStorageId
          ? await ctx.storage.getUrl(asset.originalStorageId)
          : null,
    })),
  );
'''

new = '''  const assetsWithUrls = await Promise.all(
    assets.map(async (asset: any) => {
      const [originalStorageUrl, previewUrl, thumbUrl] = await Promise.all([
        asset.originalStorageId ? ctx.storage.getUrl(asset.originalStorageId) : null,
        asset.previewStorageId ? ctx.storage.getUrl(asset.previewStorageId) : null,
        asset.thumbStorageId ? ctx.storage.getUrl(asset.thumbStorageId) : null,
      ]);

      return {
        ...asset,
        storedUrl: asset.driveFileId
          ? `${origin}/drive-file?id=${encodeURIComponent(asset.driveFileId)}`
          : originalStorageUrl,
        previewUrl,
        thumbUrl,
      };
    }),
  );
'''

if new in text:
    raise SystemExit(0)
if old not in text:
    raise SystemExit("Expected reference hydration block was not found")

path.write_text(text.replace(old, new, 1))
