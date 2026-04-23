import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createLabel, updateLabel } from '../label-manager';

type MockGmail = {
  users: {
    labels: {
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      patch: ReturnType<typeof vi.fn>;
      get: ReturnType<typeof vi.fn>;
    };
  };
};

function makeGmail(): MockGmail {
  return {
    users: {
      labels: {
        create: vi.fn().mockResolvedValue({ data: { id: 'Label_1', name: 'x', type: 'user' } }),
        update: vi.fn().mockResolvedValue({ data: { id: 'Label_1', name: 'x', type: 'user' } }),
        patch: vi.fn().mockResolvedValue({ data: { id: 'Label_1', name: 'x', type: 'user' } }),
        get: vi.fn().mockResolvedValue({ data: { id: 'Label_1', name: 'x', type: 'user' } }),
      },
    },
  };
}

describe('createLabel with color', () => {
  let gmail: MockGmail;
  beforeEach(() => {
    gmail = makeGmail();
  });

  it('includes resolved color when a preset is passed', async () => {
    await createLabel(gmail, 'Priority', { color: 'blue' });
    const requestBody = gmail.users.labels.create.mock.calls[0][0].requestBody;
    expect(requestBody.color).toEqual({
      backgroundColor: '#4a86e8',
      textColor: '#ffffff',
    });
  });

  it('includes explicit color pair verbatim', async () => {
    await createLabel(gmail, 'Priority', {
      color: { textColor: '#ffffff', backgroundColor: '#fb4c2f' },
    });
    const requestBody = gmail.users.labels.create.mock.calls[0][0].requestBody;
    expect(requestBody.color).toEqual({
      textColor: '#ffffff',
      backgroundColor: '#fb4c2f',
    });
  });

  it('omits color field when not provided', async () => {
    await createLabel(gmail, 'Priority', {});
    const requestBody = gmail.users.labels.create.mock.calls[0][0].requestBody;
    expect(requestBody.color).toBeUndefined();
  });

  it('does not call create when color is invalid', async () => {
    await expect(createLabel(gmail, 'Priority', { color: 'mauve' })).rejects.toThrow(
      /Unknown color preset/
    );
    expect(gmail.users.labels.create).not.toHaveBeenCalled();
  });
});

describe('updateLabel with color', () => {
  let gmail: MockGmail;
  beforeEach(() => {
    gmail = makeGmail();
  });

  it('uses patch and includes resolved color', async () => {
    await updateLabel(gmail, 'Label_1', { color: 'green' });
    expect(gmail.users.labels.patch).toHaveBeenCalledOnce();
    const body = gmail.users.labels.patch.mock.calls[0][0].requestBody;
    expect(body.color).toEqual({
      backgroundColor: '#16a766',
      textColor: '#ffffff',
    });
  });

  it('omits color field when not provided', async () => {
    await updateLabel(gmail, 'Label_1', { name: 'Renamed' });
    const body = gmail.users.labels.patch.mock.calls[0][0].requestBody;
    expect(body.color).toBeUndefined();
    expect(body.name).toBe('Renamed');
  });

  it('does not call patch when color is invalid', async () => {
    await expect(
      updateLabel(gmail, 'Label_1', {
        color: { textColor: '#000000', backgroundColor: '#abcdef' },
      })
    ).rejects.toThrow(/Invalid backgroundColor/);
    expect(gmail.users.labels.patch).not.toHaveBeenCalled();
  });
});
