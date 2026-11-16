import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  tokenRequest: vi.fn(),
  eagerRefresh: vi.fn(),
  authorization: vi.fn(),
  failFactory: false,
}));
vi.mock('google-auth-library', async importOriginal => {
  const actual = await importOriginal<typeof import('google-auth-library')>();
  return {
    ...actual,
    OAuth2Client: class extends actual.OAuth2Client {
      constructor(...args: ConstructorParameters<typeof actual.OAuth2Client>) {
        super(...args);
        this.transporter.request = mocks.tokenRequest;
        // Observe manual refresh without letting the old fire-and-forget call
        // create an unhandled rejection in the test process. Request-scoped
        // refresh still uses the real SDK refreshToken/getRequestHeaders code.
        this.refreshAccessToken = mocks.eagerRefresh;
      }
    },
  };
});
vi.mock('googleapis', () => {
  const factory = ({ auth }: { auth: { getRequestHeaders: () => Promise<Headers> } }) => {
    if (mocks.failFactory) throw new Error('Client initialization failed');
    const list = async () => {
      const headers = await auth.getRequestHeaders();
      mocks.authorization(headers.get('authorization'));
      return { data: { items: [], files: [] } };
    };
    return { calendarList: { list }, tasklists: { list }, files: { list } };
  };
  return {
    google: { calendar: factory, tasks: factory, docs: factory, sheets: factory, drive: factory },
  };
});

import { callTool as calendar } from '../index';
import { callTool as tasks } from '../../../../google-tasks/src/mcp/index';
import { callTool as docs } from '../../../../google-docs/src/mcp/index';
import { callTool as sheets } from '../../../../google-sheets/src/mcp/index';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.failFactory = false;
  mocks.eagerRefresh.mockReturnValue(new Promise(() => {}));
  mocks.tokenRequest.mockResolvedValue({
    data: { access_token: 'refreshed-test-token', expires_in: 3600, token_type: 'Bearer' },
    headers: new Headers(),
    status: 200,
  });
});

const providers = [
  ['Calendar', calendar, 'list_calendars'],
  ['Tasks', tasks, 'list_task_lists'],
  ['Docs', docs, 'list_documents'],
  ['Sheets', sheets, 'list_spreadsheets'],
] as const;

for (const [name, callTool, tool] of providers) {
  const call = (credentials: Record<string, string>) =>
    callTool(tool, {}, 'test-client', 'test-secret', 'http://localhost/callback', credentials);
  describe(`${name} OAuth initialization`, () => {
    it('uses a valid access token without forcing a refresh or requiring a refresh token', async () => {
      await call({ access_token: 'valid-test-token', expires_at: String(Date.now() + 3600000) });
      expect(mocks.eagerRefresh).not.toHaveBeenCalled();
      expect(mocks.tokenRequest).not.toHaveBeenCalled();
      expect(mocks.authorization).toHaveBeenCalledWith('Bearer valid-test-token');
    });
    it('lets the real SDK refresh an expired token when the request needs it', async () => {
      await call({
        access_token: 'expired-test-token',
        refresh_token: 'test-refresh-token',
        expires_at: '1',
      });
      expect(mocks.eagerRefresh).not.toHaveBeenCalled();
      expect(mocks.tokenRequest).toHaveBeenCalledTimes(1);
      expect(mocks.authorization).toHaveBeenCalledWith('Bearer refreshed-test-token');
    });
    it('returns request-time refresh errors through the tool error path', async () => {
      mocks.tokenRequest.mockRejectedValue(new Error('Refresh denied'));
      const result = await call({
        access_token: 'expired',
        refresh_token: 'test-refresh-token',
        expires_at: '1',
      });
      expect(result.content[0].text).toContain('Error: Refresh denied');
    });
    it('rejects initialization errors without exiting the process', async () => {
      mocks.failFactory = true;
      const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('Unexpected process exit');
      });
      const log = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        await expect(call({ access_token: 'test' })).rejects.toThrow(
          'Client initialization failed'
        );
        expect(exit).not.toHaveBeenCalled();
      } finally {
        exit.mockRestore();
        log.mockRestore();
      }
    });
  });
}
