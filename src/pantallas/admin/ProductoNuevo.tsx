import { useRef, useState } from 'react'
import type { Repo } from '../../data/repo'
import { validarProductoNuevo } from '../../dominio/maestros'
import type { Area, Producto, TipoProducto } from '../../dominio/tipos'
import { COLOR_AREA } from '../colorArea'
import { mensaje } from './Importador'

const campo = 'min-h-12 w-full rounded border p-3 text-lg'
const botonGrande = 'min-h-14 rounded bg-teal-700 px-5 py-3 text-xl font-semibold text-white disabled:opacity-50'
const botonClaro = 'min-h-12 rounded border px-4 py-3 text-lg'

const AREAS: { id: Area; titulo: string }[] = [
  { id: 'afilado', titulo: 'Afilado' },
  { id: 'encuadernacion', titulo: 'Encuadernación' },
]
const TIPOS: { id: TipoProducto; titulo: string; ayuda: string }[] = [
  { id: 'herramienta', titulo: 'Herramienta', ayuda: 'Lo que el chofer retira' },
  { id: 'servicio', titulo: 'Servicio', ayuda: 'Lo que hace el taller' },
]

/** Botones grandes de una sola elección (radio nativo oculto). */
function Eleccion<T extends string>({
  nombre, titulo, opciones, valor, alCambiar, colorElegido,
}: {
  nombre: string
  titulo: string
  opciones: { id: T; titulo: string; ayuda?: string }[]
  valor: T
  alCambiar: (v: T) => void
  colorElegido?: (v: T) => string
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-lg font-semibold">{titulo}</legend>
      <div className="flex flex-wrap gap-2">
        {opciones.map((o) => (
          <label
            key={o.id}
            className={`flex min-h-12 flex-1 cursor-pointer flex-col items-center justify-center rounded border-2 px-3 py-2 text-center text-lg ${
              valor === o.id ? (colorElegido?.(o.id) ?? 'border-teal-700 bg-teal-700 text-white') : 'border-slate-300 bg-white'
            }`}
          >
            <input type="radio" name={nombre} className="sr-only" checked={valor === o.id} onChange={() => alCambiar(o.id)} />
            {o.titulo}
            {o.ayuda && <span className="text-sm opacity-80">{o.ayuda}</span>}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

/** Formulario simple para agregar un producto al catálogo, uno por uno. */
export default function ProductoNuevo({
  repo, productos, alGuardar, alCerrar,
}: {
  repo: Repo
  productos: Producto[]
  /** Después de guardar (para recargar la lista). */
  alGuardar: () => Promise<void>
  alCerrar: () => void
}) {
  const [codigo, setCodigo] = useState('')
  const [nombre, setNombre] = useState('')
  const [area, setArea] = useState<Area>('afilado')
  const [tipo, setTipo] = useState<TipoProducto>('herramienta')
  const [errores, setErrores] = useState<string[]>([])
  const [guardando, setGuardando] = useState(false)
  const [guardado, setGuardado] = useState('')
  const codigoRef = useRef<HTMLInputElement>(null)

  async function guardar() {
    if (guardando) return
    const p = { codigo: codigo.trim(), nombre: nombre.trim(), area, tipo }
    const invalidos = validarProductoNuevo(p, productos)
    if (invalidos.length > 0) {
      setErrores(invalidos)
      setGuardado('')
      return
    }
    setErrores([])
    setGuardando(true)
    try {
      await repo.guardarProductos([p])
      await alGuardar()
      setGuardado(`Producto «${p.nombre}» (${p.codigo}) agregado.`)
      // Listo para el siguiente: se mantienen el área y el tipo, que suelen repetirse.
      setCodigo('')
      setNombre('')
      codigoRef.current?.focus()
    } catch (e) {
      setErrores([mensaje(e, 'No se pudo guardar el producto. Revisa tu conexión e inténtalo de nuevo.')])
    } finally {
      setGuardando(false)
    }
  }

  return (
    <form
      aria-label="Nuevo producto"
      className="flex flex-col gap-4 rounded border-2 border-teal-700 p-4"
      onSubmit={(e) => {
        e.preventDefault()
        void guardar()
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xl font-bold">Nuevo producto</h2>
        <button type="button" className={botonClaro} onClick={alCerrar}>Cerrar</button>
      </div>
      <label className="flex flex-col gap-1 text-lg font-semibold">
        Código
        <input ref={codigoRef} autoFocus autoComplete="off" className={`${campo} font-normal`} value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="Ej. CUCH-20" />
      </label>
      <label className="flex flex-col gap-1 text-lg font-semibold">
        Nombre
        <input autoComplete="off" className={`${campo} font-normal`} value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. Cuchillo 20 cm" />
      </label>
      <Eleccion nombre="area-producto" titulo="Área" opciones={AREAS} valor={area} alCambiar={setArea} colorElegido={(a) => COLOR_AREA[a].elegido} />
      <Eleccion nombre="tipo-producto" titulo="Tipo" opciones={TIPOS} valor={tipo} alCambiar={setTipo} />
      {errores.length > 0 && (
        <div role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-red-800">
          <ul className="list-disc pl-5">
            {errores.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      )}
      {guardado && <p role="status" className="text-lg font-semibold text-teal-800">{guardado}</p>}
      <button type="submit" className={botonGrande} disabled={guardando}>
        {guardando ? 'Guardando…' : 'Guardar producto'}
      </button>
    </form>
  )
}
