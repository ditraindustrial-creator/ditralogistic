import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { crearSupabaseRepo } from './data/supabaseRepo'
import { leerConfig } from './config'

const resultado = leerConfig(import.meta.env)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {resultado.ok ? (
      <App repo={crearSupabaseRepo(resultado.config.url, resultado.config.anonKey)} />
    ) : (
      <div role="alert" className="mx-auto max-w-md p-6">
        <h1 className="text-2xl font-bold">Falta configurar la aplicación</h1>
        <p className="mt-2">
          Faltan las variables de entorno: <strong>{resultado.faltantes.join(', ')}</strong>. Avisa al administrador.
        </p>
      </div>
    )}
  </StrictMode>,
)
