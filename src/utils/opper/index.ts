import * as Keychain from 'react-native-keychain';

/**
 * Opper (https://opper.ai) image generation. Lets the chat model hand image requests to an
 * image model while the conversation itself stays on whatever LLM the user picked.
 *
 * Settings (API key + optional model) live in the keychain, readable after first unlock so
 * scheduled jobs running in the background can use them too.
 */

const KEYCHAIN_SERVICE = 'com.anythingllm.opper';
export const OPPER_BASE_URL = 'https://api.opper.ai';
/** Opper's built-in image function. The model is picked by Opper unless the user set one. */
const IMAGE_FUNCTION_NAME = 'image-gen';
export const OPPER_MODEL_PLACEHOLDER = 'openai/gpt-image-1';

export type OpperSettings = {
    apiKey: string;
    /** Empty = let Opper pick its default image model */
    model: string;
};

export type OpperImage = {
    /** Base64 image data, no data: prefix */
    base64: string;
    mimeType: string;
};

function log(text: string, ...args: any[]) {
    console.log(`\x1b[35m[Opper] ${text}\x1b[0m`, ...args);
}

let cached: OpperSettings | null | undefined;

export async function getOpperSettings(): Promise<OpperSettings | null> {
    if (cached !== undefined) return cached;
    try {
        const stored = await Keychain.getGenericPassword({ service: KEYCHAIN_SERVICE });
        const parsed = stored ? JSON.parse(stored.password) : null;
        cached = parsed?.apiKey ? { apiKey: String(parsed.apiKey), model: String(parsed.model ?? '') } : null;
    } catch (error) {
        log('Could not read stored settings', error);
        cached = null;
    }
    return cached;
}

export async function hasOpperApiKey(): Promise<boolean> {
    return !!(await getOpperSettings())?.apiKey;
}

export async function saveOpperSettings(settings: OpperSettings): Promise<void> {
    const next = { apiKey: settings.apiKey.trim(), model: settings.model.trim() };
    if (!next.apiKey) return clearOpperSettings();
    await Keychain.setGenericPassword('opper', JSON.stringify(next), {
        service: KEYCHAIN_SERVICE,
        accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
    cached = next;
}

export async function clearOpperSettings(): Promise<void> {
    cached = null;
    await Keychain.resetGenericPassword({ service: KEYCHAIN_SERVICE }).catch(() => false);
}

/** Pull a readable message out of an Opper error body */
function errorMessage(status: number, body: string): string {
    try {
        const parsed = JSON.parse(body);
        const message = parsed?.error?.message ?? parsed?.detail ?? parsed?.message;
        if (message) return `Opper error ${status}: ${typeof message === 'string' ? message : JSON.stringify(message)}`;
    } catch { }
    return `Opper error ${status}${body ? `: ${body.slice(0, 300)}` : ''}`;
}

/**
 * Generate one image. Mirrors `opper.generateImage()` from the `opperai` SDK: a call to the
 * `image-gen` function with a `{ description }` input and an `{ image, mime_type }` output.
 */
export async function generateOpperImage({ prompt, size, settings, signal }: {
    prompt: string;
    size?: string;
    settings: OpperSettings;
    signal?: AbortSignal | null;
}): Promise<OpperImage> {
    const inputProperties: Record<string, any> = {
        description: { type: 'string', description: 'Text description of the image to generate' },
    };
    const input: Record<string, any> = { description: prompt };
    if (size) {
        inputProperties.size = { type: 'string', description: 'Image size' };
        input.size = size;
    }

    const body: Record<string, any> = {
        input_schema: { type: 'object', properties: inputProperties, required: ['description'] },
        output_schema: {
            type: 'object',
            properties: {
                image: { type: 'string', description: 'Base64-encoded image data' },
                mime_type: { type: 'string', description: 'MIME type of the generated image' },
            },
            required: ['image', 'mime_type'],
        },
        input,
    };
    if (settings.model) body.model = settings.model;

    const response = await fetch(`${OPPER_BASE_URL}/v3/functions/${IMAGE_FUNCTION_NAME}/call`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${settings.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: signal ?? undefined,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(errorMessage(response.status, text));

    const parsed = JSON.parse(text);
    const raw: string | undefined = parsed?.data?.image;
    if (!raw) throw new Error('Opper returned no image');
    // Be lenient if a data: URL comes back instead of bare base64
    const match = /^data:([^;]+);base64,(.*)$/s.exec(raw);
    const base64 = match ? match[2] : raw;
    const mimeType = match?.[1] || parsed?.data?.mime_type || 'image/png';
    return { base64, mimeType };
}

/** File extension for an image MIME type */
export function imageExtension(mimeType: string): string {
    const sub = mimeType.split('/')[1]?.toLowerCase() ?? '';
    if (sub === 'jpeg' || sub === 'jpg') return 'jpg';
    if (sub === 'webp' || sub === 'gif' || sub === 'png') return sub;
    return 'png';
}
