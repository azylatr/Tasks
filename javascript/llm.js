import { ofetch } from "ofetch";
import extension from "./extension.js";

/**
 * Pre-compiled Regular Expression for Vision/Multimodal model detection.
 * Replaces array iteration & repeated string lowercasing per call.
 * Added support for broader multi-LLM vision models.
 */
const VISION_MODEL_REGEX = /vision|vl|multimodal|gemini|gpt-4o|gpt-4-turbo|o1|o3|claude-3|llava|pixtral|fuyu|qwen-vl|qwen2-7b-instruct-instruct|deepseek-vl|llama-3\.2-(?:11b|90b)|internvl|cogvlm/i;

/**
 * Supported parameters allowed to pass to OpenAI-compatible endpoints.
 */
const SAFE_PARAM_KEYS = Object.freeze([
    "temperature",
    "max_tokens",
    "top_p",
    "frequency_penalty",
    "presence_penalty",
    "stop"
]);

/**
 * Static lookup map for friendly MIME type labels.
 */
const MIME_LABEL_MAP = Object.freeze({
    "application/pdf": "PDF",
    "text/plain": "TXT",
    "text/csv": "CSV",
    "application/json": "JSON",
    "application/zip": "ZIP",
    "image/svg+xml": "SVG",
    "audio/mpeg": "MP3",
    "audio/wav": "WAV",
    "application/msword": "DOC",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
    "application/vnd.ms-excel": "XLS",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "XLSX",
});

/**
 * Pre-allocated Set for code/text extensions (O(1) lookup).
 */
const TEXT_EXTENSIONS_SET = new Set([
    "md", "mjs", "cjs", "js", "ts", "jsx", "tsx", "json", "jsonl",
    "xml", "csv", "yaml", "yml", "toml", "ini", "env", "sh",
    "bash", "zsh", "lua", "py", "rb", "java", "c", "cpp", "h", "go",
    "rs", "swift", "kt", "dart", "php", "html", "css", "scss", "less",
    "vue", "svelte", "sql", "graphql", "gql", "dockerfile", "makefile",
    "gitignore", "editorconfig", "txt", "svg", "zig"
]);

/**
 * Regex pattern for structured text MIME types.
 */
const TEXT_MIME_REGEX = /^application\/(json|xml|javascript|typescript|x-sh|graphql|x-yaml|toml)$/;

/**
 * Custom Error class for handling LLM Service exceptions.
 */
export class LLMServiceError extends Error {
    /**
     * Creates an instance of LLMServiceError.
     * 
     * @param {string} message - Error description.
     * @param {number} [status=0] - HTTP Status code or error code.
     * @param {any} [details=null] - Raw response payload or detailed error object.
     */
    constructor(message, status = 0, details = null) {
        super(message);
        this.name = "LLMServiceError";
        this.status = status;
        this.details = details;
    }
}

/**
 * Base HTTP fetch wrapper optimized for LLM endpoints with auto-retry, 
 * smart URL sanitation, and stream handling.
 *
 * @param {Object} options - Configuration options for the API fetch request.
 * @param {string} options.apiKey - API key authorization.
 * @param {string} options.baseURL - API host URL (will be auto-sanitized).
 * @param {string} options.path - Endpoint route path (e.g., /chat/completions).
 * @param {string} [options.method="POST"] - HTTP Method.
 * @param {Object|FormData} [options.body] - Request body payload.
 * @param {Object} [options.headers={}] - Custom headers.
 * @param {AbortSignal} [options.signal] - AbortSignal for canceling request.
 * @param {boolean} [options.stream=false] - Whether to handle response as ReadableStream.
 * @param {number} [options.timeout=30000] - Request timeout in milliseconds.
 * @param {number} [options.retry=2] - Number of retries on network/server error.
 * @returns {Promise<any>} Response data or readable stream.
 */
