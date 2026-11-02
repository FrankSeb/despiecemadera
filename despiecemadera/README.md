# Despiece de madera

App web para diseñar un mueble en 2D, obtener su despiece y calcular los cortes de tableros y listones. Funciona 100 % en el navegador, sin servidor.

## Cómo publicarla

1. Sube estos archivos a la rama `main` de tu repositorio (`index.html`, `README.md` y la carpeta `.github/workflows`).
2. En GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Cada `push` a `main` ejecuta el workflow y publica la app en
   `https://FrankSeb.github.io/despiecemadera/`

## Qué hace

**Modelo 2D**
- Plantillas paramétricas: mueble con estantes y puertas, mesa con patas y travesaños, escritorio con laterales.
- Cambia las medidas y se redibujan la vista frontal, lateral y la planta, con cotas generales.
- Genera el despiece (pieza, tipo, medidas, espesor, cantidad) y lo puede enviar a «Piezas y cortes».

**Piezas y cortes**
- Edita la lista de piezas a mano o usa la del modelo. Cada pieza es de tipo *Tablero* o *Listón*.
- Tableros: optimización 2D (MaxRects), agrupada por espesor, con plano de corte por tablero.
- Listones: optimización 1D (mejor ajuste), agrupada por sección, con plano de corte por listón.
- Respeta la veta por defecto; marca «Permitir girar piezas» solo si el material no la tiene.
- Exporta el despiece a CSV o imprime los planos.

Medidas en milímetros. Los datos se guardan en el navegador (localStorage).

## Añadir un modelo nuevo

En `index.html`, dentro del objeto `TPL`, agrega una plantilla con sus parámetros (`f`) y una función `build` que devuelva cajas con `bx(nombre, x, y, z, dx, dy, dz, tipo)`. Los planos y el despiece se generan solos a partir de esas cajas.
