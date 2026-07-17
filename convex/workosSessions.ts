import { mutation } from "./_generated/server";
import {
  AccessError,
  createOwnerSessionToken,
  requireAllowedWorkosUser,
} from "./lib/privateAccess";

export const mintOwnerSession = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new AccessError("Sign in with Google before opening the vault.", 401, "workos_sign_in_required");
    }

    const subject = identity.subject?.trim();
    if (!subject) {
      throw new AccessError("The WorkOS session is missing a user ID.", 401, "workos_subject_missing");
    }

    requireAllowedWorkosUser(subject);
    const session = await createOwnerSessionToken(subject);
    return {
      ...session,
      subject,
    };
  },
});
