import { posthogService } from './posthog.server';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import fetch from 'node-fetch';

// Mock node-fetch
vi.mock('node-fetch');

// Mock environment variables
vi.mock('~/env.server', () => ({
  env: {
    POSTHOG_PROJECT_KEY: 'test-api-key',
  },
}));

// Mock logger
vi.mock('./logger.service', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    log: vi.fn(),
  },
}));

describe('PostHogService', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    
    // Default successful response
    (fetch as unknown as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should capture events with the correct payload structure', async () => {
    const userId = 'test-user-id';
    const event = 'test-event';
    const properties = { test: 'property' };
    
    await posthogService.capture(event, userId, properties);
    
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('https://eu.posthog.com/capture/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test-api-key',
      },
      body: expect.stringContaining(event),
    });
    
    const callPayload = JSON.parse((fetch as unknown as jest.Mock).mock.calls[0][1].body);
    expect(callPayload.api_key).toBe('test-api-key');
    expect(callPayload.batch).toHaveLength(1);
    expect(callPayload.batch[0].event).toBe(event);
    expect(callPayload.batch[0].distinctId).toBe(userId);
    expect(callPayload.batch[0].properties).toMatchObject({
      ...properties,
      $lib: 'server',
      $lib_version: '1.0.0',
    });
  });

  it('should track search events with appropriate properties', async () => {
    const userId = 'test-user-id';
    const query = 'test search query';
    const options = { limit: 10 };
    const resultCounts = { result_count_total: 5 };
    
    await posthogService.trackSearch(userId, query, options, resultCounts);
    
    expect(fetch).toHaveBeenCalledTimes(1);
    
    const callPayload = JSON.parse((fetch as unknown as jest.Mock).mock.calls[0][1].body);
    expect(callPayload.batch[0].event).toBe('search');
    expect(callPayload.batch[0].distinctId).toBe(userId);
    expect(callPayload.batch[0].properties).toMatchObject({
      query,
      query_length: query.length,
      limit: 10,
      result_count_total: 5,
    });
  });

  it('should track ingestion events with appropriate properties', async () => {
    const userId = 'test-user-id';
    const episodeLength = 1000;
    const metadata = { source: 'test-source' };
    const success = true;
    
    await posthogService.trackIngestion(userId, episodeLength, metadata, success);
    
    expect(fetch).toHaveBeenCalledTimes(1);
    
    const callPayload = JSON.parse((fetch as unknown as jest.Mock).mock.calls[0][1].body);
    expect(callPayload.batch[0].event).toBe('ingestion');
    expect(callPayload.batch[0].distinctId).toBe(userId);
    expect(callPayload.batch[0].properties).toMatchObject({
      episode_length: 1000,
      source: 'test-source',
      success: true,
    });
  });

  it('should handle fetch errors gracefully', async () => {
    (fetch as unknown as jest.Mock).mockRejectedValue(new Error('Network error'));
    
    const result = await posthogService.capture('test-event', 'test-user-id');
    
    expect(result).toBe(false);
  });

  it('should handle API errors gracefully', async () => {
    (fetch as unknown as jest.Mock).mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });
    
    const result = await posthogService.capture('test-event', 'test-user-id');
    
    expect(result).toBe(false);
  });

  it('should not send events if no API key is provided', async () => {
    // Override env mock for this test
    vi.mock('~/env.server', () => ({
      env: {
        POSTHOG_PROJECT_KEY: '',
      },
    }), { virtual: true });
    
    // Need to recreate the service to pick up the new env mock
    const mockService = new (posthogService.constructor as any)();
    
    const result = await mockService.capture('test-event', 'test-user-id');
    
    expect(result).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
});