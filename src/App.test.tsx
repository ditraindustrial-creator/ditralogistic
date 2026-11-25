import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
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

  it('la hoja de ruta es lo primero del menú del chofer y se abre sin títulos repetidos', async () => {
    const repo = crearMemoryRepo({ usuario: { id: 'u1', nombre: 'Pedro', rol: 'chofer' } })
    render(<App repo={repo} />)
    const botones = (await screen.findAllByRole('button')).map((b) => b.textContent)
    expect(botones.indexOf('Hoja de ruta')).toBeLessThan(botones.indexOf('Recepción'))
    await userEvent.click(screen.getByRole('button', { name: 'Hoja de ruta' }))
    expect(await screen.findByLabelText('Fecha')).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { name: 'Hoja de ruta' })).toHaveLength(1)
  })

  it('la secretaria abre la ruta de mañana, con un solo título', async () => {
    const repo = crearMemoryRepo({ usuario: { id: 'u3', nombre: 'Sofía', rol: 'secretaria' } })
    render(<App repo={repo} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Ruta de mañana' }))
    expect(await screen.findByRole('button', { name: 'Agregar visita extra' })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { name: 'Ruta de mañana' })).toHaveLength(1)
    expect(screen.queryByText('Próximamente.')).not.toBeInTheDocument()
  })

  it('en el inicio de gestión el menú es compacto (botones en filas, al menos 48 px) y "Qué hay listo" va justo después', async () => {
    const repo = crearMemoryRepo({ usuario: { id: 'u2', nombre: 'Ana', rol: 'admin' } })
    render(<App repo={repo} />)
    const menu = await screen.findByRole('navigation', { name: 'Menú' })
    expect(menu).toHaveClass('flex-wrap')
    const botones = within(menu).getAllByRole('button')
    expect(botones).toHaveLength(6)
    for (const b of botones) {
      expect(b).toHaveClass('min-h-12') // 48 px: sigue siendo cómodo para el dedo
      expect(b).not.toHaveClass('p-5') // antes: botones de ancho completo con mucho relleno, Listo quedaba bajo el pliegue
    }
    const listo = screen.getByRole('heading', { name: 'Qué hay listo' })
    expect(menu.compareDocumentPosition(listo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('el admin ve Administración', async () => {
    const repo = crearMemoryRepo({ usuario: { id: 'u2', nombre: 'Ana', rol: 'admin' } })
    render(<App repo={repo} />)
    expect(await screen.findByRole('button', { name: 'Administración' })).toBeInTheDocument()
  })

  it('Administración abre los maestros', async () => {
    const repo = crearMemoryRepo({ usuario: { id: 'u2', nombre: 'Ana', rol: 'admin' } })
    render(<App repo={repo} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Administración' }))
    expect(await screen.findByRole('tab', { name: 'Recorridos' })).toBeInTheDocument()
  })

  it('Recepción abre el formulario de recepción', async () => {
    const repo = crearMemoryRepo({ usuario: { id: 'u1', nombre: 'Pedro', rol: 'chofer' } })
    render(<App repo={repo} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Recepción' }))
    expect(await screen.findByRole('button', { name: 'Guardar trabajo' })).toBeInTheDocument()
    expect(screen.getByLabelText('Ruta propia (retiro)')).toBeChecked()
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

describe('App inicio', () => {
  it('la pantalla de inicio muestra qué hay listo a quien puede verla, y al chofer no', async () => {
    const admin = crearMemoryRepo({ usuario: { id: 'u2', nombre: 'Ana', rol: 'admin' } })
    const { unmount } = render(<App repo={admin} />)
    expect(await screen.findByRole('heading', { name: 'Qué hay listo' })).toBeInTheDocument()
    expect(await screen.findByText(/No hay trabajos/)).toBeInTheDocument()
    unmount()
    render(<App repo={crearMemoryRepo({ usuario: { id: 'u1', nombre: 'Pedro', rol: 'chofer' } })} />)
    expect(await screen.findByRole('button', { name: 'Hoja de ruta' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Qué hay listo' })).not.toBeInTheDocument()
  })

  it('la secretaria abre el reporte diario, con un solo título', async () => {
    const repo = crearMemoryRepo({ usuario: { id: 'u3', nombre: 'Sofía', rol: 'secretaria' } })
    render(<App repo={repo} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Reporte diario' }))
    expect(await screen.findByRole('button', { name: 'Imprimir' })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { name: 'Reporte diario' })).toHaveLength(1)
    expect(screen.queryByText('Próximamente.')).not.toBeInTheDocument()
  })
})
