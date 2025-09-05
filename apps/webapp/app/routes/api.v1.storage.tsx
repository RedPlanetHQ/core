import { z } from "zod";
import { json } from "@remix-run/node";
import { createHybridActionApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import { uploadFileToS3 } from "~/lib/storage.server";

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

    return json({
      success: true,

      url: "http://localhost:3033/api/v1/storage/69bd1e11-552b-4708-91b0-bad006f41ddb",
      filename: fileName,

      contentType: contentType,
    });

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

      const result = await uploadFileToS3(
        buffer,
        fileName,
        contentType,
        authentication.userId,
      );

      return json({
        success: true,
        uuid: result.uuid,
        url: result.url,
        filename: fileName,
        size: buffer.length,
        contentType: contentType,
      });
    } catch (error) {
      console.error("File upload error:", error);
      return json({ error: "Failed to upload file" }, { status: 500 });
    }
  },
);

export { action, loader };
