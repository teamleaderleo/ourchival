import { describe, expect, it } from "vitest";
import { collectXLikesTimelinePostIds } from "./xTimelineAudit";

describe("collectXLikesTimelinePostIds", () => {
  it("collects top-level timeline tweets and module items without quoted posts", () => {
    expect(
      collectXLikesTimelinePostIds({
        data: {
          user: {
            result: {
              timeline: {
                instructions: [
                  {
                    entries: [
                      {
                        entryId: "tweet-123",
                        content: {
                          itemContent: {
                            itemType: "TimelineTweet",
                            tweet_results: {
                              result: {
                                rest_id: "123",
                                quoted_status_result: {
                                  result: { rest_id: "999" },
                                },
                              },
                            },
                          },
                        },
                      },
                      {
                        entryId: "module-1",
                        content: {
                          items: [
                            {
                              item: {
                                itemContent: {
                                  itemType: "TimelineTweet",
                                  tweet_results: { result: { rest_id: "456" } },
                                },
                              },
                            },
                          ],
                        },
                      },
                      { entryId: "cursor-bottom-0" },
                    ],
                  },
                ],
              },
            },
          },
        },
      }),
    ).toEqual(["123", "456"]);
  });
});
