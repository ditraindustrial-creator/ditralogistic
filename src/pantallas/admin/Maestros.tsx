import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import type { Repo, ResultadoGuardado } from '../../data/repo'
import type { Area, Cliente, Producto, Recorrido } from '../../dominio/tipos'
import {
  decodificarArchivo,
  importarClientes,
  importarProductos,
  parsearCsv,
  type ErrorFila,
} from '../../dominio/csv'

const DIAS: Record<number, string> = { 1: 'Lunes', 2: 'Martes', 3: 'Miércoles', 4: 'Jueves', 5: 'Viernes' }
const MAX_FILAS_VISIBLES = 50

const boton = 'min-h-12 rounded bg-teal-700 px-5 py-3 text-lg font-semibold text-white disabled:opacity-50'
const botonClaro = 'min-h-12 rounded border px-4 py-3 text-lg'
const campo = 'min-h-12 rounded border p-3 text-lg'

function leerArchivo(file: File): Promise<ArrayBuffer> {
  return new Promise((resolver, rechazar) => {
    const lector = new FileReader()
    lector.onload = () => resolver(lector.result as ArrayBuffer)
    lector.onerror = () => rechazar(new Error('No se pudo leer el archivo.'))
    lector.readAsArrayBuffer(file)
  })
}

function mensaje(e: unknown, porDefecto: string): string {
  return e instanceof Error ? e.message : porDefecto
}

function pluralNuevos(n: number, singular: string, plural: string): string {
  return n === 1 ? `1 ${singular} nuevo` : `${n} ${plural} nuevos`
}

function resumen(r: ResultadoGuardado, singular: string, plural: string): string {
  const act = r.actualizados === 1 ? '1 actualizado' : `${r.actualizados} actualizados`
  return `${pluralNuevos(r.creados, singular, plural)}, ${act}, ${r.sinCambios} sin cambios.`
}

interface CampoImportador {
  clave: string
  etiqueta: string
  obligatorio: boolean
  /** Palabras que, si aparecen en un encabezado, lo hacen la opción sugerida. */
  pistas: string[]
}

interface ResultadoImportacion {
  resumen: string
  errores: ErrorFila[]
}

