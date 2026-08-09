import type { CapturePayload, SourcePlatform } from "@ourchival/shared";

export type CreativeItemIdentity = {
  sourceKey: string;
};

export type PreparedCreativeCapture = CreativeItemIdentity & {
  platform: SourcePlatform;
  payloads: CapturePayload[];
};

export type CreativeSiteAdapter = {
  platform: SourcePlatform;
  matchesLocation(location: Location): boolean;
  listItems(root: ParentNode): HTMLElement[];
  closestItem(element: Element): HTMLElement | undefined;
  identify(item: HTMLElement): CreativeItemIdentity | undefined;
  prepareCapture(item: HTMLElement): PreparedCreativeCapture | undefined;
  actionContainer(item: HTMLElement): HTMLElement | undefined;
};
