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
  if (!supabaseUrl || !anonKey || !apiKey) return reply(503, { error: "Falta configurar el servicio de análisis." });

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
  let modelResponse: Response;
  try {
    modelResponse = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
        "Api-Revision": "2026-05-20",
      },
      body: JSON.stringify({
        model,
        input: [
          { type: "text", text: prompt },
          { type: "image", data: image.base64, mime_type: image.mimeType },
        ],
        response_format: { type: "text", mime_type: "application/json", schema: responseSchema },
        generation_config: { thinking_level: "minimal" },
        store: false,
      }),
    });
  } catch {
    return reply(502, { error: "No se pudo contactar con el servicio de visión." });
  }
  if (!modelResponse.ok) {
    let providerMessage = "El proveedor de visión rechazó la solicitud.";
    try {
      const providerBody = await modelResponse.json();
      const message = providerBody?.error?.message;
      if (typeof message === "string") providerMessage = message.replace(/\s+/g, " ").slice(0, 350);
    } catch {
      providerMessage = `El proveedor de visión respondió HTTP ${modelResponse.status}.`;
    }
    return reply(502, {
      error: `Gemini respondió HTTP ${modelResponse.status}: ${providerMessage}`,
      providerStatus: modelResponse.status,
    });
  }

  let result: { output_text?: string };
  try {
    result = await modelResponse.json();
  } catch {
    return reply(502, { error: "El servicio de visión devolvió una respuesta inválida." });
  }
  const text = result.output_text?.trim();
  if (!text) return reply(502, { error: "El servicio de visión no devolvió una propuesta." });

  let proposal: {
    furnitureType?: string;
    summary?: string;
    assumptions?: unknown[];
    suggestedDimensions?: Record<string, unknown>;
    dimensionConfidence?: number;
    parts?: Array<Record<string, unknown>>;
  };
  try {
    proposal = JSON.parse(text);
  } catch {
    return reply(502, { error: "No se pudo interpretar la propuesta del servicio de visión." });
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