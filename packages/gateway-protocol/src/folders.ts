import { z } from "zod";

export const FolderScope = z.enum(["files", "coding", "exec"]);
export type FolderScope = z.infer<typeof FolderScope>;

export const Folder = z.object({
  id: z.string(),          // fld_<uuid>
  name: z.string(),        // unique per gateway
  path: z.string(),        // absolute, realpath-resolved
  scopes: z.array(FolderScope).min(1),
  gitRepo: z.boolean().optional(),
});
export type Folder = z.infer<typeof Folder>;
