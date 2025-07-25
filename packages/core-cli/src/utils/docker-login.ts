import { log } from "@clack/prompts";
import path from "path";
import os from "os";
import fs from "fs";
import { executeCommandInteractive } from "./docker-interactive.js";

export async function handleDockerLogin(rootDir: string, triggerEnvPath: string): Promise<void> {
  // Check if Docker is already logged in to localhost:5000
  let dockerLoginNeeded = true;
  try {
    const dockerConfigPath = process.env.DOCKER_CONFIG
      ? path.join(process.env.DOCKER_CONFIG, "config.json")
      : path.join(os.homedir(), ".docker", "config.json");

    if (fs.existsSync(dockerConfigPath)) {
      const configContent = await fs.promises.readFile(dockerConfigPath, "utf8");
      const config = JSON.parse(configContent);
      if (
        config &&
        config.auths &&
        Object.prototype.hasOwnProperty.call(config.auths, "localhost:5000")
      ) {
        dockerLoginNeeded = false;
      }
    }
  } catch (error) {
    // Ignore errors, will prompt for login below
  }

  if (dockerLoginNeeded) {
    try {
      // Read env file to get docker registry details
      const envContent = await fs.promises.readFile(triggerEnvPath, "utf8");
      const envLines = envContent.split("\n");

      const getEnvValue = (key: string) => {
        const line = envLines.find((l) => l.startsWith(`${key}=`));
        return line ? line.split("=")[1] : "";
      };

      const dockerRegistryUrl = getEnvValue("DOCKER_REGISTRY_URL");
      const dockerRegistryUsername = getEnvValue("DOCKER_REGISTRY_USERNAME");
      const dockerRegistryPassword = getEnvValue("DOCKER_REGISTRY_PASSWORD");

      await executeCommandInteractive(
        `docker login -u ${dockerRegistryUsername} -p ${dockerRegistryPassword} ${dockerRegistryUrl}`,
        {
          cwd: rootDir,
          message: "Logging in to docker...",
          showOutput: true,
        }
      );
    } catch (error) {
      log.info("docker login -u <USERNAME> -p <PASSWORD> <REGISTRY_URL>");
    }
  } else {
    log.info("✅ Docker is already logged in to localhost:5000, skipping login prompt.");
  }
}
