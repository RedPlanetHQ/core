import { type DataContent, type CoreMessage } from "ai";
import axios from "axios";
import { makeModelCall } from "~/lib/model.server";

/**
 * Summarizes an image by sending it to the model for analysis
 * Focuses on describing Figma designs, personal photos, emotions, tone, location, premise,
 * and design/art language when applicable
 */
export async function summarizeImage(
  imageUrl: string,
  apiKey?: string,
): Promise<string> {
  const response = await axios.get(imageUrl, {
    responseType: "arraybuffer",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  const messages: CoreMessage[] = [
    {
      role: "system",
      content: `You are a helpful assistant that analyzes images and provides detailed descriptions. When describing images, focus on:

For Figma designs and UI/UX content:
- Design language, visual hierarchy, and layout patterns
- Color palette, typography, and spacing
- User interface elements and interactions
- Design system components and patterns
- Overall design approach and style

For personal photos and general images:
- Setting, location, and environment details
- Emotions, mood, and atmosphere
- People's expressions, body language, and interactions
- Lighting, composition, and visual tone
- Objects, activities, and context
- Time of day or season if apparent

For art and creative content:
- Artistic style, medium, and technique
- Color theory, composition, and visual elements
- Artistic movement or influence
- Emotional impact and artistic intent
- Cultural or historical context if relevant

Provide a comprehensive, detailed description that captures both the visual elements and the underlying meaning or purpose of the image. Be specific and descriptive while maintaining clarity.`,
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: "Please analyze this image and provide a detailed description following the guidelines above.",
        },
        {
          type: "image",
          image: response.data as DataContent,
        },
      ],
    },
  ];

  try {
    const response = await makeModelCall(
      false, // Don't stream for image analysis
      messages,
      () => {}, // Empty onFinish callback
      { temperature: 0.7 },
    );

    return response as string;
  } catch (error) {
    console.error("Error summarizing image:", error);
    return "Unable to analyze image content.";
  }
}

/**
 * Extracts image URLs from HTML content and limits to first 5 images
 */
export function extractImageUrls(html: string): string[] {
  // Match img tags with src attributes
  const imgRegex = /<img[^>]+src\s*=\s*["']([^"']+)["'][^>]*>/gi;
  const imageUrls: string[] = [];
  let match;

  while ((match = imgRegex.exec(html)) !== null && imageUrls.length < 5) {
    const src = match[1];

    // Filter out common non-content images
    if (
      !src.includes("favicon") &&
      !src.includes("logo") &&
      !src.includes("icon") &&
      !src.includes("avatar") &&
      !src.endsWith(".svg") && // Often logos/icons
      !src.includes("tracking") &&
      !src.includes("analytics") &&
      src.startsWith("http") // Only external URLs
    ) {
      imageUrls.push(src);
    }
  }

  return imageUrls;
}
