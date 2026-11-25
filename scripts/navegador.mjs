// Ayuda compartida por generar-iconos.mjs y verificar-pwa.mjs: abre Chromium con Playwright
// y, si falta Playwright o su navegador, termina con un mensaje claro en español.
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

export async function abrirNavegador() {
  let chromium
  try {
    ;({ chromium } = require('playwright'))
  } catch {
    console.error('Falta Playwright. Ejecuta "npm install" en la carpeta del proyecto y vuelve a intentar.')
    process.exit(2)
  }
  try {
    // PLAYWRIGHT_CHROMIUM_PATH: ruta a un Chromium ya instalado (opcional).
    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined
    return await chromium.launch({ executablePath })
  } catch (e) {
    console.error('No se pudo abrir el navegador de Playwright.')
    console.error('Instálalo una vez con:  npx playwright install chromium')
    console.error('o indica un Chromium existente con la variable PLAYWRIGHT_CHROMIUM_PATH=/ruta/a/chromium')
    console.error(String(e.message).split('\n')[0])
    process.exit(2)
  }
}
