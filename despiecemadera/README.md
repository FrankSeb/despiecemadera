# Despiece de madera

App web para diseñar un mueble en 2D, obtener su despiece y calcular los cortes de tableros y listones. `index.html` es el inicio y gestión de cuenta; `app.html` es el taller privado. Los cálculos locales funcionan en el navegador y las cuentas sincronizan su espacio de trabajo en Supabase.

## Cómo publicarla

1. El workflow está en la raíz del repositorio y publica esta carpeta de la app.
2. En GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Cada `push` a `main` ejecuta el workflow y publica la app en `https://FrankSeb.github.io/despiecemadera/`.

## Qué hace

**Modelo 2D**
- Plantillas paramétricas: mueble con estantes y puertas, mesa con patas y travesaños, escritorio con laterales.
- Catálogo de melamina, aglomerado, MDF/HDF, contrachapado, OSB y madera; permite elegir espesores estándar o personalizados por grupo.
- Cambia las medidas y se redibujan la vista frontal, lateral y la planta, con cotas generales.
- Genera el despiece (pieza, tipo, medidas, espesor, cantidad) y lo puede enviar a «Piezas y cortes».

**Piezas y cortes**
- Edita la lista de piezas a mano o usa la del modelo. Cada pieza es de tipo *Tablero* o *Listón*.
- Tableros: optimización 2D (MaxRects), agrupada por material y espesor, con plano de corte por tablero.
- Listones: optimización 1D (mejor ajuste), agrupada por material y sección, con plano de corte por listón.
- Respeta la veta por defecto; marca «Permitir girar piezas» solo si el material no la tiene.
- Exporta el despiece a CSV o imprime los planos.

Medidas en milímetros. Las cuentas guardan su espacio de trabajo en Supabase y en almacenamiento local separado por usuario. La demostración sin backend usa almacenamiento temporal de la pestaña.

## Análisis desde foto

La pestaña **Desde foto** identifica el tipo de mueble y propone la estructura y dimensiones exteriores con Gemini 3.8 Flash (Interactions API). Las medidas que escriba la persona se respetan; las que deje vacías se estiman con una confianza orientativa y se pueden corregir antes de generar los cortes. La IA no obtiene una escala fiable de los píxeles. La imagen solo se envía tras aceptar el consentimiento, y la solicitud se envía con `store: false` para no conservar la interacción en Google.

1. Crea un proyecto en [Supabase](https://supabase.com/dashboard).
2. En **Authentication → URL Configuration**, configura como Site URL `https://frankseb.github.io/despiecemadera/` y añade esa misma URL a los Redirect URLs.
3. La configuración que ya está en `supabase-config.js` se publica directamente. Opcionalmente, en GitHub abre **Settings → Secrets and variables → Actions → Variables** y crea `SUPABASE_URL` y `SUPABASE_ANON_KEY` con **Project URL** y **Publishable key**; si existen ambas, el workflow las usa para generar la configuración. La clave publishable es pública; nunca uses `service_role` aquí.
4. En **Settings → Secrets and variables → Actions**, agrega:

   - Variable `SUPABASE_PROJECT_REF`: el identificador que aparece al inicio de la Project URL.
   - Secret `SUPABASE_ACCESS_TOKEN`: un access token de tu cuenta Supabase.

5. Si quieres el respaldo de Cloudflare, guarda `CLOUDFLARE_ACCOUNT_ID` y `CLOUDFLARE_API_TOKEN` en **Supabase → Edge Functions → Secrets**. El token necesita permisos **Workers AI Read** y **Workers AI Edit**. Se usa `@cf/meta/llama-3.2-11b-vision-instruct`, que exige que quien lo use no esté domiciliado en la UE. Cloudflare declara cero retención para el modelo y una cuota gratuita diaria de Workers AI; revisa los límites vigentes.

6. Acepta una vez la licencia de Llama desde PowerShell, usando tu Account ID y token de Cloudflare (no los compartas):

   ```powershell
   $accountId = "TU_CLOUDFLARE_ACCOUNT_ID"
   $token = "TU_CLOUDFLARE_API_TOKEN"
   $headers = @{ Authorization = "Bearer $token" }
   $body = @{ prompt = "agree" } | ConvertTo-Json
   Invoke-RestMethod -Method Post -Uri "https://api.cloudflare.com/client/v4/accounts/$accountId/ai/run/@cf/meta/llama-3.2-11b-vision-instruct" -Headers $headers -ContentType "application/json" -Body $body
   ```

7. Aplica una vez las migraciones de la base de datos desde PowerShell, dentro de la carpeta `despiecemadera`:

   ```powershell
   supabase login
   supabase link --project-ref TU_PROJECT_REF
   supabase db push
   supabase secrets set GEMINI_API_KEY=TU_CLAVE --project-ref TU_PROJECT_REF
   ```

Al subir cambios de `supabase/` a `main`, `.github/workflows/deploy-supabase-function.yml` despliega la Edge Function. La clave de Gemini y las credenciales de Cloudflare se guardan en Supabase, no en GitHub. Cloudflare solo se usa como respaldo si Gemini está temporalmente saturado (429/503) o no se puede contactar. Debes habilitar Email en **Authentication → Providers**. El gateway permite el preflight CORS; la propia función valida la sesión del usuario. No guardes `service_role`, la cadena de conexión ni claves privadas en el frontend. Los planes y cuotas pueden cambiar.

## Añadir un modelo nuevo

En `index.html`, dentro del objeto `TPL`, agrega una plantilla con sus parámetros (`f`) y una función `build` que devuelva cajas con `bx(nombre, x, y, z, dx, dy, dz, tipo)`. Los planos y el despiece se generan a partir de esas cajas.
