/**
 * Prices from Opper's model listings (GET /v3/models). Chat models carry eg:
 *   pricing: { billing_unit: "per_mtok", input: [1.79], output: [3.58], cached_input: [0.15],
 *              cache_creation: [12.5], cache_creation_1h: [20] }
 * Each list holds price tiers: `thresholds` (prompt tokens) mark where the next tier starts, and
 * some models instead add `input_surcharge_threshold_tokens` with a multiplier. Image models carry eg:
 *   pricing: { billing_unit: "per_generation", rates: [{ unit, amount: 0.04 }], price_per_generation: 0.04 }
 * Only these known fields are read - anything else (web search fees, ...) is left out rather than
 * guessed. The model's top-level `cost` is a relative score, not a price.
 */

/** Token prices in USD per 1M tokens (base tier), image price in USD per image */
export type OpperPrice = {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    perImage?: number;
    /** Longer prompts cost more than the base prices shown */
    tiered?: boolean;
};

function toNumber(value: unknown): number | null {
    if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
    if (typeof value !== 'string' || !value.trim()) return null;
    const parsed = Number(value.replace(/[$,\s]/g, ''));
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/** Base tier of a price that is either a number or a list of tiers */
function baseTier(value: unknown): number | null {
    return toNumber(Array.isArray(value) ? value[0] : value);
}

/** Multiplier turning a token price in the given billing unit into USD per 1M tokens */
const TOKEN_UNITS: Record<string, number> = {
    per_mtok: 1,
    per_ktok: 1_000,
    per_token: 1_000_000,
};

/** Read the price an Opper model entry carries. Null when it has none we understand. */
export function parseOpperPrice(entry: any): OpperPrice | null {
    const raw = entry?.pricing;
    if (!raw || typeof raw !== 'object') return null;
    const unit = String(raw.billing_unit ?? '').toLowerCase();

    if (unit === 'per_generation' || unit === 'per_image') {
        const firstRate = Array.isArray(raw.rates) ? raw.rates[0] : null;
        const perImage = toNumber(raw.price_per_generation) ?? toNumber(raw.price_per_image) ?? toNumber(firstRate?.amount);
        return perImage === null ? null : { perImage };
    }

    const factor = TOKEN_UNITS[unit];
    if (!factor) return null;
    const price: OpperPrice = {};
    const set = (field: 'input' | 'output' | 'cacheRead' | 'cacheWrite', value: unknown) => {
        const base = baseTier(value);
        if (base !== null) price[field] = base * factor;
    };
    set('input', raw.input);
    set('output', raw.output);
    set('cacheRead', raw.cached_input);
    set('cacheWrite', raw.cache_creation);
    if (price.input === undefined && price.output === undefined) return null;

    const hasTiers = [raw.input, raw.output].some((value) => Array.isArray(value) && value.length > 1);
    const hasSurcharge = (toNumber(raw.input_surcharge_multiplier) ?? 1) > 1 || (toNumber(raw.output_surcharge_multiplier) ?? 1) > 1;
    if (hasTiers || hasSurcharge) price.tiered = true;
    return price;
}

function money(value: number): string {
    if (value === 0) return '$0';
    if (value >= 100) return `$${Math.round(value)}`;
    if (value >= 1) return `$${Number(value.toFixed(2))}`;
    // Keep two significant digits for small prices eg: $0.075, $0.0015
    return `$${Number(value.toPrecision(2))}`;
}

/**
 * One-line summary eg: "$1.79 in · $3.58 out · $0.15 cache /1M" or "$0.04 /image".
 * Tiered prices get a "+" (eg: "$0.2+ in") since long prompts cost more. Null when there is
 * nothing to show.
 */
export function formatOpperPrice(price: OpperPrice | null | undefined): string | null {
    if (!price) return null;
    if (price.perImage !== undefined) return `${money(price.perImage)} /image`;
    const plus = price.tiered ? '+' : '';
    const parts = [
        price.input !== undefined ? `${money(price.input)}${plus} in` : null,
        price.output !== undefined ? `${money(price.output)}${plus} out` : null,
        price.cacheRead !== undefined ? `${money(price.cacheRead)} cache` : null,
        price.cacheWrite !== undefined ? `${money(price.cacheWrite)} cache write` : null,
    ].filter(Boolean);
    return parts.length ? `${parts.join(' · ')} /1M` : null;
}
