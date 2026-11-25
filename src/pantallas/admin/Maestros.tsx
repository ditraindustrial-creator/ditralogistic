import { useCallback, useEffect, useState } from 'react'
import type { Repo } from '../../data/repo'
import type { Area, Asignacion, Cliente, Producto, Recorrido, UsuarioActual } from '../../dominio/tipos'
import { importarAsignaciones, importarClientes, importarProductos } from '../../dominio/csv'
import { esGestion } from '../../dominio/permisos'
import { Importador, mensaje, resumen, resumenAsignaciones, sinAcentos } from './Importador'
import AsignacionesCliente from './AsignacionesCliente'
import PestanaRecorridos from './PestanaRecorridos'

const MAX_FILAS_VISIBLES = 50

const campo = 'min-h-12 rounded border p-3 text-lg'

function PestanaClientes({
  repo, clientes, recorridos, asignaciones, editable, recargar,
}: {
  repo: Repo
  clientes: Cliente[]
  recorridos: Recorrido[]
  asignaciones: Asignacion[]
  /** Gestión (admin, secretaria, jefe de taller) importa y cambia recorridos; el resto solo mira. */
  editable: boolean
  recargar: () => Promise<void>
}) {
  const [busqueda, setBusqueda] = useState('')

  const q = sinAcentos(busqueda.trim())
  const coincidencias = clientes.filter((c) => q === '' || sinAcentos(c.nombre).includes(q) || c.rut.toLowerCase().includes(q))

  return (
    <div className="flex flex-col gap-4">
      {editable && (
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
      )}
      {editable && (
        <Importador
          etiquetaArchivo="Archivo de recorridos de clientes (CSV)"
          ayuda="Una fila por cliente y recorrido: columnas recorrido;rut;fija;orden (como la plantilla docs/plantilla-asignaciones.csv). Un cliente puede salir en varias filas, una por cada día que se le visita. Fija vacía = sí; orden vacío = su posición en el archivo."
          textoBoton="Importar recorridos de clientes"
          campos={[
            { clave: 'recorrido', etiqueta: 'Columna del recorrido', obligatorio: true, pistas: ['recorrido', 'ruta'] },
            { clave: 'rut', etiqueta: 'Columna del RUT del cliente', obligatorio: true, pistas: ['rut'] },
            { clave: 'fija', etiqueta: 'Columna fija (opcional)', obligatorio: false, pistas: ['fija', 'fijo'] },
            { clave: 'orden', etiqueta: 'Columna del orden (opcional)', obligatorio: false, pistas: ['orden'] },
          ]}
          ejecutar={async (filas, m) => {
            // Con los clientes y recorridos más recientes: puede que se acaben de importar.
            const [todosClientes, todosRecorridos] = await Promise.all([repo.listarClientes(), repo.listarRecorridos()])
            const { asignaciones: buenas, errores } = importarAsignaciones(
              filas,
              { recorrido: m.recorrido, rut: m.rut, fija: m.fija || undefined, orden: m.orden || undefined },
              todosRecorridos,
              todosClientes,
            )
            const r = buenas.length > 0 ? await repo.guardarAsignaciones(buenas) : { creados: 0, actualizados: 0, sinCambios: 0 }
            await recargar()
            return { resumen: resumenAsignaciones(r, errores.length), errores }
          }}
        />
      )}
      <label className="flex flex-col gap-1">
        Buscar cliente
        <input className={campo} value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Nombre o RUT" />
      </label>
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
                <AsignacionesCliente
                  repo={repo}
                  cliente={c}
                  recorridos={recorridos}
                  asignaciones={asignaciones}
                  editable={editable}
                  recargar={recargar}
                />
              </li>
            ))}
          </ul>
        </>
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

/**
 * Administración de maestros. El acceso se controla en App con puedeVer(rol, 'admin'). Con `usuario`
 * que no es de gestión, los recorridos de los clientes se muestran sin poder cambiarlos (como RLS).
 */
export default function Maestros({ repo, usuario }: { repo: Repo; usuario?: UsuarioActual }) {
  const editable = !usuario || esGestion(usuario.rol)
  const [pestana, setPestana] = useState<Pestana>('clientes')
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [recorridos, setRecorridos] = useState<Recorrido[]>([])
  const [asignaciones, setAsignaciones] = useState<Asignacion[]>([])
  const [productos, setProductos] = useState<Producto[]>([])
  const [errorCarga, setErrorCarga] = useState('')

  const recargar = useCallback(async () => {
    try {
      const [c, r, a, p] = await Promise.all([repo.listarClientes(), repo.listarRecorridos(), repo.listarAsignaciones(), repo.listarProductos()])
      setClientes(c)
      setRecorridos(r)
      setAsignaciones(a)
      setProductos(p)
      setErrorCarga('')
    } catch (e) {
      setErrorCarga(mensaje(e, 'No se pudieron cargar los datos.'))
    }
  }, [repo])

  useEffect(() => {
    let activo = true
    Promise.all([repo.listarClientes(), repo.listarRecorridos(), repo.listarAsignaciones(), repo.listarProductos()])
      .then(([c, r, a, p]) => {
        if (!activo) return
        setClientes(c)
        setRecorridos(r)
        setAsignaciones(a)
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
      {pestana === 'clientes' && (
        <PestanaClientes repo={repo} clientes={clientes} recorridos={recorridos} asignaciones={asignaciones} editable={editable} recargar={recargar} />
      )}
      {pestana === 'recorridos' && <PestanaRecorridos repo={repo} recorridos={recorridos} recargar={recargar} />}
      {pestana === 'productos' && <PestanaProductos repo={repo} productos={productos} recargar={recargar} />}
    </div>
  )
}
