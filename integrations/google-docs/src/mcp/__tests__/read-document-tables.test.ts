import { expect, it, vi } from 'vitest';
import { callTool } from '../index';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('googleapis', () => ({ google: { docs: () => ({ documents: { get } }) } }));

it('reads paragraph, table, nested table and table of contents text in order', async () => {
  const paragraph = (text: string) => ({
    paragraph: { elements: [{ textRun: { content: text + '\n' } }] },
  });
  get.mockResolvedValueOnce({
    data: {
      title: 'Plan',
      documentId: 'doc',
      body: {
        content: [
          paragraph('Before table'),
          {
            table: {
              tableRows: [
                {
                  tableCells: [
                    { content: [paragraph('First cell')] },
                    {
                      content: [
                        {
                          table: {
                            tableRows: [{ tableCells: [{ content: [paragraph('Nested cell')] }] }],
                          },
                        },
                      ],
                    },
                  ],
                },
                { tableCells: [{ content: [paragraph('Next row')] }] },
              ],
            },
          },
          { tableOfContents: { content: [paragraph('Contents heading')] } },
          paragraph('After table'),
        ],
      },
    },
  });

  const result = await callTool('read_document', { documentId: 'doc' }, '', '', '', {});
  expect(result.content[0].text).toContain(
    'Before table\nFirst cell\nNested cell\nNext row\nContents heading\nAfter table\n'
  );
});
