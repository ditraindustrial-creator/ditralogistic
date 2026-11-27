import { useState } from 'react'
import type { Repo } from '../../data/repo'
import { puedeEditarRecepcion } from '../../dominio/permisos'
import type { UsuarioActual } from '../../dominio/tipos'
import Recepcion from './Recepcion'
import EditarRecibidos from './EditarRecibidos'

type Modo = 'recibir' | 'editar'

/** Pantalla Recepción: recibir un trabajo y, para gestión, editar los que siguen en Recepción. */
export default function PantallaRecepcion({ repo, usuario }: { repo: Repo; usuario: UsuarioActual }) {
  const [modo, setModo] = useState<Modo>('recibir')
  if (!puedeEditarRecepcion(usuario.rol)) return <Recepcion repo={repo} usuario={usuario} />
  const pestanas: { id: Modo; titulo: string }[] = [
    { id: 'recibir', titulo: 'Recibir trabajo' },
    { id: 'editar', titulo: 'Editar recibidos' },
  ]
  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" aria-label="Recepción" className="flex gap-2">
        {pestanas.map((p) => (
          <button
            key={p.id}
            role="tab"
            aria-selected={modo === p.id}
            className={`min-h-12 flex-1 rounded border px-2 py-3 text-lg ${modo === p.id ? 'bg-teal-700 font-semibold text-white' : ''}`}
            onClick={() => setModo(p.id)}
          >
            {p.titulo}
          </button>
        ))}
      </div>
      {modo === 'recibir' ? <Recepcion repo={repo} usuario={usuario} /> : <EditarRecibidos repo={repo} usuario={usuario} />}
    </div>
  )
}
