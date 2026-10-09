/**
 * Price parsing against the shapes Opper's model listings return.
 */
import { formatOpperPrice, parseOpperPrice } from '../pricing';

// Trimmed from GET /v3/models (an llm and an image entry)
const DEEPSEEK = {
    id: 'alibaba:global/deepseek-v4-pro',
    type: 'llm',
    cost: 0.22,
    pricing: { billing_unit: 'per_mtok', input: [1.7904], output: [3.5808], cached_input: [0.1492] },
};
const SEEDREAM = {
    id: 'bytedance:ap/seedream-4.5',
    type: 'image',
    pricing: { billing_unit: 'per_generation', rates: [{ unit: 'per_generation', amount: 0.04 }], price_per_generation: 0.04 },
};

test('reads per-million token prices, taking the first tier', () => {
    expect(parseOpperPrice(DEEPSEEK)).toEqual({ input: 1.7904, output: 3.5808, cacheRead: 0.1492 });
    expect(formatOpperPrice(parseOpperPrice(DEEPSEEK))).toBe('$1.79 in · $3.58 out · $0.15 cache /1M');
});

test('reads the per-generation price of image models', () => {
    expect(parseOpperPrice(SEEDREAM)).toEqual({ perImage: 0.04 });
    expect(formatOpperPrice(parseOpperPrice(SEEDREAM))).toBe('$0.04 /image');
    // Falls back to the first rate when the shortcut field is missing
    expect(parseOpperPrice({ pricing: { billing_unit: 'per_generation', rates: [{ amount: 0.12 }] } })).toEqual({ perImage: 0.12 });
});

test('never takes the relative cost score for a price', () => {
    expect(parseOpperPrice({ id: 'x', cost: 0.22 })).toBeNull();
    expect(formatOpperPrice(null)).toBeNull();
});

test('converts per-token values without a unit to per million', () => {
    expect(parseOpperPrice({ pricing: { input: 0.000003, output: '0.000015' } })).toEqual({ input: 3, output: 15 });
});

describe('listOpperModelPrices', () => {
    const fetchMock = jest.fn();
    beforeAll(() => { global.fetch = fetchMock as any; });

    test('keys prices by route id and alias only, never the shared model name', async () => {
        jest.resetModules();
        jest.doMock('react-native-keychain', () => ({}));
        const { listOpperModelPrices } = require('../index');
        const route = (id: string, input: number, aliases: string[] = []) => ({
            id, aliases, model_id: 'deepseek-v4-pro', pricing: { billing_unit: 'per_mtok', input: [input], output: [input * 2] },
        });
        fetchMock.mockResolvedValue({ ok: true, json: async () => ({ models: [
            route('alibaba:global/deepseek-v4-pro', 1.79, ['alibaba:eu/deepseek-v4-pro']),
            route('deepseek/deepseek-v4-pro', 1.2),
        ] }) });

        const prices = await listOpperModelPrices();

        expect(prices.get('alibaba:global/deepseek-v4-pro')?.input).toBe(1.79);
        expect(prices.get('alibaba:eu/deepseek-v4-pro')?.input).toBe(1.79);
        expect(prices.get('deepseek/deepseek-v4-pro')?.input).toBe(1.2);
        expect(prices.has('deepseek-v4-pro')).toBe(false);
    });
});
