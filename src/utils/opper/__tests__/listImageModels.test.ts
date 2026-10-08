/**
 * Image model listing: the dedicated endpoint, the fallback to the typed general listing, and the
 * response shapes we accept.
 */
jest.mock('react-native-keychain', () => ({}));

import { listOpperImageModels } from '../index';

const fetchMock = jest.fn();
global.fetch = fetchMock as any;

const json = (body: any, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });

beforeEach(() => fetchMock.mockReset());

test('reads the dedicated image listing, sorted and deduplicated', async () => {
    fetchMock.mockResolvedValueOnce(json({ models: [
        { id: 'xai/grok-imagine-image', name: 'Grok Imagine', provider: 'xai' },
        { id: 'openai/gpt-image-1', name: 'GPT Image 1', provider: 'openai' },
        { id: 'xai/grok-imagine-image', name: 'Grok Imagine', provider: 'xai' },
    ] }));

    const models = await listOpperImageModels(' key ');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.opper.ai/v3/images/models');
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ Authorization: 'Bearer key' });
    expect(models.map((m) => m.id)).toEqual(['openai/gpt-image-1', 'xai/grok-imagine-image']);
});

test('falls back to the general listing filtered on image models', async () => {
    fetchMock
        .mockResolvedValueOnce(json({ error: { message: 'Not found' } }, 404))
        .mockResolvedValueOnce(json([{ id: 'pruna/p-image' }, 'openai/dall-e-3']));

    const models = await listOpperImageModels();

    expect(fetchMock.mock.calls[1][0]).toBe('https://api.opper.ai/v3/models?type=image&limit=500');
    expect(fetchMock.mock.calls[1][1].headers).toEqual({});
    expect(models).toEqual([
        { id: 'openai/dall-e-3', name: 'openai/dall-e-3', provider: 'openai' },
        { id: 'pruna/p-image', name: 'pruna/p-image', provider: 'pruna' },
    ]);
});

test('throws when both listings fail', async () => {
    fetchMock.mockResolvedValue(json({ detail: 'down' }, 503));
    await expect(listOpperImageModels()).rejects.toThrow('Opper error 503: down');
});
