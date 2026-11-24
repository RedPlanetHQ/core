import { beforeEach, expect, it, vi } from 'vitest';
import { callTool, getTools } from '../index';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('googleapis', () => ({ google: { docs: () => ({ documents: { get } }) } }));

function paragraph(content: string) {
  return { paragraph: { elements: [{ textRun: { content } }] } };
}

beforeEach(() => get.mockReset());

it('reads a nested tab and keeps other tabs out of the response', async () => {
  get.mockResolvedValueOnce({
    data: {
      documentId: 'doc',
      tabs: [
        {
          tabProperties: { tabId: 't.first' },
          documentTab: { body: { content: [paragraph('First tab text')] } },
          childTabs: [
            {
              tabProperties: { tabId: 't.nested' },
              documentTab: { body: { content: [paragraph('Nested tab text')] } },
            },
          ],
        },
      ],
    },
  });

  const result = await callTool(
    'read_document',
    { documentId: 'doc', tabId: 't.nested' },
    '',
    '',
    '',
    {}
  );
  expect(get).toHaveBeenCalledWith(expect.objectContaining({ includeTabsContent: true }));
  expect(result.content[0].text).toContain('Nested tab text');
  expect(result.content[0].text).not.toContain('First tab text');
  expect((await getTools()).find(tool => tool.name === 'read_document')?.inputSchema).toMatchObject(
    {
      properties: { tabId: { type: 'string' } },
    }
  );
});

it('uses the original first-tab response when no tab ID is supplied', async () => {
  get.mockResolvedValueOnce({ data: { body: { content: [paragraph('First tab text')] } } });
  const result = await callTool('read_document', { documentId: 'doc' }, '', '', '', {});
  expect(get.mock.lastCall?.[0].includeTabsContent).toBeUndefined();
  expect(result.content[0].text).toContain('First tab text');
});

it('reports an unknown tab ID without returning a different tab', async () => {
  get.mockResolvedValueOnce({ data: { tabs: [] } });
  const result = await callTool(
    'read_document',
    { documentId: 'doc', tabId: 'missing' },
    '',
    '',
    '',
    {}
  );
  expect(result.content[0].text).toContain('Error: Document tab "missing" was not found');
});