function sinAcentos(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

function sugerir(columnas: string[], pistas: string[], yaUsadas: string[]): string {
  return columnas.find((c) => !yaUsadas.includes(c) && pistas.some((p) => sinAcentos(c).includes(p))) ?? ''
}

/** Subir un CSV, elegir qué columna es cada campo e importar. Las reglas viven en dominio/csv. */
function Importador({
  etiquetaArchivo,
  campos,
  textoBoton,
  extra,
  ejecutar,
}: {
  etiquetaArchivo: string
  campos: CampoImportador[]
  textoBoton: string
  extra?: ReactNode
  ejecutar: (filas: Record<string, string>[], mapeo: Record<string, string>) => Promise<ResultadoImportacion>
}) {
  const [filas, setFilas] = useState<Record<string, string>[] | null>(null)
  const [mapeo, setMapeo] = useState<Record<string, string>>({})
  const [resultado, setResultado] = useState<ResultadoImportacion | null>(null)
  const [error, setError] = useState('')
  const [trabajando, setTrabajando] = useState(false)

  async function alElegirArchivo(file: File | undefined) {
    setResultado(null)
    setError('')
    setFilas(null)
    if (!file) return
    try {
      const nuevas = parsearCsv(decodificarArchivo(await leerArchivo(file)))
      if (nuevas.length === 0) {
        setError('El archivo no tiene filas para importar.')
        return
      }
      const columnas = Object.keys(nuevas[0])
      const sugerido: Record<string, string> = {}
      for (const c of campos) sugerido[c.clave] = sugerir(columnas, c.pistas, Object.values(sugerido))
      setMapeo(sugerido)
      setFilas(nuevas)
    } catch (e) {
      setError(mensaje(e, 'No se pudo leer el archivo.'))
    }
  }

  async function importar() {
    if (!filas) return
    setTrabajando(true)
    setError('')
    setResultado(null)
    try {
      setResultado(await ejecutar(filas, mapeo))
    } catch (e) {
      setError(mensaje(e, 'No se pudo importar.'))
    } finally {
      setTrabajando(false)
    }
  }

  const columnas = filas ? Object.keys(filas[0]) : []
  const completo = campos.every((c) => !c.obligatorio || mapeo[c.clave])

  return (
    <div className="flex flex-col gap-3 rounded border p-3">
      <label className="flex flex-col gap-1">
        {etiquetaArchivo}
        <input
          type="file"
          accept=".csv,.txt,text/csv"
          className={campo}
          onChange={(e) => {
            void alElegirArchivo(e.target.files?.[0])
            // Se vacía para que elegir de nuevo el mismo archivo (corregido, con el mismo nombre) vuelva a leerlo.
            e.target.value = ''
          }}
        />
      </label>
      {filas && (
        <>
          <p className="text-slate-600">{filas.length} filas en el archivo. Elige qué columna es cada dato.</p>
          {campos.map((c) => (
            <label key={c.clave} className="flex flex-col gap-1">
              {c.etiqueta}
              <select
                className={campo}
                value={mapeo[c.clave] ?? ''}
                onChange={(e) => setMapeo({ ...mapeo, [c.clave]: e.target.value })}
              >
                <option value="">{c.obligatorio ? '— elige una columna —' : '— ninguna —'}</option>
                {columnas.map((col) => (
                  <option key={col} value={col}>
                    {col}
                  </option>
                ))}
              </select>
            </label>
          ))}
          {extra}
          <button className={boton} disabled={!completo || trabajando} onClick={() => void importar()}>
            {textoBoton}
          </button>
        </>
      )}
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      {resultado && (
        <div>
          <p className="font-semibold">{resultado.resumen}</p>
          {resultado.errores.length > 0 && (
            <>
              <p className="mt-2 text-red-700">
                {resultado.errores.length === 1 ? '1 fila no se importó:' : `${resultado.errores.length} filas no se importaron:`}
              </p>
              <ul aria-label="Errores de importación" className="list-disc pl-6 text-red-700">
                {resultado.errores.map((e, i) => (
                  <li key={i}>{e.fila > 0 ? `Fila ${e.fila}: ${e.motivo}` : e.motivo}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function etiquetaRecorrido(r: Recorrido): string {
  return `${r.nombre} (${DIAS[r.dia]}${r.lejano ? ', lejano' : ''})`
}

function PestanaClientes({ repo, clientes, recorridos, recargar }: { repo: Repo; clientes: Cliente[]; recorridos: Recorrido[]; recargar: () => Promise<void> }) {
  const [busqueda, setBusqueda] = useState('')
  const [error, setError] = useState('')

  const q = sinAcentos(busqueda.trim())
  const coincidencias = clientes.filter((c) => q === '' || sinAcentos(c.nombre).includes(q) || c.rut.toLowerCase().includes(q))

  async function asignar(clienteId: string, recorridoId: string) {
    setError('')
    try {
      await repo.asignarRecorrido(clienteId, recorridoId === '' ? null : recorridoId)
      await recargar()
    } catch (e) {
      setError(mensaje(e, 'No se pudo asignar el recorrido.'))
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Importador
        etiquetaArchivo="Archivo de clientes (CSV)"
        textoBoton="Importar clientes"
        campos={[
          { clave: 'nombre', etiqueta: 'Columna del nombre', obligatorio: true, pistas: ['nombre', 'razon', 'cliente'] },
          { clave: 'rut', etiqueta: 'Columna del RUT', obligatorio: true, pistas: ['rut'] },
          { clave: 'contacto', etiqueta: 'Columna del contacto (opcional)', obligatorio: false, pistas: ['contacto', 'telefono', 'fono'] },
          { clave: 'direccion', etiqueta: 'Columna de la dirección (opcional)', obligatorio: false, pistas: ['direccion', 'domicilio'] },
        ]}
        ejecutar={async (filas, m) => {
          const { clientes: buenos, errores } = importarClientes(filas, {
            nombre: m.nombre,
            rut: m.rut,
            contacto: m.contacto || undefined,
            direccion: m.direccion || undefined,
          })
          const r = buenos.length > 0 ? await repo.guardarClientes(buenos) : { creados: 0, actualizados: 0, sinCambios: 0 }
          await recargar()
          return { resumen: resumen(r, 'cliente', 'clientes'), errores }
        }}
      />
      <label className="flex flex-col gap-1">
        Buscar cliente
        <input className={campo} value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Nombre o RUT" />
      </label>
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      {clientes.length === 0 ? (
        <p className="text-slate-600">Aún no hay clientes. Importa el archivo exportado del ERP.</p>
      ) : (
        <>
          <p className="text-slate-600">
            {clientes.length} clientes{coincidencias.length > MAX_FILAS_VISIBLES ? `; mostrando ${MAX_FILAS_VISIBLES} de ${coincidencias.length} coincidencias` : ''}.
          </p>
          <ul aria-label="Clientes" className="flex flex-col gap-3">
            {coincidencias.slice(0, MAX_FILAS_VISIBLES).map((c) => (
              <li key={c.id} className="flex flex-col gap-2 rounded border p-3">
                <span className="text-lg font-semibold">{c.nombre}</span>
                <span className="text-slate-600">{c.rut}</span>
                <select
                  aria-label={`Recorrido de ${c.nombre}`}
                  className={campo}
                  value={c.recorridoId ?? ''}
                  onChange={(e) => void asignar(c.id, e.target.value)}
                >
                  <option value="">Sin recorrido</option>
                  {recorridos.map((r) => (
                    <option key={r.id} value={r.id}>
                      {etiquetaRecorrido(r)}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

function PestanaRecorridos({ repo, recorridos, recargar }: { repo: Repo; recorridos: Recorrido[]; recargar: () => Promise<void> }) {
  const [editando, setEditando] = useState<string | null>(null)
  const [nombre, setNombre] = useState('')
  const [dia, setDia] = useState<Recorrido['dia']>(1)
  const [camioneta, setCamioneta] = useState('')
  const [lejano, setLejano] = useState(false)
  const [error, setError] = useState('')

  function limpiar() {
    setEditando(null)
    setNombre('')
    setDia(1)
    setCamioneta('')
    setLejano(false)
  }

  async function guardar(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (nombre.trim() === '') return setError('Escribe el nombre del recorrido.')
    if (camioneta.trim() === '') return setError('Escribe la camioneta del recorrido.')
    try {
      await repo.guardarRecorrido({ id: editando ?? undefined, nombre: nombre.trim(), dia, camioneta: camioneta.trim(), lejano })
      limpiar()
      await recargar()
    } catch (err) {
      setError(mensaje(err, 'No se pudo guardar el recorrido.'))
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={(e) => void guardar(e)} className="flex flex-col gap-3 rounded border p-3">
        <label className="flex flex-col gap-1">
          Nombre del recorrido
          <input className={campo} value={nombre} onChange={(e) => setNombre(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          Día
          <select className={campo} value={dia} onChange={(e) => setDia(Number(e.target.value) as Recorrido['dia'])}>
            {Object.entries(DIAS).map(([n, t]) => (
              <option key={n} value={n}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Camioneta
          <input className={campo} value={camioneta} onChange={(e) => setCamioneta(e.target.value)} list="camionetas" />
          <datalist id="camionetas">
            <option value="Camioneta 1" />
            <option value="Camioneta 2" />
            <option value="Emergencia" />
          </datalist>
        </label>
        <label className="flex min-h-12 items-center gap-3 text-lg">
          <input type="checkbox" className="h-6 w-6" checked={lejano} onChange={(e) => setLejano(e.target.checked)} />
          Lejano
        </label>
        {error && (
          <p role="alert" className="text-red-700">
            {error}
          </p>
        )}
        <div className="flex gap-3">
          <button type="submit" className={boton}>
            Guardar recorrido
          </button>
          {editando && (
            <button type="button" className={botonClaro} onClick={limpiar}>
              Cancelar
            </button>
          )}
        </div>
      </form>
      {recorridos.length === 0 ? (
        <p className="text-slate-600">Aún no hay recorridos.</p>
      ) : (
        <ul aria-label="Recorridos" className="flex flex-col gap-3">
          {recorridos.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2 rounded border p-3">
              <span>{`${r.nombre} · ${DIAS[r.dia]} · ${r.camioneta}${r.lejano ? ' · lejano' : ''}`}</span>
              <button
                className={botonClaro}
                aria-label={`Editar ${r.nombre}`}
                onClick={() => {
                  setEditando(r.id)
                  setNombre(r.nombre)
                  setDia(r.dia)
                  setCamioneta(r.camioneta)
                  setLejano(r.lejano)
                }}
              >
                Editar
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const AREAS: { valor: Area; texto: string }[] = [
  { valor: 'afilado', texto: 'Afilado' },
  { valor: 'encuadernacion', texto: 'Encuadernación' },
]

function PestanaProductos({ repo, productos, recargar }: { repo: Repo; productos: Producto[]; recargar: () => Promise<void> }) {
  const [areaPorDefecto, setAreaPorDefecto] = useState<Area | ''>('')
  const [busqueda, setBusqueda] = useState('')
  const q = sinAcentos(busqueda.trim())
  const coincidencias = productos.filter((p) => q === '' || sinAcentos(p.nombre).includes(q) || sinAcentos(p.codigo).includes(q))

  return (
    <div className="flex flex-col gap-4">
      <Importador
        etiquetaArchivo="Archivo de productos (CSV)"
        textoBoton="Importar productos"
        campos={[
          { clave: 'codigo', etiqueta: 'Columna del código', obligatorio: true, pistas: ['codigo', 'cod'] },
          { clave: 'nombre', etiqueta: 'Columna del nombre', obligatorio: true, pistas: ['nombre', 'descripcion', 'producto'] },
          { clave: 'area', etiqueta: 'Columna del área (opcional)', obligatorio: false, pistas: ['area'] },
        ]}
        extra={
          <label className="flex flex-col gap-1">
            Área de todos los productos
            <select className={campo} value={areaPorDefecto} onChange={(e) => setAreaPorDefecto(e.target.value as Area | '')}>
              <option value="">— usar la columna del área —</option>
              {AREAS.map((a) => (
                <option key={a.valor} value={a.valor}>
                  {a.texto}
                </option>
              ))}
            </select>
          </label>
        }
        ejecutar={async (filas, m) => {
          const { productos: buenos, errores } = importarProductos(filas, {
            codigo: m.codigo,
            nombre: m.nombre,
            // El área fija elegida manda sobre la columna.
            area: areaPorDefecto ? undefined : m.area || undefined,
            areaPorDefecto: areaPorDefecto || undefined,
          })
          const r = buenos.length > 0 ? await repo.guardarProductos(buenos) : { creados: 0, actualizados: 0, sinCambios: 0 }
          await recargar()
          return { resumen: resumen(r, 'producto', 'productos'), errores }
        }}
      />
      <label className="flex flex-col gap-1">
        Buscar producto
        <input className={campo} value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Código o nombre" />
      </label>
      {productos.length === 0 ? (
        <p className="text-slate-600">Aún no hay productos en el catálogo.</p>
      ) : (
        <>
          <p className="text-slate-600">
            {productos.length} productos{coincidencias.length > MAX_FILAS_VISIBLES ? `; mostrando ${MAX_FILAS_VISIBLES} de ${coincidencias.length} coincidencias` : ''}.
          </p>
          <ul aria-label="Productos" className="flex flex-col gap-3">
            {coincidencias.slice(0, MAX_FILAS_VISIBLES).map((p) => (
              <li key={p.id} className="rounded border p-3">
                <span className="block text-lg font-semibold">{p.nombre}</span>
                <span className="text-slate-600">{`${p.codigo} · ${p.area === 'afilado' ? 'Afilado' : 'Encuadernación'}`}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

type Pestana = 'clientes' | 'recorridos' | 'productos'
const PESTANAS: { id: Pestana; titulo: string }[] = [
  { id: 'clientes', titulo: 'Clientes' },
  { id: 'recorridos', titulo: 'Recorridos' },
  { id: 'productos', titulo: 'Productos' },
]

/** Administración de maestros. El acceso se controla en App con puedeVer(rol, 'admin'). */
export default function Maestros({ repo }: { repo: Repo }) {
  const [pestana, setPestana] = useState<Pestana>('clientes')
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [recorridos, setRecorridos] = useState<Recorrido[]>([])
  const [productos, setProductos] = useState<Producto[]>([])
  const [errorCarga, setErrorCarga] = useState('')

  const recargar = useCallback(async () => {
    try {
      const [c, r, p] = await Promise.all([repo.listarClientes(), repo.listarRecorridos(), repo.listarProductos()])
      setClientes(c)
      setRecorridos(r)
      setProductos(p)
      setErrorCarga('')
    } catch (e) {
      setErrorCarga(mensaje(e, 'No se pudieron cargar los datos.'))
    }
  }, [repo])

  useEffect(() => {
    let activo = true
    Promise.all([repo.listarClientes(), repo.listarRecorridos(), repo.listarProductos()])
      .then(([c, r, p]) => {
        if (!activo) return
        setClientes(c)
        setRecorridos(r)
        setProductos(p)
      })
      .catch((e) => {
        if (activo) setErrorCarga(mensaje(e, 'No se pudieron cargar los datos.'))
      })
    return () => {
      activo = false
    }
  }, [repo])

  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" aria-label="Maestros" className="flex gap-2">
        {PESTANAS.map((p) => (
          <button
            key={p.id}
            role="tab"
            aria-selected={pestana === p.id}
            className={`min-h-12 flex-1 rounded border px-2 py-3 text-lg ${pestana === p.id ? 'bg-teal-700 font-semibold text-white' : ''}`}
            onClick={() => setPestana(p.id)}
          >
            {p.titulo}
          </button>
        ))}
      </div>
      {errorCarga && (
        <p role="alert" className="text-red-700">
          {errorCarga}
        </p>
      )}
      {pestana === 'clientes' && <PestanaClientes repo={repo} clientes={clientes} recorridos={recorridos} recargar={recargar} />}
      {pestana === 'recorridos' && <PestanaRecorridos repo={repo} recorridos={recorridos} recargar={recargar} />}
      {pestana === 'productos' && <PestanaProductos repo={repo} productos={productos} recargar={recargar} />}
    </div>
  )
}