export async function apiFetch({
    apiKey,
    baseURL,
    path,
    method = "POST",
    body,
    headers = {},
    signal,
    stream = false,
    timeout = 30000,
    retry = 2,
}) {
    // Sanitize baseURL to prevent overlapping endpoints (e.g. /audio/speech/chat/completions)
    const cleanBase = _sanitizeBaseURL(baseURL);
    const url = cleanBase + path;
    
    try {
        const res = await ofetch.raw(url, {
            method,
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`,
                ...headers,
            },
            body: (body && method !== "GET") ?
                (body instanceof FormData ? body : JSON.stringify(body)) : undefined,
            signal,
            responseType: stream ? "stream" : "json",
            timeout,
            retry: stream ? 0 : retry,
            retryStatusCodes: [408, 429, 500, 502, 503, 504],
            retryDelay: (n) => Math.min(500 * (1 << n), 8000), // Fast bitwise exponentiation
        });
        
        return stream ? (res._data ?? res) : res._data;
    } catch (err) {
        const status = err.response?.status ?? 
            err.status ?? 
            err.statusCode ??
            0;
        let details = err.data ?? 
            err.response?._data ??
            null;
        
        // Drain stream reader if details were returned as stream error response
        if (stream && details && typeof details.getReader === "function") {
            try {
                const reader = details.getReader();
                const { value } = await reader.read();
                if (value) details = new TextDecoder().decode(value);
            } catch {}
        }
        
        if (typeof details === "string") {
            try { details = JSON.parse(details); } catch {}
        }
        
        let msg = details?.error?.message ||
            details?.error ||
            details?.message ||
            details?.detail ||
            (typeof details === "string" ? details : null);
        
        if (!msg) {
            if (typeof details === "object" && details !== null && Object.keys(details).length > 0) {
                msg = JSON.stringify(details);
            } else {
                msg = err.message || "Unknown error.";
            }
        }
        
        throw new LLMServiceError(`[${status}]${msg}`, status, details);
    }
}

/**
 * Fetch available LLM models with pagination and auto-deduplication.
 * Works across multiple providers natively.
 *
 * @param {Object} options - Model fetching options.
 * @param {string} options.apiKey - Provider API key.
 * @param {string} options.baseURL - Provider Base URL.
 * @param {AbortSignal} [options.signal] - Abort signal.
 * @returns {Promise<Array<{id: string, [key: string]: any}>>} List of available models.
 */
export async function fetchAllModels({
    apiKey,
    baseURL,
    signal
}) {
    const all = [];
    let after = null;
    let offset = 0;
    let page = 0;
    
    const isGemini = baseURL.includes("generativelanguage.googleapis.com");
    
    while (page++ < 20) {
        let path = "/models";

        if (!isGemini) {
            const q = new URLSearchParams({ limit: "100" });
            if (after)  q.set("after", after);
            if (offset) q.set("offset", String(offset));
            path = `/models?${q}`;
        }

        const data = await apiFetch({
            apiKey, baseURL, signal,
            path,
            method: "GET",
            timeout: 12000,
            retry: 3,
        });

        const items = data?.data ?? data?.models ?? data?.results ?? [];
        if (!items.length) break;

        // Fast array insertion
        for (let i = 0; i < items.length; i++) {
            all.push(items[i]);
        }

        if (isGemini) break;
        if (data?.has_more && data?.last_id) {
            after = data.last_id;
            continue;
        }

        if (items.length === 100) {
            offset += 100;
            continue;
        }

        break;
    }

    // Deduplicate and sort without localeCompare overhead
    const seen = new Set();
    const result = [];

    for (let i = 0; i < all.length; i++) {
        const item = all[i];
        if (item?.id && !seen.has(item.id)) {
            seen.add(item.id);
            result.push(item);
        }
    }

    // Fast ASCII string sorting (much faster than localeCompare for technical model IDs)
    return result.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * High-performance, zero-GC-spike streaming chat generator.
 * Yields raw text tokens directly for smooth UI rendering in Vue/React.
 *
 * @param {Object} options - Streaming chat options.
 * @param {string} options.apiKey - Provider API key.
 * @param {string} options.baseURL - Provider Base URL.
 * @param {string} options.model - Selected model ID.
 * @param {Array<Object>} options.messages - Chat message history.
 * @param {Object} [options.params] - Optional LLM generation parameters.
 * @param {AbortSignal} [options.signal] - Abort signal to cancel stream.
 * @returns {AsyncGenerator<string, void, unknown>} Yields stream text chunks.
 */
export async function* streamChat({ 
    apiKey, 
    baseURL, 
    model, 
    messages,
    params = {}, 
    signal 
}) {
    const res = await apiFetch({
        apiKey, baseURL, signal,
        path: "/chat/completions",
        body: {
            model,
            messages,
            stream: true,
            ..._safeParams(params, baseURL)
        },
        stream: true,
    });

    const reader = (res.body ?? res).getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            // Stream decoding without re-creating TextDecoder instance
            buffer += decoder.decode(value, { stream: true });

            // Zero-allocation line parser using indexOf (Avoids buffer.split("\n") GC spikes)
            let lineBreakIdx;
            while ((lineBreakIdx = buffer.indexOf("\n")) !== -1) {
                const line = buffer.slice(0, lineBreakIdx).trim();
                buffer = buffer.slice(lineBreakIdx + 1);

                // Early exit checks to skip empty or invalid SSE chunks
                if (!line || line === "data: [DONE]" || !line.startsWith("data: ")) {
                    continue;
                }

                try {
                    // Extract payload using slice(6) -> "data: "
                    const parsed = JSON.parse(line.slice(6));
                    const delta = parsed?.choices?.[0]?.delta?.content;

                    // Yield primitive string (Vue reactivity friendly)
                    if (delta) yield delta;
                } catch {
                    // Skip malformed chunk silently
                }
            }
        }

        // Flush remaining buffer if stream ends abruptly
        if (buffer.length > 0) {
            const line = buffer.trim();
            if (line && line !== "data: [DONE]" && line.startsWith("data: ")) {
                try {
                    const delta = JSON.parse(line.slice(6))?.choices?.[0]?.delta?.content;
                    if (delta) yield delta;
                } catch {}
            }
        }
    } finally {
        // Essential lock release: Prevents memory leaks if Vue component unmounts mid-stream
        reader.releaseLock();
    }
}

/**
 * Non-streaming chat request wrapper.
 *
 * @param {Object} options - Chat options.
 * @param {string} options.apiKey - Provider API key.
 * @param {string} options.baseURL - Provider Base URL.
 * @param {string} options.model - Selected model ID.
 * @param {Array<Object>} options.messages - Chat message history.
 * @param {Object} [options.params] - Optional parameters.
 * @returns {Promise<string>} The complete AI response text.
 */
export async function sendChat({ 
    apiKey, 
    baseURL, 
    model,
    messages, 
    params = {}
}) {
    const data = await apiFetch({
        apiKey, baseURL,
        path: "/chat/completions",
        body: {
            model,
            messages,
            stream: false,
            ..._safeParams(params, baseURL)
        },
    });

    return data?.choices?.[0]?.message?.content ?? "";
}

/**
 * Generate images using OpenAI DALL-E or compatible image APIs.
 * Automatically routes to the dedicated generation path.
 *
 * @param {Object} options - Image generation options.
 * @returns {Promise<Array<Object>>} Array containing generated image objects/URLs.
 */
export async function generateImage({
    apiKey, 
    baseURL, 
    model,
    prompt,
    n = 1,
    size = "1024x1024",
    quality, 
    style,
    responseFormat = "url",
}) {
    const body = { 
        model, prompt,
        n, size, 
        response_format: responseFormat
    };
    
    if (quality) body.quality = quality;
    if (style) body.style = style;

    const data = await apiFetch({
        apiKey,
        baseURL,
        path: "/images/generations",
        body
    });
    
    return data?.data ?? [];
}

/**
 * Transcribe audio file using Whisper or similar speech-to-text models.
 * Automatically routes to the transcriptions endpoint.
 *
 * @param {Object} options - Transcription options.
 * @returns {Promise<string>} Transcribed text from audio.
 */
export async function transcribeAudio({
    apiKey,
    baseURL, 
    model,
    file,
    language,
    prompt
}) {
    const form = new FormData();
    form.append("file", file, file.name);
    form.append("model", model);
    if (language) form.append("language", language);
    if (prompt)   form.append("prompt", prompt);

    const data = await apiFetch({
        apiKey, baseURL,
        path: "/audio/transcriptions",
        body: form,
        headers: { "Content-Type": undefined },
    });

    return data?.text ?? "";
}

/**
 * Convert text into speech audio Blob using compatible TTS models.
 * Automatically routes to the speech endpoint.
 *
 * @param {Object} options - Text to Speech options.
 * @returns {Promise<Blob>} Audio blob generated from text.
 */
export async function textToSpeech({ 
    apiKey,
    baseURL, 
    model, 
    input, 
    voice = "aisha",
    format = "wav" 
}) {
    const res = await apiFetch({
        apiKey, baseURL,
        path: "/audio/speech",
        body: { model, input, voice, response_format: format },
        stream: true,
    });

    const reader = (res.body ?? res).getReader();
    const chunks = [];

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
        }
    } finally {
        reader.releaseLock();
    }

    return new Blob(chunks, { type: `audio/${format}` });
}

/**
 * Generate text embeddings.
 *
 * @param {Object} options - Embeddings options.
 * @returns {Promise<Array<Array<number>>>} Generated numerical vector array.
 */
export async function createEmbeddings({
    apiKey,
    baseURL,
    model,
    input 
}) {
    const data = await apiFetch({
        apiKey, baseURL,
        path: "/embeddings",
        body: { model, input },
    });

    return (data?.data ?? []).map(d => d.embedding);
}

/**
 * Read browser File object for LLM processing (Text slicing or Base64 encoding).
 *
 * @param {File} file - Standard File API object.
 * @returns {Promise<Object>} Formatted object ready for AI processing.
 */
export async function readFileForAI(file) {
    const mime = _resolveMime(file);

    if (_isText(mime, file.name)) {
        const text = (await _toText(file)).slice(0, 12000);
        return {
            kind: "text",
            fileName: file.name,
            mimeType: mime,
            size: file.size,
            text
        };
    }

    const base64 = await _toBase64(file);
    return {
        kind: "image",
        fileName: file.name,
        mimeType: mime,
        size: file.size,
        base64
    };
}

/**
 * Build message content array or string for single/multiple file attachments.
 *
 * @param {Object|Array<Object>} fileData - Parsed file data object(s).
 * @param {string} userText - Associated user message prompt.
 * @returns {string|Array<Object>} Content formatted for OpenAI structure.
 */
export function buildFileContent(fileData, userText) {
    const files = Array.isArray(fileData) ? fileData : [fileData];
    const hasImages = files.some(f => f.kind === "image");

    if (hasImages) {
        const parts = [];
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            if (file.kind === "image") {
                parts.push({
                    type: "image_url",
                    image_url: {
                        url: `data:${file.mimeType};base64,${file.base64}`
                    }
                });
            } else if (file.text) {
                parts.push({
                    type: "text",
                    text: `[File: ${file.fileName}]\n\`\`\`\n${file.text}\n\`\`\``
                });
            }
        }
        if (userText) {
            parts.push({
                type: "text",
                text: userText
            });
        }
        return parts.length > 0 ? parts : userText;
    }

    const blocks = files.map(f => {
        const meta = `${f.fileName}  ·  ${_mimeLabel(f.mimeType, f.fileName)}  ·${_fmtBytes(f.size)}`;
        const block = f.text ? `\`\`\`\n${f.text}\n\`\`\`` : "[No extractable text content]";
        return `${meta}\n${block}`;
    }).join("\n\n");

    return userText ? `${blocks}\n\n${userText}` : blocks;
}

