// Genera los íconos PNG de la app a partir de public/icono.svg, usando el Chromium que trae Playwright.
// Uso:  node scripts/generar-iconos.mjs
// Equivale a `npm run iconos`. Requiere `npm install` y, una vez, `npx playwright install chromium`.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { abrirNavegador } from './navegador.mjs'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
const svg = readFileSync(join(raiz, 'public/icono.svg'), 'utf8')
const COLOR = '#0f766e'
// Marca (la palomita) del ícono original, sin el fondo redondeado.
const marca = svg.match(/<path[^>]*\/>/)[0]

// "any": el ícono tal cual (esquinas redondeadas, transparente fuera).
const conFondoRedondeado = (px) => `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 64 64">${svg.replace(/^<svg[^>]*>|<\/svg>$/g, '')}</svg>`
// Cuadrado completo, sin transparencia. `escala` achica la marca para dejar margen seguro.
const cuadrado = (px, escala) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 64 64"><rect width="64" height="64" fill="${COLOR}"/><g transform="translate(32 32) scale(${escala}) translate(-32 -32)">${marca}</g></svg>`

const iconos = [
  ['icono-192.png', 192, conFondoRedondeado(192)],
  ['icono-512.png', 512, conFondoRedondeado(512)],
  // maskable: la zona segura es el círculo central del 80 %; la marca va al 62 %.
  ['icono-maskable-512.png', 512, cuadrado(512, 0.62)],
  // iOS pone sus propias esquinas: debe ser opaco.
  ['apple-touch-icon.png', 180, cuadrado(180, 0.8)],
]

const navegador = await abrirNavegador()
try {
  for (const [archivo, px, contenido] of iconos) {
    const pagina = await navegador.newPage({ viewport: { width: px, height: px } })
    await pagina.setContent(`<body style="margin:0;background:transparent">${contenido}</body>`)
    const png = await pagina.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: px, height: px } })
    writeFileSync(join(raiz, 'public', archivo), png)
    console.log(`public/${archivo} (${px}x${px})`)
    await pagina.close()
  }
} finally {
  await navegador.close()
}
