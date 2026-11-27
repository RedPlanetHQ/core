import { expect, it, vi } from "vitest";
import { createActivities } from "./message-utils";

const { create, createMany, enqueueCase, triggerWebhookDelivery } = vi.hoisted(
  () => ({
    create: vi.fn(),
    createMany: vi.fn(),
    enqueueCase: vi.fn(),
    triggerWebhookDelivery: vi.fn(),
  }),
);

vi.mock("~/db.server", () => ({
  prisma: {
    activity: { create, createMany },
    integrationAccount: {
      findUnique: vi.fn(async () => ({
        accountId: "fathom-account",
        workspaceId: "workspace",
        integratedById: "user",
        settings: { autoActivityRead: true },
        integrationDefinition: { slug: "fathom" },
      })),
    },
    user: {
      findUnique: vi.fn(async () => ({ email: "user@example.com" })),
    },
  },
}));
vi.mock("~/lib/queue-adapter.server", () => ({ enqueueCase }));
vi.mock("../webhooks/webhook-delivery", () => ({ triggerWebhookDelivery }));
vi.mock("@trigger.dev/sdk", () => ({
  logger: { debug: vi.fn(), error: vi.fn() },
}));
vi.mock("./queue", () => ({ addToQueue: vi.fn() }));

it("stores and dispatches a Fathom meeting once per integration account", async () => {
  const storedIds = new Set<string>();
  createMany.mockImplementation(async ({ data: [{ id }], skipDuplicates }) => {
    expect(skipDuplicates).toBe(true);
    if (storedIds.has(id)) return { count: 0 };
    storedIds.add(id);
    return { count: 1 };
  });

  const activity = {
    type: "activity" as const,
    data: {
      sourceActivityId: "123",
      text: "Meeting notes",
      sourceURL: "https://fathom.video/share/meeting",
    },
  };
  const request = {
    integrationAccountId: "account-1",
    userId: "user",
    messages: [activity],
  };

  const overlapping = await Promise.all([
    createActivities(request),
    createActivities(request),
  ]);
  expect(overlapping.flat()).toHaveLength(1);
  expect(await createActivities(request)).toEqual([]);
  expect(storedIds.size).toBe(1);
  expect(triggerWebhookDelivery).toHaveBeenCalledTimes(1);
  expect(enqueueCase).toHaveBeenCalledTimes(1);
  expect(enqueueCase).toHaveBeenCalledWith(
    expect.objectContaining({ activitiesText: "Meeting notes" }),
  );

  expect(
    await createActivities({ ...request, integrationAccountId: "account-2" }),
  ).toHaveLength(1);
  expect(storedIds.size).toBe(2);
  expect(triggerWebhookDelivery).toHaveBeenCalledTimes(2);
  expect(enqueueCase).toHaveBeenCalledTimes(2);
  expect(create).not.toHaveBeenCalled();
});