/**
 * Prepare array of messages formatted for OpenAI-compatible API endpoints.
 * Auto-handles non-vision model fallback if user sends images.
 *
 * @param {string} model - Selected LLM model name.
 * @param {Array<Object>} messages - Raw chat conversation messages.
 * @param {string} [systemPrompt=""] - Optional custom system prompt override.
 * @returns {Array<Object>} Formatted API messages array.
 */
export function buildAPIMessages(model, messages, systemPrompt = "") {
    // Zero-allocation regex test instead of array loop .includes()
    const isVisionModel = VISION_MODEL_REGEX.test(model || "");

    const today = new Date().toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric"
    });

    const system = systemPrompt || `You are a friendly assistant and not very stiff in responding. And when the user uses the language he uses, you also have to follow suit by using the same language so that it is natural and avoid excessive use of emojis!! If a user asks you to create LaTeX, just send them the LaTeX directly, not the code!! This is mandatory unless the user asks you to write the LaTeX code with code blocks. Today is ${today} user time.`;

    const out = [{ role: "system", content: system }];

    for (let i = 0; i < messages.length; i++) {
        const m = messages[i];
        if (m.role !== "user" && m.role !== "assistant") continue;

        let cleanedContent = m.content;

        if (Array.isArray(m.content)) {
            if (isVisionModel) {
                cleanedContent = m.content;
            } else {
                // Single-pass optimization for vision fallback content
                let textPart = "";
                let hasImage = false;

                for (let j = 0; j < m.content.length; j++) {
                    const part = m.content[j];
                    if (part.type === "text" && part.text) {
                        textPart = part.text;
                    } else if (part.type === "image_url") {
                        hasImage = true;
                    }
                }

                if (hasImage) {
                    cleanedContent = `[User uploaded an image file, but your model version is text-only. Please tell user nicely if you need them to describe it.]\n\n${textPart}`.trim();
                } else {
                    cleanedContent = textPart;
                }
            }
        }

        if (cleanedContent == null) {
            cleanedContent = "";
        } else if (!Array.isArray(cleanedContent) && typeof cleanedContent !== "string") {
            cleanedContent = String(cleanedContent);
        }

        out.push({ role: m.role, content: cleanedContent });
    }

    return out;
}

