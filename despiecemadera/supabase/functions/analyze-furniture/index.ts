import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function fetchWithTimeout(input: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

const responseSchema = {
  type: "object",
  required: ["furnitureType", "summary", "assumptions", "suggestedDimensions", "dimensionConfidence", "parts"],
  properties: {
    furnitureType: { type: "string", enum: ["desk", "kitchen-module", "closet", "shelf", "table", "other"] },
    summary: { type: "string" },
    assumptions: { type: "array", items: { type: "string" } },
    suggestedDimensions: {
      type: "object",
      required: ["widthMm", "heightMm", "depthMm"],
      properties: {
        widthMm: { type: "number" },
        heightMm: { type: "number" },
        depthMm: { type: "number" },
      },
    },
    dimensionConfidence: { type: "number" },
    parts: {
      type: "array",
      items: {
        type: "object",
        required: ["name", "type", "lengthMm", "widthMm", "thicknessMm", "quantity"],
        properties: {
          name: { type: "string" },
          type: { type: "string", enum: ["T", "L"] },
          lengthMm: { type: "number" },
          widthMm: { type: "number" },
          thicknessMm: { type: "number" },
          quantity: { type: "integer" },
        },
      },
    },
  },
};

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return reply(405, { error: "Method not allowed." });

  const authorization = request.headers.get("Authorization");
  if (!authorization) return reply(401, { error: "Inicia sesión para analizar una foto." });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  const cloudflareAccountId = Deno.env.get("CLOUDFLARE_ACCOUNT_ID");
  const cloudflareApiToken = Deno.env.get("CLOUDFLARE_API_TOKEN");
  const hasCloudflareFallback = Boolean(cloudflareAccountId && cloudflareApiToken);
  if (!supabaseUrl || !anonKey || (!apiKey && !hasCloudflareFallback)) {
    return reply(503, { error: "Configura Gemini o el respaldo de Cloudflare para habilitar el análisis." });
  }

  const supabase = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: authorization } },
  });
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) return reply(401, { error: "La sesión no es válida." });

  let body: {
    image?: { mimeType?: string; base64?: string };
    dimensions?: { width?: number | null; height?: number | null; depth?: number | null };
    furnitureType?: string;
  };
  try {
    body = await request.json();
  } catch {
    return reply(400, { error: "El cuerpo de la solicitud no es JSON válido." });
  }

  const image = body.image;
  const dimensions = body.dimensions || {};
  const supportedTypes = ["image/jpeg", "image/png", "image/webp"];
  if (!image || !supportedTypes.includes(image.mimeType || "") || !image.base64 || image.base64.length > 5_600_000) {
    return reply(400, { error: "La imagen debe ser JPG, PNG o WebP y pesar 4 MB o menos." });
  }
  const providedDimensions: Partial<Record<"width" | "height" | "depth", number>> = {};
  for (const key of ["width", "height", "depth"] as const) {
    const value = dimensions[key];
    if (value === undefined || value === null) continue;
    if (!Number.isFinite(value) || value <= 0 || value > 10000) {
      return reply(400, { error: "Las dimensiones indicadas deben ser mayores que cero y estar en milímetros." });
    }
    providedDimensions[key] = value;
  }

  const allowedFurnitureTypes = ["auto", "desk", "kitchen-module", "closet", "shelf", "table", "other"];
  const requestedType = allowedFurnitureTypes.includes(body.furnitureType || "") ? body.furnitureType! : "auto";
  const dimensionContext = Object.keys(providedDimensions).length
    ? `El usuario proporcionó estas dimensiones exteriores exactas en mm: ${JSON.stringify(providedDimensions)}. Respétalas exactamente. Para las que falten, sugiere medidas plausibles y explica la incertidumbre.`
    : "El usuario no proporcionó escala. Sugiere dimensiones exteriores típicas y plausibles para el tipo de mueble identificado; no afirmes que son medidas obtenidas de la foto.";
  const prompt = `Analiza la fotografía e identifica el tipo de mueble y su estructura. El usuario seleccionó como referencia «${requestedType}»; si eligió «auto», identifica el tipo por la imagen. Devuelve furnitureType como desk, kitchen-module, closet, shelf, table u other.

${dimensionContext}

No calcules escala desde píxeles. Devuelve suggestedDimensions en mm y dimensionConfidence entre 0 y 1 para las medidas que hayas tenido que estimar. Propón las piezas estructurales para el volumen exterior sugerido. Usa «T» para tablero y «L» para listones/madera maciza. No infieras especie ni acabado. Si es un módulo de cocina, interprétalo como un módulo individual, no como una cocina completa. Incluye en assumptions las uniones y detalles no visibles. Devuelve solo JSON con furnitureType, summary, assumptions, suggestedDimensions, dimensionConfidence y parts. Cada pieza incluye name, type («T» o «L»), lengthMm, widthMm, thicknessMm y quantity. Son propuestas revisables, no afirmes que garantizan resistencia o seguridad.`;

  const model = Deno.env.get("GEMINI_MODEL") || "gemini-3.8-flash";
  const endpoint = "https://generativelanguage.googleapis.com/v1beta/interactions";
  let text: string | null = null;
  let provider = "Cloudflare";
  let geminiFailure: { status: number | null; message: string } | null = null;

  if (apiKey) {
    const requestBody = JSON.stringify({
      model,
      input: [
        { type: "text", text: prompt },
        { type: "image", data: image.base64, mime_type: image.mimeType },
      ],
      response_format: { type: "text", mime_type: "application/json", schema: responseSchema },
      store: false,
    });
    let modelResponse: Response | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        modelResponse = await fetchWithTimeout(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
            "Api-Revision": "2026-05-20",
          },
          body: requestBody,
        }, 20000);
      } catch {
        if (attempt === 2) break;
        await new Promise((resolve) => setTimeout(resolve, 750 * (attempt + 1)));
        continue;
      }
      if (modelResponse.ok || ![429, 503].includes(modelResponse.status) || attempt === 2) break;
      const retryAfterSeconds = Number(modelResponse.headers.get("Retry-After"));
      const delayMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
        ? Math.min(retryAfterSeconds * 1000, 3000)
        : 750 * (attempt + 1);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    if (modelResponse?.ok) {
      try {
        const result: { output_text?: string } = await modelResponse.json();
        text = result.output_text?.trim() || null;
        if (text) provider = "Gemini";
        else geminiFailure = { status: null, message: "Gemini devolvió una respuesta vacía." };
      } catch {
        geminiFailure = { status: null, message: "Gemini devolvió una respuesta inválida." };
      }
    } else if (modelResponse) {
      let providerMessage = `Gemini respondió HTTP ${modelResponse.status}.`;
      try {
        const providerBody = await modelResponse.json();
        const message = providerBody?.error?.message;
        if (typeof message === "string") providerMessage = message.replace(/\s+/g, " ").slice(0, 350);
      } catch {}
      geminiFailure = { status: modelResponse.status, message: providerMessage };
    } else {
      geminiFailure = { status: null, message: "No se pudo contactar con Gemini." };
    }

    if (geminiFailure?.status !== null && geminiFailure && ![429, 503].includes(geminiFailure.status)) {
      return reply(502, {
        error: `Gemini respondió HTTP ${geminiFailure.status}: ${geminiFailure.message}`,
        providerStatus: geminiFailure.status,
      });
    }
  }

  if (!text) {
    if (!hasCloudflareFallback || !cloudflareAccountId || !cloudflareApiToken) {
      return reply(502, {
        error: geminiFailure
          ? `${geminiFailure.message} Configura CLOUDFLARE_ACCOUNT_ID y CLOUDFLARE_API_TOKEN en Supabase para habilitar el respaldo.`
          : "Configura GEMINI_API_KEY o el respaldo de Cloudflare en Supabase.",
        providerStatus: geminiFailure?.status || undefined,
      });
    }

    const cloudflareEndpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(cloudflareAccountId)}/ai/run/@cf/meta/llama-3.2-11b-vision-instruct`;
    const cloudflarePrompt = `${prompt}\n\nDevuelve exclusivamente JSON válido, sin bloques Markdown, y respeta este esquema: ${JSON.stringify(responseSchema)}`;
    let cloudflareResponse: Response;
    try {
      cloudflareResponse = await fetchWithTimeout(cloudflareEndpoint, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${cloudflareApiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: [{
            role: "user",
            content: [
              { type: "text", text: cloudflarePrompt },
              { type: "image_url", image_url: { url: `data:${image.mimeType};base64,${image.base64}` } },
            ],
          }],
          max_tokens: 3072,
          temperature: 0.1,
        }),
      }, 30000);
    } catch {
      return reply(504, { error: "Gemini está temporalmente saturado y Cloudflare no respondió en 30 segundos. Inténtalo de nuevo." });
    }

    let cloudflareBody: {
      result?: { response?: string; choices?: Array<{ message?: { content?: string | null } }> };
      errors?: Array<{ message?: string }>;
    };
    try {
      cloudflareBody = await cloudflareResponse.json();
    } catch {
      return reply(502, { error: `Cloudflare respondió HTTP ${cloudflareResponse.status} con un formato inválido.` });
    }
    if (!cloudflareResponse.ok || cloudflareBody.errors?.length) {
      const message = cloudflareBody.errors?.map((error) => error.message).filter(Boolean).join(" ") || "Error del proveedor de visión.";
      return reply(502, { error: `Gemini no está disponible; Cloudflare respondió HTTP ${cloudflareResponse.status}: ${message}` });
    }
    text = (cloudflareBody.result?.choices?.[0]?.message?.content || cloudflareBody.result?.response || "").trim() || null;
    provider = "Cloudflare";
    if (!text) return reply(502, { error: "Cloudflare Llama no devolvió una propuesta de estructura." });
  }

  let proposal: {
    furnitureType?: string;
    summary?: string;
    assumptions?: unknown[];
    suggestedDimensions?: Record<string, unknown>;
    dimensionConfidence?: number;
    parts?: Array<Record<string, unknown>>;
  };
  try {
    const jsonText = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    try {
      proposal = JSON.parse(jsonText);
    } catch {
      const start = jsonText.indexOf("{");
      const end = jsonText.lastIndexOf("}");
      if (start < 0 || end <= start) throw new Error("No hay un objeto JSON en la respuesta.");
      proposal = JSON.parse(jsonText.slice(start, end + 1));
    }
  } catch {
    return reply(502, {
      error: `${provider} no devolvió JSON válido. Revisa la respuesta original del proveedor.`,
      provider,
      providerOutput: text.slice(0, 2500),
    });
  }
  if (!Array.isArray(proposal.parts) || proposal.parts.length < 1 || proposal.parts.length > 100) {
    return reply(502, { error: "La propuesta no contiene una lista de piezas válida." });
  }

  const suggested = proposal.suggestedDimensions || {};
  const suggestedDimensions = {
    widthMm: providedDimensions.width ?? Number(suggested.widthMm),
    heightMm: providedDimensions.height ?? Number(suggested.heightMm),
    depthMm: providedDimensions.depth ?? Number(suggested.depthMm),
  };
  if (!Object.values(suggestedDimensions).every((value) => Number.isFinite(value) && value > 0 && value <= 10000)) {
    return reply(502, { error: "La IA no pudo proponer dimensiones válidas. Añade ancho, alto y fondo e inténtalo otra vez." });
  }
  const furnitureTypes = ["desk", "kitchen-module", "closet", "shelf", "table", "other"];
  const detectedFurnitureType = furnitureTypes.includes(proposal.furnitureType || "") ? proposal.furnitureType! : "other";
  const dimensionConfidence = Number.isFinite(proposal.dimensionConfidence)
    ? Math.max(0, Math.min(1, proposal.dimensionConfidence!))
    : 0.3;

  const parts = [];
  for (const part of proposal.parts) {
    const type = part.type === "L" ? "L" : part.type === "T" ? "T" : null;
    const name = typeof part.name === "string" ? part.name.trim().slice(0, 80) : "";
    const lengthMm = Number(part.lengthMm);
    const widthMm = Number(part.widthMm);
    const thicknessMm = Number(part.thicknessMm);
    const quantity = Number(part.quantity);
    if (!type || !name || ![lengthMm, widthMm, thicknessMm].every((value) => Number.isFinite(value) && value > 0 && value <= 10000) ||
      !Number.isInteger(quantity) || quantity < 1 || quantity > 200) {
      return reply(502, { error: "La propuesta contiene medidas o cantidades no válidas." });
    }
    parts.push({ name, type, lengthMm, widthMm, thicknessMm, quantity });
  }

  const assumptions = Array.isArray(proposal.assumptions)
    ? proposal.assumptions.filter((item): item is string => typeof item === "string").slice(0, 20)
    : [];
  const output = {
    provider,
    furnitureType: detectedFurnitureType,
    summary: typeof proposal.summary === "string" ? proposal.summary.slice(0, 500) : "Propuesta generada desde la fotografía.",
    suggestedDimensions,
    dimensionConfidence,
    assumptions,
    parts,
  };
  const { error: saveError } = await supabase.from("photo_analyses").insert({
    user_id: authData.user.id,
    furniture_type: detectedFurnitureType,
    dimensions: suggestedDimensions,
    proposal: output,
  });
  if (saveError) return reply(500, { error: "No se pudo guardar el análisis en tu cuenta." });
  return reply(200, output);
});