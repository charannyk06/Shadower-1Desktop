import { openai } from "@ai-sdk/openai";
import {
  FilePart,
  ImagePart,
  ModelMessage,
  tool as createTool,
  generateText,
} from "ai";
import { JSONSchema7 } from "json-schema";
import { generateImageWithNanoBanana } from "lib/ai/image/generate-image";
import { serverFileStorage } from "lib/file-storage";
import { jsonSchemaToZod } from "lib/json-schema-to-zod";
import { toAny } from "lib/utils";
import logger from "logger";
import { safe, watchError } from "ts-safe";
import { ImageToolName } from "..";

export type ImageToolResult = {
  images: {
    url: string;
    mimeType?: string;
  }[];
  mode?: "create" | "edit" | "composite";
  guide?: string;
  model: string;
};

// JSON Schema for image tool mode parameter
const imageToolSchema: JSONSchema7 = {
  type: "object",
  properties: {
    mode: {
      type: "string",
      enum: ["create", "edit", "composite"],
      description:
        "Image generation mode: 'create' for new images, 'edit' for modifying existing images, 'composite' for combining multiple images",
      default: "create",
    },
  },
};

export const nanoBananaTool = createTool({
  description: `Generate, edit, or composite images based on the conversation context. This tool automatically analyzes recent messages to create images without requiring explicit input parameters. It includes all user-uploaded images from the recent conversation and only the most recent AI-generated image to avoid confusion. Use the 'mode' parameter to specify the operation type: 'create' for new images, 'edit' for modifying existing images, or 'composite' for combining multiple images. Use this when the user requests image creation, modification, or visual content generation.`,
  inputSchema: jsonSchemaToZod(imageToolSchema),
  execute: async ({ mode = "create" }, { messages, abortSignal }) => {
    try {
      let hasFoundImage = false;

      // Get latest 6 messages and extract only the most recent image for editing context
      // This prevents multiple image references that could confuse the image generation model
      const latestMessages = messages
        .slice(-6)
        .reverse()
        .map((m) => {
          if (m.role != "tool") return m;
          if (hasFoundImage) return m; // Skip if we already found an image
          const fileParts = m.content.flatMap(convertToImageToolPartToFilePart);
          if (fileParts.length === 0) return m;
          hasFoundImage = true; // Mark that we found the most recent image
          return {
            ...m,
            role: "assistant",
            content: fileParts,
          };
        })
        .filter((v) => Boolean(v?.content?.length))
        .reverse() as ModelMessage[];

      const images = await generateImageWithNanoBanana({
        prompt: "",
        abortSignal,
        messages: latestMessages,
      });

      const resultImages = await safe(images.images)
        .map((images) => {
          return Promise.all(
            images.map(async (image) => {
              const uploadedImage = await serverFileStorage.upload(
                Buffer.from(image.base64, "base64"),
                {
                  contentType: image.mimeType,
                },
              );
              return {
                url: uploadedImage.sourceUrl,
                mimeType: image.mimeType,
              };
            }),
          );
        })
        .watch(
          watchError((e) => {
            logger.error(e);
            logger.info(`upload image failed. using base64`);
          }),
        )
        .ifFail(() => {
          throw new Error(
            "Image generation was successful, but file upload failed. Please check your file upload configuration and try again.",
          );
        })
        .unwrap();

      return {
        images: resultImages,
        mode,
        model: "gemini-2.5-flash-image",
        guide:
          resultImages.length > 0
            ? "The image has been successfully generated and is now displayed above. If you need any edits, modifications, or adjustments to the image, please let me know."
            : "I apologize, but the image generation was not successful. To help me create a better image for you, could you please provide more specific details about what you'd like to see? For example:\n\n• What style are you looking for? (realistic, cartoon, abstract, etc.)\n• What colors or mood should the image have?\n• Are there any specific objects, people, or scenes you want included?\n• What size or format would work best for your needs?\n\nPlease share these details and I'll try generating the image again with your specifications.",
      };
    } catch (e) {
      logger.error(e);
      throw e;
    }
  },
});

