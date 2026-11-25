import { useEffect, useRef, useState } from 'react'
import type { Repo } from '../../data/repo'
import { ErrorCliente, TEXTO_CLIENTE_MAXIMO, validarClienteNuevo } from '../../dominio/maestros'
import type { Cliente } from '../../dominio/tipos'

const ERROR_GENERICO = 'No se pudo guardar el cliente. Revisa tu conexión e inténtalo de nuevo.'

const campo = 'min-h-12 w-full rounded border bg-white p-3 text-lg font-normal'
const botonGrande = 'min-h-14 rounded bg-teal-700 px-5 py-3 text-xl font-semibold text-white disabled:opacity-50'
const botonClaro = 'min-h-14 rounded border-2 border-slate-300 bg-white px-5 py-3 text-lg font-semibold'

/** Si lo buscado parece un RUT (solo dígitos, puntos, guion y K) va al RUT; si no, al nombre. */
function separarBusqueda(texto: string): { nombre: string; rut: string } {
  const t = texto.trim()
  return /^[0-9.\-\s]+[0-9kK]?$/.test(t) && /\d/.test(t) ? { nombre: '', rut: t } : { nombre: t, rut: '' }
}

/**
 * Formulario "Cliente nuevo" dentro de Recepción (gestión y chofer). Valida en el dominio (mismas
 * reglas de RUT que el importador, RUT repetido) y, al guardar, entrega el cliente creado.
 */
export default function ClienteNuevo({
  repo, clientes, busqueda = '', alCrear, alCancelar,
}: {
  repo: Repo
  /** Clientes ya cargados: para avisar del RUT repetido sin ir a la base. */
  clientes: Cliente[]
  /** Lo que se había escrito en el buscador: se usa para prellenar nombre o RUT. */
  busqueda?: string
  alCrear: (c: Cliente) => void
  alCancelar: () => void
}) {
  const inicial = separarBusqueda(busqueda)
  const [nombre, setNombre] = useState(inicial.nombre)
  const [rut, setRut] = useState(inicial.rut)
  const [contacto, setContacto] = useState('')
  const [direccion, setDireccion] = useState('')
  const [errores, setErrores] = useState<string[]>([])
  const [guardando, setGuardando] = useState(false)
  const enCurso = useRef(false)
  const primerCampo = useRef<HTMLInputElement>(null)

  useEffect(() => {
    primerCampo.current?.focus()
  }, [])

  async function guardar() {
    if (enCurso.current) return
    const datos = { nombre, rut, contacto, direccion }
    const { errores: invalidos } = validarClienteNuevo(datos, clientes)
    if (invalidos.length > 0) {
      setErrores(invalidos)
      return
    }
    setErrores([])
    enCurso.current = true
    setGuardando(true)
    try {
      const creado = await repo.crearCliente(datos)
      enCurso.current = false
      alCrear(creado)
    } catch (e) {
      // Solo se muestran tal cual los errores de regla (ya en español); lo demás es técnico.
      setErrores([e instanceof ErrorCliente ? e.message : ERROR_GENERICO])
      enCurso.current = false
      setGuardando(false)
    }
  }

  return (
    <form
      aria-label="Cliente nuevo"
      className="flex flex-col gap-3 rounded border-2 border-teal-700 p-3"
      onSubmit={(e) => {
        e.preventDefault()
        void guardar()
      }}
    >
      <h2 className="text-xl font-bold">Cliente nuevo</h2>
      <label className="flex flex-col gap-1 text-lg font-semibold">
        Nombre
        <input ref={primerCampo} className={campo} maxLength={TEXTO_CLIENTE_MAXIMO} value={nombre} onChange={(e) => setNombre(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-lg font-semibold">
        RUT
        <input className={campo} inputMode="text" autoComplete="off" placeholder="12.345.678-5" value={rut} onChange={(e) => setRut(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-lg">
        Contacto (opcional)
        <input className={campo} maxLength={TEXTO_CLIENTE_MAXIMO} value={contacto} onChange={(e) => setContacto(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-lg">
        Dirección (opcional)
        <input className={campo} maxLength={TEXTO_CLIENTE_MAXIMO} value={direccion} onChange={(e) => setDireccion(e.target.value)} />
      </label>
      {/* Un cliente puede estar en varios recorridos; eso lo asigna gestión en Administración. */}
      <p className="text-slate-600">Los recorridos del cliente (qué días se le visita) se asignan en Administración.</p>
      {errores.length > 0 && (
        <div role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-red-800">
          <ul className="list-disc pl-5">
            {errores.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={`${botonGrande} flex-1`} disabled={guardando}>
          {guardando ? 'Guardando…' : 'Guardar cliente'}
        </button>
        <button type="button" className={botonClaro} onClick={alCancelar}>Cancelar</button>
      </div>
    </form>
  )
}
