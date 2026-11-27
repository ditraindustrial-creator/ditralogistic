import { useEffect, useState, type FormEvent } from 'react'
import type { Repo } from './data/repo'
import type { Pantalla, UsuarioActual } from './dominio/tipos'
import { puedeVer } from './dominio/permisos'
import Listo from './pantallas/listo/Listo'
import Maestros from './pantallas/admin/Maestros'
import Reporte from './pantallas/reporte/Reporte'
import PantallaRecepcion from './pantallas/recepcion/PantallaRecepcion'
import HojaChofer from './pantallas/ruta/HojaChofer'
import RutaManana from './pantallas/ruta/RutaManana'
import Taller from './pantallas/taller/Taller'

const PANTALLAS: { id: Pantalla; titulo: string }[] = [
  { id: 'listo', titulo: 'Qué hay listo' },
  { id: 'recepcion', titulo: 'Recepción' },
  { id: 'taller', titulo: 'Taller / Producción' },
  { id: 'ruta', titulo: 'Ruta de mañana' },
  { id: 'hoja_chofer', titulo: 'Hoja de ruta' },
  { id: 'reporte', titulo: 'Reporte diario' },
  { id: 'admin', titulo: 'Administración' },
]

function Login({ repo, alIniciar, errorInicial = '' }: { repo: Repo; alIniciar: (u: UsuarioActual) => void; errorInicial?: string }) {
  const [correo, setCorreo] = useState('')
  const [clave, setClave] = useState('')
  const [error, setError] = useState(errorInicial)

  async function enviar(e: FormEvent) {
    e.preventDefault()
    setError('')
    try {
      alIniciar(await repo.iniciarSesion(correo, clave))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo iniciar sesión')
    }
  }

  return (
    <form onSubmit={enviar} className="mx-auto flex max-w-sm flex-col gap-4 p-6">
      <h1 className="text-2xl font-bold">Iniciar sesión</h1>
      <label className="flex flex-col gap-1">
        Correo
        <input type="email" value={correo} onChange={(e) => setCorreo(e.target.value)} className="rounded border p-3 text-lg" />
      </label>
      <label className="flex flex-col gap-1">
        Contraseña
        <input type="password" value={clave} onChange={(e) => setClave(e.target.value)} className="rounded border p-3 text-lg" />
      </label>
      {error && <p role="alert" className="text-red-700">{error}</p>}
      <button type="submit" className="rounded bg-teal-700 p-4 text-lg font-semibold text-white">Entrar</button>
    </form>
  )
}

export default function App({ repo }: { repo: Repo }) {
  const [usuario, setUsuario] = useState<UsuarioActual | null>(null)
  const [cargando, setCargando] = useState(true)
  const [pantalla, setPantalla] = useState<Pantalla | null>(null)

  const [errorSesion, setErrorSesion] = useState('')

  useEffect(() => {
    let activo = true
    repo
      .usuarioActual()
      .then((u) => {
        if (!activo) return
        setUsuario(u)
        setCargando(false)
      })
      .catch(() => {
        if (!activo) return
        setErrorSesion('No pudimos verificar tu sesión. Revisa tu conexión e inicia sesión de nuevo.')
        setCargando(false)
      })
    return () => {
      activo = false
    }
  }, [repo])

  if (cargando) return <p className="p-6">Cargando…</p>
  if (!usuario) return <Login repo={repo} alIniciar={setUsuario} errorInicial={errorSesion} />

  // La hoja de ruta es el inicio del chofer: va primera en su menú.
  const permitidas = PANTALLAS.filter((p) => puedeVer(usuario.rol, p.id)).sort(
    (a, b) => Number(usuario.rol === 'chofer' && b.id === 'hoja_chofer') - Number(usuario.rol === 'chofer' && a.id === 'hoja_chofer'),
  )
  const actual = permitidas.find((p) => p.id === pantalla)

  return (
    <div className="mx-auto max-w-md p-4 md:max-w-3xl">
      <header className="mb-4 flex items-center justify-between print:hidden">
        <span className="text-lg font-semibold">Hola, {usuario.nombre}</span>
        <button
          className="rounded border px-4 py-2"
          onClick={async () => {
            await repo.cerrarSesion()
            setUsuario(null)
            setPantalla(null)
          }}
        >
          Salir
        </button>
      </header>
      {actual ? (
        <section>
          <button className="mb-4 rounded border px-4 py-2 print:hidden" onClick={() => setPantalla(null)}>← Menú</button>
          <h1 className="text-2xl font-bold">{actual.titulo}</h1>
          {actual.id === 'admin' ? (
            <div className="mt-4"><Maestros repo={repo} usuario={usuario} /></div>
          ) : actual.id === 'recepcion' ? (
            <div className="mt-4"><PantallaRecepcion repo={repo} usuario={usuario} /></div>
          ) : actual.id === 'taller' ? (
            <div className="mt-4"><Taller repo={repo} usuario={usuario} /></div>
          ) : actual.id === 'ruta' ? (
            <div className="mt-4"><RutaManana repo={repo} usuario={usuario} /></div>
          ) : actual.id === 'hoja_chofer' ? (
            <div className="mt-4"><HojaChofer repo={repo} usuario={usuario} /></div>
          ) : actual.id === 'reporte' ? (
            <div className="mt-4"><Reporte repo={repo} /></div>
          ) : (
            <p className="mt-2 text-slate-600">Próximamente.</p>
          )}
        </section>
      ) : (
        // Menú compacto (botones en filas que se ajustan, de al menos 48 px de alto): en el celular "Qué hay
        // listo" queda a la vista sin bajar, incluso con los seis botones de gestión.
        <nav aria-label="Menú" className="flex flex-wrap gap-2">
          {permitidas.filter((p) => p.id !== 'listo').map((p) => (
            <button key={p.id} onClick={() => setPantalla(p.id)} className="min-h-12 flex-auto rounded bg-teal-700 px-4 py-2 text-left text-lg font-semibold text-white">
              {p.titulo}
            </button>
          ))}
        </nav>
      )}
      {!actual && puedeVer(usuario.rol, 'listo') && (
        <section aria-label="Qué hay listo" className="mt-6">
          <h1 className="mb-3 text-2xl font-bold">Qué hay listo</h1>
          <Listo repo={repo} />
        </section>
      )}
    </div>
  )
}
