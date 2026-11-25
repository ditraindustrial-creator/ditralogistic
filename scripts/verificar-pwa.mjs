// Comprueba que la PWA es instalable: construye, sirve con `vite preview` y revisa con Chromium
// (Playwright) el manifest, los íconos (existen y miden lo que dicen) y el service worker.
// Uso:  npm run verificar-pwa   (o: node scripts/verificar-pwa.mjs [--sin-build])
// Requiere `npm install` y, una vez, `npx playwright install chromium`.
// No forma parte de `npm test`. No toca Internet ni Supabase.
import { spawn, execSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { abrirNavegador } from './navegador.mjs'
const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
const PUERTO = 4173
const BASE = `http://localhost:${PUERTO}`

const fallos = []
const ok = (c, m) => {
  console.log(`${c ? 'OK   ' : 'FALLA'} ${m}`)
  if (!c) fallos.push(m)
}

if (!process.argv.includes('--sin-build')) {
  // Se compila sin variables de Supabase: la app muestra su aviso de configuración, suficiente para esta revisión.
  execSync('npm run build', { cwd: raiz, stdio: 'ignore' })
}
const servidor = spawn('npx', ['vite', 'preview', '--port', String(PUERTO), '--strictPort'], { cwd: raiz, stdio: 'ignore' })
const navegador = await abrirNavegador()
try {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(BASE)).ok) break
    } catch {}
    await new Promise((r) => setTimeout(r, 200))
  }
  const pagina = await navegador.newPage()
  await pagina.goto(BASE)

  const href = await pagina.getAttribute('link[rel="manifest"]', 'href')
  ok(!!href, `index.html enlaza el manifest (${href})`)
  const manifest = await (await fetch(new URL(href, BASE))).json()
  ok(manifest.name && manifest.short_name, `nombre: "${manifest.name}" / corto: "${manifest.short_name}"`)
  ok(manifest.lang === 'es-CL', `lang = ${manifest.lang}`)
  ok(manifest.display === 'standalone', `display = ${manifest.display}`)
  ok(manifest.start_url && manifest.scope, `start_url = ${manifest.start_url}, scope = ${manifest.scope}`)
  ok(/^#[0-9a-f]{6}$/i.test(manifest.theme_color) && /^#[0-9a-f]{6}$/i.test(manifest.background_color), `colores ${manifest.theme_color} / ${manifest.background_color}`)

  const tienePng = (tam, proposito) =>
    manifest.icons.some((i) => i.type === 'image/png' && i.sizes === tam && (i.purpose ?? 'any').split(' ').includes(proposito))
  ok(tienePng('192x192', 'any'), 'manifest declara ícono 192 (any)')
  ok(tienePng('512x512', 'any'), 'manifest declara ícono 512 (any)')
  ok(tienePng('512x512', 'maskable'), 'manifest declara ícono 512 (maskable)')

  const apple = await pagina.getAttribute('link[rel="apple-touch-icon"]', 'href')
  const aVerificar = manifest.icons.filter((i) => i.type === 'image/png').map((i) => ({ url: i.src, tam: i.sizes }))
  if (apple) aVerificar.push({ url: apple, tam: '180x180' })
  ok(!!apple, `index.html declara apple-touch-icon (${apple})`)
  for (const { url, tam } of aVerificar) {
    const r = await fetch(new URL(url, BASE))
    const buf = Buffer.from(await r.arrayBuffer())
    const esPng = buf.subarray(1, 4).toString() === 'PNG'
    const [w, h] = [buf.readUInt32BE(16), buf.readUInt32BE(20)]
    ok(r.status === 200 && esPng && `${w}x${h}` === tam, `${url}: HTTP ${r.status}, PNG ${w}x${h} (esperado ${tam})`)
  }

  const sw = await pagina.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return null
    const reg = await navigator.serviceWorker.register('/sw.js')
    await navigator.serviceWorker.ready
    return { activo: !!reg.active, scope: reg.scope }
  })
  ok(sw?.activo === true, `service worker registrado y activo (scope ${sw?.scope})`)
} finally {
  await navegador.close()
  servidor.kill()
}
console.log(fallos.length ? `\n${fallos.length} fallas` : '\nPWA instalable: todas las comprobaciones pasaron')
process.exit(fallos.length ? 1 : 0)
