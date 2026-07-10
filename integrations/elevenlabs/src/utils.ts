import axios, { AxiosInstance } from 'axios';

export interface ElevenLabsConfig {
  api_key: string;
}

export function getElevenLabsClient(apiKey: string): AxiosInstance {
  return axios.create({
    baseURL: 'https://api.elevenlabs.io',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
    },
  });
}