/**
 * Generate lightweight random string ID.
 * @returns {string} Random alphanumeric ID string.
 */
export function generateId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Generate shortened chat session title from initial user message.
 *
 * @param {string} firstMessage - The initial prompt.
 * @returns {string} Trimmed chat session title.
 */
export function generateSessionTitle(firstMessage) {
    const text = (firstMessage || "").trim();
    return text.length <= 40 ? text : text.slice(0, 37) + "...";
}

/**
 * Cleans and sanitizes the baseURL to prevent endpoint overlapping.
 * Dynamically strips known endpoints (/chat/completions, /audio/speech, etc.)
 * if the user accidentally included them in their global API configuration,
 * ensuring Multi-LLM provider compatibility.
 * 
 * @param {string} url - The raw, potentially dirty base URL.
 * @returns {string} - The sanitized root base URL ready for path appending.
 */
function _sanitizeBaseURL(url) {
    if (!url || typeof url !== "string") return "";
    let clean = url.trim().replace(/\/+$/, "");
    
    // Known trailing endpoint paths that might be mistakenly appended by users
    const knownEndpoints = [
        "/chat/completions",
        "/audio/transcriptions",
        "/audio/translations",
        "/audio/speech",
        "/images/generations",
        "/embeddings",
        "/models"
    ];
    
    // Strip trailing endpoints to enforce scalability
    for (let i = 0; i < knownEndpoints.length; i++) {
        const ep = knownEndpoints[i];
        if (clean.toLowerCase().endsWith(ep)) {
            clean = clean.slice(0, -ep.length);
            break; 
        }
    }
    
    // Safety check to remove any remaining trailing slash
    return clean.replace(/\/+$/, "");
}

