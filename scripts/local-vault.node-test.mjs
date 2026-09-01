import assert from "node:assert/strict";
import test from "node:test";

import {
  isSupportedNodeVersion,
  parseEnv,
  parseProjectIdentity,
} from "./local-vault.mjs";

test("accepts only Node versions supported by Convex local actions", () => {
  assert.equal(isSupportedNodeVersion("20.19.0"), true);
  assert.equal(isSupportedNodeVersion("22.23.1"), true);
  assert.equal(isSupportedNodeVersion("24.4.0"), true);
  assert.equal(isSupportedNodeVersion("26.8.1"), false);
});

test("reads local deployment URLs without retaining comments", () => {
  assert.deepEqual(
    parseEnv(
      `CONVEX_DEPLOYMENT=local:ourchival # local\nCONVEX_URL=http://127.0.0.1:3210\nCONVEX_SITE_URL=http://127.0.0.1:3211\n`,
    ),
    {
      CONVEX_DEPLOYMENT: "local:ourchival",
      CONVEX_URL: "http://127.0.0.1:3210",
      CONVEX_SITE_URL: "http://127.0.0.1:3211",
    },
  );
});

test("infers the existing Convex project without exposing credentials", () => {
  assert.deepEqual(
    parseProjectIdentity(
      "CONVEX_DEPLOYMENT=dev:example # team: leo-team, project: ourchival",
    ),
    { team: "leo-team", project: "ourchival" },
  );
  assert.equal(
    parseProjectIdentity("NEXT_PUBLIC_CONVEX_URL=https://example.invalid"),
    undefined,
  );
});
