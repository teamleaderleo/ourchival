import { describe, expect, it } from "vitest";
import { getDriveConfigurationStatus } from "./drive";

describe("getDriveConfigurationStatus", () => {
  it("uses Drive only when every required OAuth value is present", () => {
    expect(
      getDriveConfigurationStatus({
        GOOGLE_CLIENT_ID: "client-id",
        GOOGLE_CLIENT_SECRET: "client-secret",
        GOOGLE_REFRESH_TOKEN: "refresh-token",
      }),
    ).toEqual({
      driveConfigured: true,
      parentFolderConfigured: false,
      storageMode: "google_drive",
    });
  });

  it("keeps the Drive folder optional and reports it without its value", () => {
    expect(
      getDriveConfigurationStatus({
        GOOGLE_CLIENT_ID: "client-id",
        GOOGLE_CLIENT_SECRET: "client-secret",
        GOOGLE_REFRESH_TOKEN: "refresh-token",
        GOOGLE_DRIVE_PARENT_FOLDER_ID: "folder-id",
      }),
    ).toEqual({
      driveConfigured: true,
      parentFolderConfigured: true,
      storageMode: "google_drive",
    });
  });

  it("uses the Convex fallback when required Drive configuration is missing", () => {
    expect(
      getDriveConfigurationStatus({
        GOOGLE_CLIENT_ID: "client-id",
        GOOGLE_REFRESH_TOKEN: "refresh-token",
        GOOGLE_DRIVE_PARENT_FOLDER_ID: "folder-id",
      }),
    ).toEqual({
      driveConfigured: false,
      parentFolderConfigured: true,
      storageMode: "convex_fallback",
    });
  });
});
