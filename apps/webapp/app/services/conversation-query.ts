import { z } from "zod";

const positiveInteger = z
  .string()
  .regex(/^\d+$/, "Must be a positive integer")
  .refine((value) => Number.isSafeInteger(Number(value)) && Number(value) > 0, {
    message: "Must be a positive safe integer",
  });

export const GetConversationsListSchema = z
  .object({
    page: positiveInteger.optional().default("1"),
    limit: positiveInteger
      .refine((value) => Number(value) <= 100, "Limit must not exceed 100")
      .optional()
      .default("20"),
    search: z.string().optional(),
    source: z.string().optional(),
    unread: z.string().optional(),
    asyncJobId: z.string().optional(),
  })
  .refine(
    ({ page, limit }) =>
      Number.isSafeInteger((Number(page) - 1) * Number(limit)),
    { message: "Pagination offset is too large", path: ["page"] },
  );

export type GetConversationsListDto = z.infer<
  typeof GetConversationsListSchema
>;
