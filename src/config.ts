export interface ConfigSupabase {
  url: string
  anonKey: string
}

export type ResultadoConfig = { ok: true; config: ConfigSupabase } | { ok: false; faltantes: string[] }

export function leerConfig(env: Record<string, string | undefined>): ResultadoConfig {
  const url = env.VITE_SUPABASE_URL?.trim()
  const anonKey = env.VITE_SUPABASE_ANON_KEY?.trim()
  const faltantes: string[] = []
  if (!url) faltantes.push('VITE_SUPABASE_URL')
  if (!anonKey) faltantes.push('VITE_SUPABASE_ANON_KEY')
  if (faltantes.length > 0 || !url || !anonKey) return { ok: false, faltantes }
  return { ok: true, config: { url, anonKey } }
}
