/**
 * Prices from Opper's model listings. Chat models carry eg:
 *   pricing: { billing_unit: "per_mtok", input: [1.7904], output: [3.5808], cached_input: [0.1492] }
 * where each list holds price tiers (the first is the base price), and image models eg:
 *   pricing: { billing_unit: "per_generation", rates: [{ unit, amount: 0.04 }], price_per_generation: 0.04 } The shape is not documented, so
 * this also copes with plain numbers, "$1.00" strings and nested objects, and leaves out anything
 * it cannot place rather than guess. The model's top-level `cost` is a relative score, not a price.
 */

/** Token prices in USD per 1M tokens, image price in USD per image */
export type OpperPrice = {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    perImage?: number;
};

type Field = keyof OpperPrice;

/** Checked in order - cache keys first so "cache_read_input" is not taken for plain input */
const FIELD_PATTERNS: Array<[Field, RegExp]> = [
    ['cacheRead', /cache[_ -]?(read|hit)|cached[_ -]?(input|prompt|tokens)?|input[_ -]?cache[_ -]?read/],
    ['cacheWrite', /cache[_ -]?(write|creation|miss)|input[_ -]?cache[_ -]?write/],
    ['perImage', /image/],
    ['input', /input|prompt/],
    ['output', /output|completion/],
];

const PER_MILLION = /million|1m|mtok|per[_ -]?m\b/;
const PER_THOUSAND = /thousand|1k|ktok/;
const PER_TOKEN = /per[_ -]?token|token[_ -]?price/;

function toNumber(value: unknown): number | null {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string') return null;
    const parsed = Number(value.replace(/[$,\s]/g, ''));
    return value.trim() && Number.isFinite(parsed) ? parsed : null;
}

function fieldFor(path: string): Field | null {
    for (const [field, pattern] of FIELD_PATTERNS) if (pattern.test(path)) return field;
    return null;
}

/** Normalize a token price to USD per 1M tokens, using the key path for the unit when it says one */
function perMillion(value: number, path: string): number {
    if (PER_MILLION.test(path)) return value;
    if (PER_THOUSAND.test(path)) return value * 1_000;
    if (PER_TOKEN.test(path)) return value * 1_000_000;
    // No unit in the key: real per-million prices are cents or more, per-token prices are tiny
    return value > 0 && value < 0.001 ? value * 1_000_000 : value;
}

function walk(node: unknown, path: string, out: OpperPrice, unit: string) {
    if (Array.isArray(node)) {
        // A list of routes/tiers - the first one is the default route
        if (node.length) walk(node[0], path, out, unit);
        return;
    }
    if (node && typeof node === 'object') {
        for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
            if (key.toLowerCase() === 'billing_unit') continue;
            walk(value, path ? `${path}.${key.toLowerCase()}` : key.toLowerCase(), out, unit);
        }
        return;
    }
    const value = toNumber(node);
    if (value === null || value < 0) return;
    const field = fieldFor(path);
    if (!field || out[field] !== undefined) return;
    // billing_unit ("per_mtok", "per_image", ...) names the unit for every value under it
    out[field] = field === 'perImage' ? value : perMillion(value, `${unit} ${path}`);
}

/** Read whatever price info an Opper model entry carries. Null when there is none. */
export function parseOpperPrice(entry: any): OpperPrice | null {
    const raw = entry?.pricing;
    if (raw === undefined || raw === null) return null;
    const out: OpperPrice = {};
    // A bare number as pricing on an image model is a price per image
    if (toNumber(raw) !== null && typeof raw !== 'object') {
        out.perImage = toNumber(raw)!;
        return out;
    }
    const unit = String(raw?.billing_unit ?? '').toLowerCase();
    if (/image|generation/.test(unit)) {
        // Image models: { billing_unit: "per_generation", price_per_generation: 0.04, rates: [{ amount }] }
        const firstRate = Array.isArray(raw.rates) ? raw.rates[0] : null;
        const perImage = toNumber(raw.price_per_generation)
            ?? toNumber(raw.price_per_image)
            ?? toNumber(firstRate?.amount)
            ?? toNumber(Array.isArray(raw.output) ? raw.output[0] : raw.output);
        return perImage === null ? null : { perImage };
    }
    walk(raw, '', out, unit);
    return Object.keys(out).length ? out : null;
}

function money(value: number): string {
    if (value === 0) return '$0';
    if (value >= 100) return `$${Math.round(value)}`;
    if (value >= 1) return `$${Number(value.toFixed(2))}`;
    // Keep two significant digits for small prices eg: $0.075, $0.0015
    return `$${Number(value.toPrecision(2))}`;
}

/**
 * One-line summary eg: "$1 in · $3 out · $0.10 cache /1M" or "$0.04 /image".
 * Null when there is nothing to show.
 */
export function formatOpperPrice(price: OpperPrice | null | undefined): string | null {
    if (!price) return null;
    const tokenParts = [
        price.input !== undefined ? `${money(price.input)} in` : null,
        price.output !== undefined ? `${money(price.output)} out` : null,
        price.cacheRead !== undefined ? `${money(price.cacheRead)} cache` : null,
        price.cacheWrite !== undefined ? `${money(price.cacheWrite)} cache write` : null,
    ].filter(Boolean);
    const parts: string[] = [];
    if (price.perImage !== undefined) parts.push(`${money(price.perImage)} /image`);
    if (tokenParts.length) parts.push(`${tokenParts.join(' · ')} /1M`);
    return parts.length ? parts.join(' · ') : null;
}
