import { useEffect, useRef, useState } from 'react'
import type { Repo } from '../../data/repo'
import { nuevaClave } from '../../dominio/clave'
import { puedeCrearClientes } from '../../dominio/permisos'
import type { Area, Cliente, Linea, Modalidad, Producto, Trabajo, UsuarioActual } from '../../dominio/tipos'
import {
  codigoTrabajo,
  ErrorTrabajo,
  filtrarClientes,
  parsearCantidad,
  validarEdicionTrabajo,
  validarTrabajoNuevo,
  type DatosEdicionTrabajo,
  type DatosTrabajoNuevo,
} from '../../dominio/trabajo'
import ClienteNuevo from './ClienteNuevo'
import { COLOR_AREA } from '../colorArea'

const AREAS: { id: Area; titulo: string }[] = [
  { id: 'afilado', titulo: 'Afilado' },
  { id: 'encuadernacion', titulo: 'Encuadernación' },
]
const MODALIDADES: { id: Modalidad; titulo: string }[] = [
  { id: 'cliente', titulo: 'Lo trajo el cliente' },
  { id: 'encomienda', titulo: 'Encomienda' },
  { id: 'ruta_propia', titulo: 'Ruta propia (retiro)' },
]
const ERROR_GENERICO = 'No se pudo guardar el trabajo. Revisa tu conexión e inténtalo de nuevo.'

const campo = 'min-h-12 w-full rounded border p-3 text-lg'
const campoLinea = 'min-h-12 min-w-0 rounded border p-3 text-lg'
const botonGrande = 'min-h-14 rounded bg-teal-700 px-5 py-3 text-xl font-semibold text-white disabled:opacity-50'
const botonClaro = 'min-h-12 rounded border px-4 py-3 text-lg'

interface LineaForm {
  clave: number
  /** Línea ya guardada (al editar un trabajo); sin id es una línea nueva. */
  id?: string
  producto: string
  cantidad: string
  /** Detalle de lo que es (se guarda en la nota de la línea), p. ej. «COMPOSICION SEK, Ø14 blanco». */
  detalle: string
}

/** Largo máximo del detalle de una línea. */
const DETALLE_MAXIMO = 200

