import { json } from "@remix-run/node";
import { createHybridActionApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import { uploadFileToS3, isS3Configured, storeLocalFile } from "~/lib/storage.server";
import { env } from "~/env.server";

const { action, loader } = createHybridActionApiRoute(
  {
    corsStrategy: "all",
    allowJWT: true,
    maxContentLength: 50 * 1024 * 1024, // 50MB limit
  },
  async ({ request, authentication }) => {
    let buffer: Buffer;
    let fileName = "unnamed-file";
    let contentType = "application/octet-stream";

    try {
      const contentTypeHeader = request.headers.get("Content-Type") || "";

      if (contentTypeHeader.includes("multipart/form-data")) {
        const formData = await request.formData();
        const file = formData.get("File") as File;

        if (!file) {
          return json({ error: "No file provided" }, { status: 400 });
        }

        if (file.size === 0) {
          return json({ error: "File is empty" }, { status: 400 });
        }

        // Convert file to buffer
        const arrayBuffer = await file.arrayBuffer();
        buffer = Buffer.from(arrayBuffer);
        fileName = file.name;
        contentType = file.type;
      } else if (contentTypeHeader.includes("application/json")) {
        const jsonBody = await request.json();
        const base64Data = jsonBody.base64Data;
        fileName = jsonBody.fileName || fileName;
        contentType = jsonBody.contentType || contentType;

        if (!base64Data) {
          return json({ error: "No base64 data provided" }, { status: 400 });
        }

        buffer = Buffer.from(base64Data, "base64");
      } else {
        return json({ error: "Unsupported content type" }, { status: 400 });
      }

      let uuid: string;
      let url: string;
      const s3Configured = isS3Configured()
      // Check if S3 is configured, otherwise use local storage
      if (s3Configured) {
        // Production: Upload to S3
        const result = await uploadFileToS3(
          buffer,
          fileName,
          contentType,
          authentication.userId,
        );

        url = result.url;
        uuid = result.uuid;
      } else {
        // Open source: Store locally with UUID mapping
        const result = await storeLocalFile(
          buffer,
          fileName,
          authentication.userId,
        );

        const frontendHost = env.APP_ORIGIN || "http://localhost:3000";
        url = `${frontendHost}/api/v1/storage/${result.uuid}`;
        uuid = result.uuid;
      }

      return json({
          success: true,
          uuid,
          url,
          filename: fileName,
          size: buffer.length,
          contentType: contentType,
          storage: s3Configured ? "s3" : "local",
        });
    } catch (error) {
      console.error("File upload error:", error);
      return json({ error: "Failed to upload file" }, { status: 500 });
    }
  },
);

export { action, loader };
