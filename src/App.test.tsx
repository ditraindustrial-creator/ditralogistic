import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import { crearMemoryRepo } from './data/memoryRepo'

describe('App', () => {
  it('el menú del chofer solo muestra sus pantallas', async () => {
    const repo = crearMemoryRepo({ usuario: { id: 'u1', nombre: 'Pedro', rol: 'chofer' } })
    render(<App repo={repo} />)
    expect(await screen.findByRole('button', { name: 'Hoja de ruta' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Recepción' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Administración' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reporte diario' })).not.toBeInTheDocument()
  })

  it('el admin ve Administración', async () => {
    const repo = crearMemoryRepo({ usuario: { id: 'u2', nombre: 'Ana', rol: 'admin' } })
    render(<App repo={repo} />)
    expect(await screen.findByRole('button', { name: 'Administración' })).toBeInTheDocument()
  })

  it('sin sesión muestra login y entra con credenciales válidas', async () => {
    const repo = crearMemoryRepo({
      cuentas: { 'p@x.cl': { clave: 'abc', usuario: { id: 'u1', nombre: 'Pedro', rol: 'chofer' } } },
    })
    render(<App repo={repo} />)
    await userEvent.type(await screen.findByLabelText('Correo'), 'p@x.cl')
    await userEvent.type(screen.getByLabelText('Contraseña'), 'abc')
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(await screen.findByText('Hola, Pedro')).toBeInTheDocument()
  })

  it('si usuarioActual falla muestra el login con un mensaje de error', async () => {
    const repo = crearMemoryRepo()
    repo.usuarioActual = () => Promise.reject(new Error('red caída'))
    render(<App repo={repo} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos verificar tu sesión')
    expect(screen.getByRole('button', { name: 'Entrar' })).toBeInTheDocument()
  })
})
