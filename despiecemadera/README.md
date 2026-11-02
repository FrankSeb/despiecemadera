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

La pestaña **Desde foto** requiere configurar un proyecto Supabase. La persona proporciona ancho, alto y fondo exteriores; la IA interpreta la estructura de la fotografía y devuelve una propuesta editable. No se estima la escala desde píxeles. La imagen se envía al proveedor configurado solo tras aceptar la casilla de consentimiento.

1. Crea un proyecto en [Supabase](https://supabase.com/dashboard).
2. En **Authentication → URL Configuration**, configura como Site URL `https://frankseb.github.io/despiecemadera/` y añade esa misma URL a los Redirect URLs.
3. La configuración que ya está en `supabase-config.js` se publica directamente. Opcionalmente, en GitHub abre **Settings → Secrets and variables → Actions → Variables** y crea `SUPABASE_URL` y `SUPABASE_ANON_KEY` con **Project URL** y **Publishable key**; si existen ambas, el workflow las usa para generar la configuración. La clave publishable es pública; nunca uses `service_role` aquí.
4. Desde PowerShell, entra en la carpeta `despiecemadera`, vincula el proyecto y publica las migraciones y la función:

   ```powershell
   supabase login
   supabase link --project-ref TU_PROJECT_REF
   supabase db push
   supabase secrets set GEMINI_API_KEY=TU_CLAVE
   supabase functions deploy analyze-furniture
   ```

`db push` aplica las migraciones de perfiles, catálogo compartido y espacio de trabajo privado por usuario. En **Authentication → Providers**, habilita Email. La Edge Function exige sesión; la clave de Gemini se mantiene como secreto en Supabase. Los planes gratuitos y límites de Supabase/Gemini pueden cambiar; consulta sus precios antes de usarlo con volumen.

## Añadir un modelo nuevo

En `index.html`, dentro del objeto `TPL`, agrega una plantilla con sus parámetros (`f`) y una función `build` que devuelva cajas con `bx(nombre, x, y, z, dx, dy, dz, tipo)`. Los planos y el despiece se generan a partir de esas cajas.
