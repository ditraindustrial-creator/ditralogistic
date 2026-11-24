import { createClient } from '@supabase/supabase-js'
import type { Repo } from './repo'
import type { Movimiento, Rol, UsuarioActual } from '../dominio/tipos'
import { ErrorMovimiento, validarCantidad } from '../dominio/avance'

interface FilaMovimiento {
  id: string
  linea_id: string
  cantidad: number
  etapa_origen_id: string | null
  etapa_destino_id: string
  usuario_id: string
  creado_en: string
}

export function filaAMovimiento(f: FilaMovimiento): Movimiento {
  return {
    id: f.id,
    lineaId: f.linea_id,
    cantidad: f.cantidad,
    etapaOrigenId: f.etapa_origen_id,
    etapaDestinoId: f.etapa_destino_id,
    usuarioId: f.usuario_id,
    creadoEn: f.creado_en,
  }
}

/** Traduce un error de mover_unidades: las reglas de la base ya traen mensaje en español. */
export function errorDeMovimiento(e: { code?: string; message: string }): Error {
  if (e.code === 'P0001') return new ErrorMovimiento(e.message)
  if (e.code === '42501') {
    return new ErrorMovimiento(
      /row-level security/i.test(e.message) ? 'No tienes permiso para mover unidades de esta línea.' : e.message,
    )
  }
  if (e.code === '22P02') return new ErrorMovimiento('La cantidad debe ser un número entero mayor que cero.')
  return new Error('No se pudo registrar el movimiento. Revisa tu conexión e inténtalo de nuevo.')
}

export function crearSupabaseRepo(url: string, anonKey: string): Repo {
  const sb = createClient(url, anonKey)

  async function cargarPerfil(id: string): Promise<UsuarioActual | null> {
    const { data, error } = await sb.from('perfiles').select('nombre, rol').eq('usuario_id', id).maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) return null
    return { id, nombre: data.nombre as string, rol: data.rol as Rol }
  }

  return {
    async usuarioActual() {
      const { data } = await sb.auth.getUser()
      if (!data.user) return null
      return cargarPerfil(data.user.id)
    },
    async iniciarSesion(correo, clave) {
      const { data, error } = await sb.auth.signInWithPassword({ email: correo, password: clave })
      if (error || !data.user) throw new Error('Correo o contraseña incorrectos')
      const perfil = await cargarPerfil(data.user.id)
      if (!perfil) throw new Error('Tu usuario no tiene perfil asignado. Avisa al administrador.')
      return perfil
    },
    async cerrarSesion() {
      await sb.auth.signOut()
    },
    async moverUnidades(lineaId, cantidad, origenId, destinoId) {
      validarCantidad(cantidad)
      const { data, error } = await sb.rpc('mover_unidades', {
        p_linea: lineaId,
        p_cantidad: cantidad,
        p_origen: origenId,
        p_destino: destinoId,
      })
      if (error) throw errorDeMovimiento(error)
      return filaAMovimiento(data as FilaMovimiento)
    },
  }
}
