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
  type: "OBJECT",
  required: ["summary", "assumptions", "parts"],
  properties: {
    summary: { type: "STRING" },
    assumptions: { type: "ARRAY", items: { type: "STRING" } },
    parts: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        required: ["name", "type", "lengthMm", "widthMm", "thicknessMm", "quantity"],
        properties: {
          name: { type: "STRING" },
          type: { type: "STRING", enum: ["T", "L"] },
          lengthMm: { type: "NUMBER" },
          widthMm: { type: "NUMBER" },
          thicknessMm: { type: "NUMBER" },
          quantity: { type: "INTEGER" },
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
    dimensions?: { width?: number; height?: number; depth?: number };
    furnitureType?: string;
  };
  try {
    body = await request.json();
  } catch {
    return reply(400, { error: "El cuerpo de la solicitud no es JSON válido." });
  }

  const image = body.image;
  const dimensions = body.dimensions;
  const supportedTypes = ["image/jpeg", "image/png", "image/webp"];
  if (!image || !supportedTypes.includes(image.mimeType || "") || !image.base64 || image.base64.length > 5_600_000) {
    return reply(400, { error: "La imagen debe ser JPG, PNG o WebP y pesar 4 MB o menos." });
  }
  if (!dimensions || ![dimensions.width, dimensions.height, dimensions.depth].every((value) =>
    Number.isFinite(value) && Number(value) > 0 && Number(value) <= 10000
  )) {
    return reply(400, { error: "Indica ancho, alto y fondo válidos en milímetros." });
  }

  const furnitureType = (body.furnitureType || "other").slice(0, 60);
  const prompt = `Analiza la estructura visible del mueble de la fotografía. El usuario ha indicado el tipo «${furnitureType}» y estas dimensiones exteriores exactas en milímetros: ancho ${dimensions.width}, alto ${dimensions.height}, fondo ${dimensions.depth}.

No calcules la escala a partir de píxeles ni cambies las dimensiones exteriores dadas. Identifica las piezas estructurales necesarias y propone sus medidas para que correspondan a ese volumen exterior. Usa «T» para piezas de tablero y «L» para listones o piezas de madera maciza. No infieras especie ni acabado del material. Si hay un módulo de cocina, interpreta las medidas como las de ese módulo, no de toda la cocina. Incluye en assumptions las uniones, traseras o detalles que no se puedan confirmar en la imagen. Devuelve solo JSON con summary, assumptions y parts. Cada parte debe incluir name, type («T» o «L»), lengthMm, widthMm, thicknessMm y quantity. Las medidas son una propuesta que el usuario revisará; no afirmes que garantizan resistencia o seguridad.`;

  const model = Deno.env.get("GEMINI_MODEL") || "gemini-2.5-flash";
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  let modelResponse: Response;
  try {
    modelResponse = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: image.mimeType, data: image.base64 } },
          ],
        }],
        generationConfig: { responseMimeType: "application/json", responseSchema },
      }),
    });
  } catch {
    return reply(502, { error: "No se pudo contactar con el servicio de visión." });
  }
  if (!modelResponse.ok) return reply(502, { error: "El servicio de visión rechazó la solicitud." });

  let result: { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  try {
    result = await modelResponse.json();
  } catch {
    return reply(502, { error: "El servicio de visión devolvió una respuesta inválida." });
  }
  const text = result.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim();
  if (!text) return reply(502, { error: "El servicio de visión no devolvió una propuesta." });

  let proposal: { summary?: string; assumptions?: unknown[]; parts?: Array<Record<string, unknown>> };
  try {
    proposal = JSON.parse(text);
  } catch {
    return reply(502, { error: "No se pudo interpretar la propuesta del servicio de visión." });
  }
  if (!Array.isArray(proposal.parts) || proposal.parts.length < 1 || proposal.parts.length > 100) {
    return reply(502, { error: "La propuesta no contiene una lista de piezas válida." });
  }

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
    summary: typeof proposal.summary === "string" ? proposal.summary.slice(0, 500) : "Propuesta generada desde la fotografía.",
    assumptions,
    parts,
  };
  const { error: saveError } = await supabase.from("photo_analyses").insert({
    user_id: authData.user.id,
    furniture_type: furnitureType,
    dimensions,
    proposal: output,
  });
  if (saveError) return reply(500, { error: "No se pudo guardar el análisis en tu cuenta." });
  return reply(200, output);
});