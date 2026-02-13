import { json } from "@remix-run/node";
import { deleteUser, getUserById } from "~/models/user.server";
import { sessionStorage } from "~/services/sessionStorage.server";
import { cancelSubscriptionImmediately } from "~/services/stripe.server";
import { isBillingEnabled } from "~/config/billing.server";
import { prisma } from "~/db.server";
import { createHybridActionApiRoute } from "~/services/routeBuilders/apiBuilder.server";

const { action, loader } = createHybridActionApiRoute(
  {
    corsStrategy: "all",
    allowJWT: true,
    method: "DELETE",
    authorization: {
      action: "delete",
    },
  },
  async ({ authentication, request }) => {
    try {
      const user = await getUserById(authentication.userId);

      if (!user || !authentication.workspaceId) {
        throw new Error("No user or workspace found");
      }

      // If billing is enabled, cancel any active subscriptions
      if (isBillingEnabled()) {
        const subscription = await prisma.subscription.findUnique({
          where: { workspaceId: authentication.workspaceId },
        });

        if (subscription?.stripeSubscriptionId) {
          try {
            await cancelSubscriptionImmediately(
              subscription.stripeSubscriptionId,
            );
          } catch (error) {
            console.error("Failed to cancel Stripe subscription:", error);
            // Continue with deletion even if Stripe cancellation fails
          }
        }
      }

      // Delete the user and all associated data
      await deleteUser(user.id);

      // Destroy the session
      const session = await sessionStorage.getSession(
        request.headers.get("Cookie"),
      );

      return json(
        { success: true },
        {
          headers: {
            "Set-Cookie": await sessionStorage.destroySession(session),
          },
        },
      );
    } catch (error) {
      console.error("Error deleting user:", error);
      return json(
        { error: "Failed to delete account. Please try again." },
        { status: 500 },
      );
    }
  },
);

export { action, loader };