/**
 * Filter supported LLM parameters and remove prohibited parameters per vendor (e.g., Gemini).
 *
 * @param {Object} p - Custom parameters object.
 * @param {string} baseURL - Host URL used for vendor detection.
 * @returns {Object} Safe parameters strictly compatible with the destination endpoint.
 */
function _safeParams(p = {}, baseURL = "") {
    const isGemini = baseURL.includes("generativelanguage.googleapis.com");
    const out = {};

    for (let i = 0; i < SAFE_PARAM_KEYS.length; i++) {
        const k = SAFE_PARAM_KEYS[i];
        if (isGemini && (k === "frequency_penalty" || k === "presence_penalty")) {
            continue;
        }
        if (p[k] != null) out[k] = p[k];
    }

    if (!out.stop && p.stop_sequences != null) {
        out.stop = p.stop_sequences;
    }
    return out;
}

/**
 * Fast resolution of file extension MIME type without string splits.
 *
 * @param {File} file - File object.
 * @returns {string} MIME Type.
 */
function _resolveMime(file) {
    const name = file.name;
    const lastDot = name.lastIndexOf(".");
    const ext = lastDot !== -1 ? name.slice(lastDot).toLowerCase() : "";
    return extension[ext] ?? file.type ?? "application/octet-stream";
}