export const openaiImageTool = createTool({
  description: `Generate, edit, or composite images based on the conversation context. This tool automatically analyzes recent messages to create images without requiring explicit input parameters. It includes all user-uploaded images from the recent conversation and only the most recent AI-generated image to avoid confusion. Use the 'mode' parameter to specify the operation type: 'create' for new images, 'edit' for modifying existing images, or 'composite' for combining multiple images. Use this when the user requests image creation, modification, or visual content generation.`,
  inputSchema: jsonSchemaToZod(imageToolSchema),
  execute: async ({ mode = "create" }, { messages, abortSignal }) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not set");
    }

    let hasFoundImage = false;
    const latestMessages = messages
      .slice(-6)
      .reverse()
      .flatMap((m) => {
        if (m.role != "tool") return m;
        if (hasFoundImage) return m; // Skip if we already found an image)
        const fileParts = m.content.flatMap(convertToImageToolPartToImagePart);
        if (fileParts.length === 0) return m;
        hasFoundImage = true; // Mark that we found the most recent image
        return [
          {
            role: "user",
            content: fileParts,
          },
          m,
        ] as ModelMessage[];
      })
      .filter((v) => Boolean(v?.content?.length))
      .reverse() as ModelMessage[];
    const result = await generateText({
      model: openai("gpt-4.1-mini"),
      abortSignal,
      messages: latestMessages,
      tools: {
        // Type assertion needed for OpenAI built-in tools compatibility with AI SDK v6
        image_generation: openai.tools.imageGeneration({
          outputFormat: "webp",
          model: "gpt-image-1-mini",
        }) as any,
      },
      toolChoice: "required",
    });

    for (const toolResult of result.staticToolResults) {
      if (toolResult.toolName === "image_generation") {
        // Type assertion for OpenAI image generation tool output
        const output = toolResult.output as { result: string };
        const base64Image = output.result;
        const uploadedImage = await serverFileStorage
          .upload(Buffer.from(base64Image, "base64"), {
            contentType: "image/webp",
          })
          .catch(() => {
            throw new Error(
              "Image generation was successful, but file upload failed. Please check your file upload configuration and try again.",
            );
          });
        return {
          images: [{ url: uploadedImage.sourceUrl, mimeType: "image/webp" }],
          mode,
          model: "gpt-image-1-mini",
          guide:
            "The image has been successfully generated and is now displayed above. If you need any edits, modifications, or adjustments to the image, please let me know.",
        };
      }
    }
    return {
      images: [],
      mode,
      model: "gpt-image-1-mini",
      guide: "",
    };
  },
});

// Helper type guard for tool result parts
function isToolResultPart(
  part: any,
): part is { toolName: string; output: any } {
  return part && typeof part.toolName === "string" && part.output !== undefined;
}

function convertToImageToolPartToImagePart(part: any): ImagePart[] {
  if (!isToolResultPart(part)) return [];
  if (part.toolName !== ImageToolName) return [];
  // In v6, output is the direct result, not wrapped in .value
  const output = toAny(part).output;
  const result = (output?.value ?? output) as ImageToolResult | undefined;
  if (!result?.images?.length) return [];
  return result.images.map((image) => ({
    type: "image",
    image: image.url,
    mediaType: image.mimeType,
  }));
}

function convertToImageToolPartToFilePart(part: any): FilePart[] {
  if (!isToolResultPart(part)) return [];
  if (part.toolName !== ImageToolName) return [];
  // In v6, output is the direct result, not wrapped in .value
  const output = toAny(part).output;
  const result = (output?.value ?? output) as ImageToolResult | undefined;
  if (!result?.images?.length) return [];
  return result.images.map((image) => ({
    type: "file",
    mediaType: image.mimeType!,
    data: image.url,
  }));
}
