import { logger } from "@trigger.dev/sdk/v3";
import axios from "axios";

// Memory API functions using axios interceptor
export interface SearchMemoryParams {
  query: string;
  validAt?: string;
  startTime?: string;
  endTime?: string;
}

export interface AddMemoryParams {
  message: string;
  referenceTime?: string;
  spaceId?: string;
  sessionId?: string;
  metadata?: any;
}

export const searchMemory = async (params: SearchMemoryParams) => {
  try {
    logger.info("searchMemory called", { params, apiBaseUrl: process.env.API_BASE_URL });
    const response = await axios.post(
      "https://core::memory/api/v1/search",
      params,
    );
    logger.info("searchMemory success", { status: response.status, dataKeys: Object.keys(response.data) });
    return response.data;
  } catch (error) {
    logger.error("Memory search failed", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      params,
      apiBaseUrl: process.env.API_BASE_URL,
      axiosError: (error as any).response?.data,
      statusCode: (error as any).response?.status
    });
    throw new Error(`Memory search failed: ${error instanceof Error ? error.message : String(error)}`);
  }
};

export const addMemory = async (params: AddMemoryParams) => {
  try {
    // Set defaults for required fields
    const memoryInput = {
      ...params,
      episodeBody: params.message,
      referenceTime: params.referenceTime || new Date().toISOString(),
      source: "CORE",
    };

    logger.info("addMemory called", { memoryInput, apiBaseUrl: process.env.API_BASE_URL });
    const response = await axios.post(
      "https://core::memory/api/v1/add",
      memoryInput,
    );
    logger.info("addMemory success", { status: response.status, dataKeys: Object.keys(response.data) });
    return response.data;
  } catch (error) {
    logger.error("Memory storage failed", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      params,
      apiBaseUrl: process.env.API_BASE_URL,
      axiosError: (error as any).response?.data,
      statusCode: (error as any).response?.status
    });
    throw new Error(`Memory storage failed: ${error instanceof Error ? error.message : String(error)}`);
  }
};

export const searchSpaces = async () => {
  try {
    logger.info("searchSpaces called", { apiBaseUrl: process.env.API_BASE_URL });
    const response = await axios.get("https://core::memory/api/v1/spaces");
    logger.info("searchSpaces success", { status: response.status, dataKeys: Object.keys(response.data) });
    return response.data;
  } catch (error) {
    logger.error("Search spaces failed", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      apiBaseUrl: process.env.API_BASE_URL,
      axiosError: (error as any).response?.data,
      statusCode: (error as any).response?.status
    });
    throw new Error(`Search spaces failed: ${error instanceof Error ? error.message : String(error)}`);
  }
};
