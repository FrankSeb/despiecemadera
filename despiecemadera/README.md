# Despiece de madera

App web para optimizar cortes de tableros y obtener el despiece (lista de piezas y áreas) de un proyecto de carpintería. Funciona 100 % en el navegador, sin servidor.

## Cómo publicarla

1. Sube estos archivos a la rama `main` de tu repositorio (`index.html`, `README.md` y la carpeta `.github/workflows`).
2. En GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Cada `push` a `main` ejecuta el workflow y publica la app en
   `https://FrankSeb.github.io/despiecemadera/`

## Uso

- Define el tablero (largo, ancho) y el grosor del corte de sierra.
- Agrega las piezas con largo, ancho y cantidad.
- La app calcula cuántos tableros necesitas, dibuja el plano de corte de cada uno y muestra el despiece.
- Marca «Permitir girar piezas» solo si el material no tiene veta.
- Exporta el despiece a CSV o imprime los planos.

Medidas en milímetros. Los datos se guardan en el navegador (localStorage).