/** Opciones tipo botón grande (un radio nativo por opción: se maneja bien con el dedo y con lector de pantalla). */
function Opciones<T extends string>({
  nombre, titulo, opciones, valor, alCambiar, colorElegido,
}: {
  nombre: string
  titulo: string
  opciones: { id: T; titulo: string }[]
  valor: T
  alCambiar: (v: T) => void
  /** Clases del botón elegido según la opción (por defecto, verde azulado). */
  colorElegido?: (v: T) => string
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-lg font-semibold">{titulo}</legend>
      <div className="flex flex-wrap gap-2">
        {opciones.map((o) => (
          <label
            key={o.id}
            className={`flex min-h-12 flex-1 cursor-pointer items-center justify-center rounded border-2 px-3 py-2 text-center text-lg ${
              valor === o.id ? (colorElegido?.(o.id) ?? 'border-teal-700 bg-teal-700 text-white') : 'border-slate-300 bg-white'
            }`}
          >
            <input type="radio" name={nombre} className="sr-only" checked={valor === o.id} onChange={() => alCambiar(o.id)} />
            {o.titulo}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

/** Trabajo que se edita mientras sigue en Recepción, con sus líneas y su cliente. */
export interface EdicionTrabajo {
  trabajo: Trabajo
  lineas: Linea[]
  cliente?: Cliente
}

export default function Recepcion({
  repo, usuario, clienteInicial, onCreado, edicion, onEditado, alCancelar,
}: {
  repo: Repo
  usuario: UsuarioActual
  /** Cliente ya elegido (p. ej. la parada de la hoja del chofer); trae la modalidad ruta propia. */
  clienteInicial?: Cliente
  /** Se llama una vez guardado el trabajo. */
  onCreado?: (trabajo: Trabajo) => void
  /** Con esto el formulario edita ese trabajo en vez de recibir uno nuevo (solo gestión). */
  edicion?: EdicionTrabajo
  /** Se llama al terminar de editar («Volver a la lista»). */
  onEditado?: (trabajo: Trabajo) => void
  /** Al editar: vuelve a la lista sin guardar. */
  alCancelar?: () => void
}) {
  const modalidadInicial: Modalidad = usuario.rol === 'chofer' || clienteInicial ? 'ruta_propia' : 'cliente'
  const siguienteClave = useRef(2)
  const enCurso = useRef(false)
  // Clave de idempotencia del formulario: se conserva mientras está abierto y tras un error (el
  // reintento la reusa: si la respuesta se perdió, la base devuelve el trabajo ya creado).
  const claveSolicitud = useRef(nuevaClave())
  const creaClientes = puedeCrearClientes(usuario.rol)

  // null mientras cargan.
  const [clientes, setClientes] = useState<Cliente[] | null>(null)
  const [creandoCliente, setCreandoCliente] = useState(false)
  const [productos, setProductos] = useState<Producto[]>([])
  const [errorCarga, setErrorCarga] = useState('')

  const t = edicion?.trabajo
  const [cliente, setCliente] = useState<Cliente | null>(edicion ? (edicion.cliente ?? null) : (clienteInicial ?? null))
  const [busqueda, setBusqueda] = useState('')
  const [area, setArea] = useState<Area>(t?.area ?? 'afilado')
  const [entrada, setEntrada] = useState<Modalidad>(t?.entrada ?? modalidadInicial)
  const [lineas, setLineas] = useState<LineaForm[]>(() =>
    edicion && edicion.lineas.length > 0
      ? edicion.lineas.map((l) => ({ clave: siguienteClave.current++, id: l.id, producto: l.producto, cantidad: String(l.cantidad), detalle: l.nota ?? '' }))
      : [{ clave: 1, producto: '', cantidad: '', detalle: '' }],
  )
  const [urgente, setUrgente] = useState(t?.urgente ?? false)
  const [guia, setGuia] = useState(t?.guiaRetiro ?? '')
  const [notas, setNotas] = useState(t?.notas ?? '')

  const [errores, setErrores] = useState<string[]>([])
  const [guardando, setGuardando] = useState(false)
  const [guardado, setGuardado] = useState<Trabajo | null>(null)

  useEffect(() => {
    let activo = true
    repo.listarClientes().then(
      (c) => activo && setClientes(c),
      () => activo && setErrorCarga('No se pudieron cargar los clientes. Revisa tu conexión.'),
    )
    // El catálogo solo sugiere: si no carga, se escribe el producto a mano.
    repo.listarProductos().then(
      (p) => activo && setProductos(p),
      () => undefined,
    )
    return () => {
      activo = false
    }
  }, [repo])

  function actualizarLinea(clave: number, cambios: Partial<LineaForm>) {
    setLineas((ls) => ls.map((l) => (l.clave === clave ? { ...l, ...cambios } : l)))
  }

  function limpiar() {
    claveSolicitud.current = nuevaClave()
    setCreandoCliente(false)
    setCliente(clienteInicial ?? null)
    setBusqueda('')
    setArea('afilado')
    setEntrada(modalidadInicial)
    setLineas([{ clave: siguienteClave.current++, producto: '', cantidad: '', detalle: '' }])
    setUrgente(false)
    setGuia('')
    setNotas('')
    setErrores([])
    setGuardado(null)
  }

  async function guardarEdicion(trabajo: Trabajo) {
    const datos: DatosEdicionTrabajo = {
      clienteId: cliente?.id ?? '',
      urgente,
      guiaRetiro: guia.trim() || undefined,
      notas: notas.trim() || undefined,
      lineas: lineas.map((l) => {
        const detalle = l.detalle.trim()
        return { ...(l.id ? { id: l.id } : {}), producto: l.producto, cantidad: parsearCantidad(l.cantidad), ...(detalle ? { nota: detalle } : {}) }
      }),
    }
    const invalidos = validarEdicionTrabajo(datos)
    if (invalidos.length > 0) {
      setErrores(invalidos)
      return
    }
    setErrores([])
    enCurso.current = true
    setGuardando(true)
    try {
      setGuardado(await repo.editarTrabajo(trabajo.id, datos))
    } catch (e) {
      setErrores([e instanceof ErrorTrabajo ? e.message : ERROR_GENERICO])
    } finally {
      enCurso.current = false
      setGuardando(false)
    }
  }

  async function guardar() {
    if (enCurso.current) return
    if (edicion) return guardarEdicion(edicion.trabajo)
    const datos: DatosTrabajoNuevo = {
      clienteId: cliente?.id ?? '',
      area,
      entrada,
      lineas: lineas.map((l) => {
        const detalle = l.detalle.trim()
        return { producto: l.producto, cantidad: parsearCantidad(l.cantidad), ...(detalle ? { nota: detalle } : {}) }
      }),
    }
    if (urgente) datos.urgente = true
    if (guia.trim()) datos.guiaRetiro = guia.trim()
    if (notas.trim()) datos.notas = notas.trim()
    const invalidos = validarTrabajoNuevo(datos)
    if (invalidos.length > 0) {
      setErrores(invalidos)
      return
    }
    setErrores([])
    enCurso.current = true
    setGuardando(true)
    try {
      const creado = await repo.crearTrabajo(datos, claveSolicitud.current)
      setGuardado(creado)
      onCreado?.(creado)
    } catch (e) {
      // Solo se muestran tal cual los errores de regla (ya en español); lo demás es técnico.
      setErrores([e instanceof ErrorTrabajo ? e.message : ERROR_GENERICO])
    } finally {
      enCurso.current = false
      setGuardando(false)
    }
  }

  if (guardado && edicion) {
    return (
      <div className="flex flex-col gap-4" role="status">
        <p className="text-2xl font-bold text-teal-800">Trabajo {codigoTrabajo(guardado)} actualizado</p>
        <p className="text-lg">{cliente?.nombre}</p>
        <button type="button" className={botonGrande} onClick={() => onEditado?.(guardado)}>Volver a la lista</button>
      </div>
    )
  }

  if (guardado) {
    return (
      <div className="flex flex-col gap-4" role="status">
        <p className="text-2xl font-bold text-teal-800">Trabajo {codigoTrabajo(guardado)} guardado</p>
        <p className="text-lg">{cliente?.nombre}</p>
        <button type="button" className={botonGrande} onClick={limpiar}>Recibir otro trabajo</button>
      </div>
    )
  }

  const lista = clientes ?? []
  const sugeridos = cliente ? [] : filtrarClientes(lista, busqueda)
  // Afilado: al retirar solo se anota la herramienta (tipo y tamaño); el servicio lo define el taller.
  // Encuadernación: se sugieren los trabajos de encuadernación del catálogo.
  const sugerenciasProductos = productos.filter((p) => p.area === area && (area !== 'afilado' || p.tipo === 'herramienta'))
  const sinClientes = clientes !== null && clientes.length === 0 && !errorCarga

  return (
    <div className="flex flex-col gap-5">
      {edicion && (
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xl font-bold">Editando trabajo {codigoTrabajo(edicion.trabajo)}</h2>
          <button type="button" className={botonClaro} onClick={alCancelar}>Cancelar</button>
        </div>
      )}
      {errorCarga && <p role="alert" className="text-red-700">{errorCarga}</p>}

      {cliente ? (
        <div className="flex items-center justify-between gap-2 rounded border-2 border-teal-700 p-3">
          <div>
            <p className="text-sm text-slate-600">Cliente</p>
            <p className="text-lg font-semibold">{cliente.nombre}</p>
            <p className="text-sm text-slate-600">{cliente.rut}</p>
          </div>
          <button type="button" className={botonClaro} onClick={() => { setCliente(null); setBusqueda('') }}>
            Cambiar cliente
          </button>
        </div>
      ) : creandoCliente ? (
        <ClienteNuevo
          repo={repo}
          clientes={lista}
          busqueda={busqueda}
          alCrear={(c) => {
            setClientes((cs) => [...(cs ?? []), c])
            setCliente(c)
            setBusqueda('')
            setCreandoCliente(false)
          }}
          alCancelar={() => setCreandoCliente(false)}
        />
      ) : (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-lg font-semibold">
            Cliente
            <input
              type="search"
              autoComplete="off"
              placeholder="Nombre o RUT"
              className={`${campo} font-normal`}
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
            />
          </label>
          {sugeridos.length > 0 && (
            <ul className="flex flex-col gap-1">
              {sugeridos.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className="flex min-h-12 w-full flex-col rounded border bg-white p-3 text-left"
                    onClick={() => { setCliente(c); setBusqueda('') }}
                  >
                    <span className="text-lg font-semibold">{c.nombre}</span>
                    <span className="text-sm text-slate-600">{c.rut}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {sinClientes && (
            <p className="text-slate-700">
              Aún no hay clientes cargados.{creaClientes ? ' Crea uno con «Cliente nuevo».' : ''}
            </p>
          )}
          {busqueda.trim() !== '' && sugeridos.length === 0 && lista.length > 0 && (
            <p className="text-slate-600">No hay clientes con ese nombre o RUT.</p>
          )}
          {creaClientes && (
            <button type="button" className={botonClaro} onClick={() => setCreandoCliente(true)}>
              Cliente nuevo
            </button>
          )}
        </div>
      )}

      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault()
          void guardar()
        }}
      >
        {edicion ? (
          // El área no cambia al editar: las líneas ya están recibidas en la primera etapa de su área.
          <p className="text-lg">
            <span className="font-semibold">Área: </span>
            {AREAS.find((a) => a.id === area)?.titulo}
          </p>
        ) : (
          <>
            <Opciones nombre="area" titulo="Área" opciones={AREAS} valor={area} alCambiar={setArea} colorElegido={(a) => COLOR_AREA[a].elegido} />
            <Opciones nombre="entrada" titulo="¿Cómo llegó?" opciones={MODALIDADES} valor={entrada} alCambiar={setEntrada} />
          </>
        )}

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-lg font-semibold">Líneas</legend>
          {area === 'afilado' && (
            <p className="text-sm text-slate-600">Anota solo la herramienta, su tipo y tamaño. El ángulo, la melladura y el servicio los define el taller.</p>
          )}
          <datalist id="productos-sugeridos">
            {sugerenciasProductos.map((p) => (
              <option key={p.id} value={p.nombre}>{p.codigo}</option>
            ))}
          </datalist>
          {lineas.map((l, i) => (
            <div key={l.clave} className={`flex flex-wrap items-end gap-2 rounded border-l-8 p-2 ${COLOR_AREA[area].borde} ${COLOR_AREA[area].fondo}`}>
              <input
                aria-label={`Producto línea ${i + 1}`}
                placeholder="Producto"
                list="productos-sugeridos"
                className={`${campoLinea} min-w-[12rem] flex-[2] bg-white`}
                value={l.producto}
                onChange={(e) => actualizarLinea(l.clave, { producto: e.target.value })}
              />
              <input
                aria-label={`Cantidad línea ${i + 1}`}
                placeholder="Cant."
                inputMode="numeric"
                className={`${campoLinea} w-20 shrink-0 bg-white text-center`}
                value={l.cantidad}
                onChange={(e) => actualizarLinea(l.clave, { cantidad: e.target.value })}
              />
              <input
                aria-label={`Detalle línea ${i + 1}`}
                placeholder="Detalle (ej. Ø14 blanco)"
                maxLength={DETALLE_MAXIMO}
                className={`${campoLinea} min-w-[12rem] flex-[3] bg-white`}
                value={l.detalle}
                onChange={(e) => actualizarLinea(l.clave, { detalle: e.target.value })}
              />
              {lineas.length > 1 && (
                <button
                  type="button"
                  aria-label={`Quitar línea ${i + 1}`}
                  className={botonClaro}
                  onClick={() => setLineas((ls) => ls.filter((x) => x.clave !== l.clave))}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            className={botonClaro}
            onClick={() => setLineas((ls) => [...ls, { clave: siguienteClave.current++, producto: '', cantidad: '', detalle: '' }])}
          >
            Agregar línea
          </button>
        </fieldset>

        <label className="flex min-h-12 items-center gap-3 text-lg">
          <input type="checkbox" className="h-6 w-6" checked={urgente} onChange={(e) => setUrgente(e.target.checked)} />
          Urgente
        </label>
        <label className="flex flex-col gap-1 text-lg">
          Guía de retiro (opcional)
          <input className={campo} value={guia} onChange={(e) => setGuia(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-lg">
          Notas (opcional)
          <textarea className={campo} rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} />
        </label>

        {errores.length > 0 && (
          <div role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-red-800">
            <ul className="list-disc pl-5">
              {errores.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </div>
        )}

        <button type="submit" className={botonGrande} disabled={guardando}>
          {guardando ? 'Guardando…' : edicion ? 'Guardar cambios' : 'Guardar trabajo'}
        </button>
      </form>
    </div>
  )
}
