import createLoadRemoteModule, {
  createRequires,
} from "@paciolan/remote-module-loader";

import { logger, task } from "@trigger.dev/sdk/v3";
import axios from "axios";
import {
  type IntegrationDefinitionV2,
  type IntegrationAccount,
} from "@core/database";
import { deletePersonalAccessToken } from "../utils/utils";
import { type IntegrationEventType } from "@core/types";

const fetcher = async (url: string) => {
  // Handle remote URLs with axios
  const response = await axios.get(url);

  return response.data;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const loadRemoteModule = async (requires: any) =>
  createLoadRemoteModule({ fetcher, requires });

function createAxiosInstance(token: string) {
  const instance = axios.create();

  instance.interceptors.request.use((config) => {
    // Check if URL starts with /api and doesn't have a full host
    if (config.url?.startsWith("/api")) {
      config.url = `${process.env.BACKEND_HOST}${config.url.replace("/api/", "/")}`;
    }

    if (
      config.url?.includes(process.env.FRONTEND_HOST || "") ||
      config.url?.includes(process.env.BACKEND_HOST || "")
    ) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    return config;
  });

  return instance;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getRequires = (axios: any) => createRequires({ axios });

export const integrationRun = task({
  id: "integration-run",
  run: async ({
    pat,
    patId,
    eventBody,
    integrationAccount,
    integrationDefinition,
    event,
  }: {
    pat: string;
    patId: string;
    // This is the event you want to pass to the integration
    event: IntegrationEventType;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    eventBody?: any;
    integrationDefinition: IntegrationDefinitionV2;
    integrationAccount?: IntegrationAccount;
  }) => {
    const remoteModuleLoad = await loadRemoteModule(
      getRequires(createAxiosInstance(pat)),
    );

    logger.info(
      `${integrationDefinition.url}/${integrationDefinition.version}/index.cjs`,
    );

    const integrationFunction = await remoteModuleLoad(
      `${integrationDefinition.url}/${integrationDefinition.version}/index.cjs`,
    );

    // const integrationFunction = await remoteModuleLoad(
    //   `${integrationDefinition.url}`,
    // );

    // Construct the proper IntegrationEventPayload structure
    const integrationEventPayload = {
      event,
      eventBody: { ...eventBody, integrationDefinition },
      config: integrationAccount?.integrationConfiguration || {},
    };

    const result = await integrationFunction.run(integrationEventPayload);

    await deletePersonalAccessToken(patId);

    logger.info("Personal access token deleted");

    return result;
  },
});