/**
 * Fast check if file is text/code based on MIME type or extension.
 *
 * @param {string} mime - Resolved MIME type.
 * @param {string} name - Original file name.
 * @returns {boolean} True if text/code, false otherwise.
 */
function _isText(mime, name) {
    if (mime.startsWith("text/") || mime === "image/svg+xml") {
        return true;
    }

    if (TEXT_MIME_REGEX.test(mime)) return true;

    const lastDot = name.lastIndexOf(".");
    const ext = lastDot !== -1 ? name.slice(lastDot + 1).toLowerCase() : "";
    return TEXT_EXTENSIONS_SET.has(ext);
}

/**
 * Read Blob/File as Base64 string.
 *
 * @param {File} file - Blob or File object.
 * @returns {Promise<string>} Base64 representation.
 */
function _toBase64(file) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result.split(",")[1]);
        r.onerror = () => reject(new Error(`Failed to read "${file.name}" as base64`));
        r.readAsDataURL(file);
    });
}

/**
 * Read Blob/File as text.
 *
 * @param {File} file - Blob or File object.
 * @returns {Promise<string>} Extracted string text.
 */
function _toText(file) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => reject(new Error(`Failed to read "${file.name}" as text`));
        r.readAsText(file, "utf-8");
    });
}

/**
 * Map MIME type to friendly uppercase tag.
 *
 * @param {string} mime - MIME type string.
 * @param {string} [name=""] - File name.
 * @returns {string} Uppercase tag identifier.
 */
function _mimeLabel(mime, name = "") {
    if (MIME_LABEL_MAP[mime]) return MIME_LABEL_MAP[mime];
    if (mime.includes("/")) return mime.split("/")[1].toUpperCase();

    const lastDot = name.lastIndexOf(".");
    return lastDot !== -1 ? name.slice(lastDot + 1).toUpperCase() : "FILE";
}

/**
 * Format bytes into human-readable string.
 *
 * @param {number} b - Byte size.
 * @returns {string} Formatted size string (e.g. "1.5 MB").
 */
function _fmtBytes(b) {
    if (b < 1024) return b + " B";
    if (b < 1048576) return (b / 1024).toFixed(1) + " KB";
    return (b / 1048576).toFixed(1) + " MB";
}
