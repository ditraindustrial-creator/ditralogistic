import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Recepcion from './Recepcion'
import { crearMemoryRepo } from '../../data/memoryRepo'
import type { Repo } from '../../data/repo'
import { errorDeCliente } from '../../data/supabaseRepo'
import type { Etapa, Linea, Trabajo, UsuarioActual } from '../../dominio/tipos'

const etapas: Etapa[] = [
  { id: 'a2', area: 'afilado', orden: 2, nombre: 'En taller', esListo: false, esFinal: false },
  { id: 'a1', area: 'afilado', orden: 1, nombre: 'Recibido', esListo: false, esFinal: false },
  { id: 'b1', area: 'encuadernacion', orden: 1, nombre: 'Recibido', esListo: false, esFinal: false },
]
const secretaria: UsuarioActual = { id: 'u1', nombre: 'Sec', rol: 'secretaria' }
const chofer: UsuarioActual = { id: 'u2', nombre: 'Pedro', rol: 'chofer' }

function montar(usuario: UsuarioActual = secretaria, envolver?: (r: Repo) => Repo, props: Partial<Parameters<typeof Recepcion>[0]> = {}) {
  const trabajos: Trabajo[] = []
  const lineas: Linea[] = []
  const base = crearMemoryRepo({
    usuario, etapas, trabajos, lineas,
    clientes: [
      { id: 'c1', nombre: 'Imprenta Sur Ltda.', rut: '76123456-7', recorridoId: null },
      { id: 'c2', nombre: 'Ñandú SpA', rut: '12345678-5', recorridoId: null },
    ],
    productos: [
      { id: 'p1', codigo: 'CU-20', nombre: 'Cuchillo 20 cm', area: 'afilado' },
      { id: 'p2', codigo: 'LI-1', nombre: 'Libro tapa dura', area: 'encuadernacion' },
    ],
  })
  const repo = envolver ? envolver(base) : base
  render(<Recepcion repo={repo} usuario={usuario} {...props} />)
  return { repo, trabajos, lineas }
}

async function elegirCliente(texto: string, nombre: RegExp) {
  await userEvent.type(await screen.findByLabelText('Cliente'), texto)
  await userEvent.click(await screen.findByRole('button', { name: nombre }))
}

describe('Recepcion', () => {
  it('elige cliente, agrega dos líneas y guarda: una sola llamada, muestra el número y las unidades quedan en la primera etapa', async () => {
    const espiar = vi.fn()
    const { repo, trabajos, lineas } = montar(secretaria, (r) => ({
      ...r,
      crearTrabajo: (d) => { espiar(d); return r.crearTrabajo(d) },
    }))
    await elegirCliente('imp', /Imprenta Sur/)
    await userEvent.type(screen.getByLabelText('Producto línea 1'), 'Cuchillo 20 cm')
    await userEvent.type(screen.getByLabelText('Cantidad línea 1'), '12')
    await userEvent.click(screen.getByRole('button', { name: 'Agregar línea' }))
    await userEvent.type(screen.getByLabelText('Producto línea 2'), 'Tijera de sastre')
    await userEvent.type(screen.getByLabelText('Cantidad línea 2'), '3')
    await userEvent.click(screen.getByLabelText('Urgente'))
    await userEvent.type(screen.getByLabelText('Guía de retiro (opcional)'), 'G-77')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar trabajo' }))

    expect(await screen.findByText('Trabajo N.º 1 guardado')).toBeInTheDocument()
    expect(espiar).toHaveBeenCalledTimes(1)
    expect(espiar).toHaveBeenCalledWith({
      clienteId: 'c1', area: 'afilado', entrada: 'cliente', urgente: true, guiaRetiro: 'G-77',
      lineas: [{ producto: 'Cuchillo 20 cm', cantidad: 12 }, { producto: 'Tijera de sastre', cantidad: 3 }],
    })
    expect(trabajos).toHaveLength(1)
    expect(lineas).toHaveLength(2)
    // Las 12 unidades están en la primera etapa (Recibido, orden 1): salen de ahí y no de otra.
    await expect(repo.moverUnidades(lineas[0].id, 12, 'a1', 'a2')).resolves.toMatchObject({ cantidad: 12 })
  })

  it('el cliente se busca por RUT (con o sin puntos) y por nombre sin tildes', async () => {
    montar()
    const caja = await screen.findByLabelText('Cliente')
    await userEvent.type(caja, '12.345.678')
    expect(await screen.findByRole('button', { name: /Ñandú SpA/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Imprenta/ })).not.toBeInTheDocument()
    await userEvent.clear(caja)
    await userEvent.type(caja, 'nandu')
    await userEvent.click(await screen.findByRole('button', { name: /Ñandú SpA/ }))
    expect(screen.getByText('Ñandú SpA')).toBeInTheDocument()
    expect(screen.queryByLabelText('Cliente')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cambiar cliente' }))
    expect(screen.getByLabelText('Cliente')).toBeInTheDocument()
  })

  it('sin cliente o con cantidad inválida muestra los errores en español y no guarda', async () => {
    const espiar = vi.fn()
    montar(secretaria, (r) => ({ ...r, crearTrabajo: (d) => { espiar(d); return r.crearTrabajo(d) } }))
    await userEvent.type(await screen.findByLabelText('Producto línea 1'), 'Cuchillo')
    await userEvent.type(screen.getByLabelText('Cantidad línea 1'), '0')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar trabajo' }))
    const alerta = await screen.findByRole('alert')
    expect(within(alerta).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Elige el cliente.',
      'La cantidad de la línea 1 debe ser un número entero mayor que cero.',
    ])
    expect(espiar).not.toHaveBeenCalled()
  })

  it('una cantidad con decimales o letras no se guarda', async () => {
    montar()
    await elegirCliente('imp', /Imprenta Sur/)
    await userEvent.type(screen.getByLabelText('Producto línea 1'), 'Cuchillo')
    await userEvent.type(screen.getByLabelText('Cantidad línea 1'), '1,5')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar trabajo' }))
    expect(await screen.findByText('La cantidad de la línea 1 debe ser un número entero mayor que cero.')).toBeInTheDocument()
  })

  it('el chofer parte con "Ruta propia" y el resto con "Lo trajo el cliente"', async () => {
    montar(chofer)
    expect(await screen.findByLabelText('Ruta propia (retiro)')).toBeChecked()
  })

  it('para el resto, la modalidad inicial es "Lo trajo el cliente"', async () => {
    montar()
    expect(await screen.findByLabelText('Lo trajo el cliente')).toBeChecked()
  })

  it('el área cambia las sugerencias del catálogo', async () => {
    montar()
    await screen.findByLabelText('Cliente')
    const opciones = () => Array.from(document.querySelectorAll('datalist option')).map((o) => (o as HTMLOptionElement).value)
    expect(opciones()).toEqual(['Cuchillo 20 cm'])
    await userEvent.click(screen.getByLabelText('Encuadernación'))
    expect(opciones()).toEqual(['Libro tapa dura'])
  })

  it('se puede quitar una línea pero siempre queda al menos una', async () => {
    montar()
    await userEvent.click(await screen.findByRole('button', { name: 'Agregar línea' }))
    await userEvent.click(screen.getByRole('button', { name: 'Quitar línea 2' }))
    expect(screen.queryByLabelText('Producto línea 2')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Quitar línea 1' })).not.toBeInTheDocument()
  })

  it('doble toque en Guardar crea un solo trabajo', async () => {
    const espiar = vi.fn()
    const { trabajos } = montar(secretaria, (r) => ({
      ...r,
      crearTrabajo: async (d) => { espiar(d); await new Promise((ok) => setTimeout(ok, 20)); return r.crearTrabajo(d) },
    }))
    await elegirCliente('imp', /Imprenta Sur/)
    await userEvent.type(screen.getByLabelText('Producto línea 1'), 'Cuchillo')
    await userEvent.type(screen.getByLabelText('Cantidad línea 1'), '2')
    const guardar = screen.getByRole('button', { name: 'Guardar trabajo' })
    await userEvent.dblClick(guardar)
    expect(await screen.findByText('Trabajo N.º 1 guardado')).toBeInTheDocument()
    expect(espiar).toHaveBeenCalledTimes(1)
    expect(trabajos).toHaveLength(1)
  })

  it('un error de regla se muestra tal cual y conserva lo escrito; uno técnico se reemplaza por un mensaje genérico', async () => {
    let n = 0
    montar(secretaria, (r) => ({
      ...r,
      crearTrabajo: async () => {
        if (n++ === 0) throw new Error('relation "trabajos" does not exist')
        return r.crearTrabajo({ clienteId: 'zzz', area: 'afilado', entrada: 'cliente', lineas: [{ producto: 'x', cantidad: 1 }] })
      },
    }))
    await elegirCliente('imp', /Imprenta Sur/)
    await userEvent.type(screen.getByLabelText('Producto línea 1'), 'Cuchillo')
    await userEvent.type(screen.getByLabelText('Cantidad línea 1'), '2')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar trabajo' }))
    expect(await screen.findByText('No se pudo guardar el trabajo. Revisa tu conexión e inténtalo de nuevo.')).toBeInTheDocument()
    expect(screen.queryByText(/relation/)).not.toBeInTheDocument()
    expect(screen.getByLabelText('Producto línea 1')).toHaveValue('Cuchillo')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar trabajo' }))
    expect(await screen.findByText('El cliente no existe.')).toBeInTheDocument()
  })

  it('"Recibir otro trabajo" deja el formulario vacío', async () => {
    montar()
    await elegirCliente('imp', /Imprenta Sur/)
    await userEvent.type(screen.getByLabelText('Producto línea 1'), 'Cuchillo')
    await userEvent.type(screen.getByLabelText('Cantidad línea 1'), '2')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar trabajo' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Recibir otro trabajo' }))
    expect(await screen.findByLabelText('Cliente')).toHaveValue('')
    expect(screen.getByLabelText('Producto línea 1')).toHaveValue('')
  })

  it('si no cargan los clientes avisa en español', async () => {
    const repo = { ...crearMemoryRepo({ usuario: secretaria }), listarClientes: () => Promise.reject(new Error('boom')) }
    render(<Recepcion repo={repo} usuario={secretaria} />)
    expect(await screen.findByText('No se pudieron cargar los clientes. Revisa tu conexión.')).toBeInTheDocument()
  })

  describe('dentro de la hoja del chofer (clienteInicial y onCreado)', () => {
    const cliente = { id: 'c1', nombre: 'Imprenta Sur Ltda.', rut: '76123456-7', recorridoId: null }

    it('arranca con el cliente elegido y la modalidad ruta propia, también para gestión', async () => {
      montar(secretaria, undefined, { clienteInicial: cliente })
      expect(await screen.findByText('Imprenta Sur Ltda.')).toBeInTheDocument()
      expect(screen.queryByLabelText('Cliente')).not.toBeInTheDocument()
      expect(screen.getByLabelText('Ruta propia (retiro)')).toBeChecked()
    })

    it('guarda con entrada ruta_propia y avisa con onCreado una sola vez', async () => {
      const espiar = vi.fn()
      const onCreado = vi.fn()
      montar(secretaria, (r) => ({ ...r, crearTrabajo: (d) => { espiar(d); return r.crearTrabajo(d) } }), { clienteInicial: cliente, onCreado })
      await userEvent.type(screen.getByLabelText('Producto línea 1'), 'Cuchillo 20 cm')
      await userEvent.type(screen.getByLabelText('Cantidad línea 1'), '3')
      await userEvent.click(screen.getByRole('button', { name: 'Guardar trabajo' }))
      expect(await screen.findByText(/Trabajo N\.º \d+ guardado/)).toBeInTheDocument()
      expect(espiar).toHaveBeenCalledWith(expect.objectContaining({ clienteId: 'c1', entrada: 'ruta_propia' }))
      expect(onCreado).toHaveBeenCalledTimes(1)
      expect(onCreado).toHaveBeenCalledWith(expect.objectContaining({ clienteId: 'c1', entrada: 'ruta_propia' }))
    })

    it('"Recibir otro trabajo" vuelve al mismo cliente', async () => {
      montar(secretaria, undefined, { clienteInicial: cliente })
      await userEvent.type(screen.getByLabelText('Producto línea 1'), 'Cuchillo 20 cm')
      await userEvent.type(screen.getByLabelText('Cantidad línea 1'), '3')
      await userEvent.click(screen.getByRole('button', { name: 'Guardar trabajo' }))
      await userEvent.click(await screen.findByRole('button', { name: 'Recibir otro trabajo' }))
      expect(screen.getByText('Imprenta Sur Ltda.')).toBeInTheDocument()
      expect(screen.getByLabelText('Ruta propia (retiro)')).toBeChecked()
    })
  })
})

describe('Recepcion: reintentos sin duplicar', () => {
  async function llenar() {
    await elegirCliente('imp', /Imprenta Sur/)
    await userEvent.type(screen.getByLabelText('Producto línea 1'), 'Cuchillo')
    await userEvent.type(screen.getByLabelText('Cantidad línea 1'), '2')
  }
  it('respuesta perdida: el reintento reusa la clave y queda un solo trabajo', async () => {
    const claves: (string | undefined)[] = []
    let perder = true
    const { trabajos } = montar(secretaria, (r) => ({
      ...r,
      crearTrabajo: async (d, clave) => {
        claves.push(clave)
        const t = await r.crearTrabajo(d, clave)
        if (perder) {
          perder = false
          throw new Error('Failed to fetch') // el trabajo quedó creado, pero la respuesta no llegó
        }
        return t
      },
    }))
    await llenar()
    await userEvent.click(screen.getByRole('button', { name: 'Guardar trabajo' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo guardar el trabajo. Revisa tu conexión e inténtalo de nuevo.')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar trabajo' }))
    expect(await screen.findByText('Trabajo N.º 1 guardado')).toBeInTheDocument()
    expect(claves).toHaveLength(2)
    expect(claves[1]).toBe(claves[0])
    expect(trabajos).toHaveLength(1)
  })
  it('"Recibir otro trabajo" usa una clave nueva', async () => {
    const claves: (string | undefined)[] = []
    const { trabajos } = montar(secretaria, (r) => ({ ...r, crearTrabajo: (d, clave) => (claves.push(clave), r.crearTrabajo(d, clave)) }))
    await llenar()
    await userEvent.click(screen.getByRole('button', { name: 'Guardar trabajo' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Recibir otro trabajo' }))
    await llenar()
    await userEvent.click(screen.getByRole('button', { name: 'Guardar trabajo' }))
    expect(await screen.findByText('Trabajo N.º 2 guardado')).toBeInTheDocument()
    expect(claves[1]).not.toBe(claves[0])
    expect(trabajos).toHaveLength(2)
  })
})

describe('Recepcion: cliente nuevo', () => {
  it('si la búsqueda no encuentra, "Cliente nuevo" crea el cliente (prellenado) y queda elegido para el trabajo', async () => {
    const { repo, trabajos } = montar()
    await userEvent.type(await screen.findByLabelText('Cliente'), 'Ferretería Norte')
    expect(screen.getByText('No hay clientes con ese nombre o RUT.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cliente nuevo' }))
    const form = screen.getByRole('form', { name: 'Cliente nuevo' })
    expect(within(form).getByLabelText('Nombre')).toHaveValue('Ferretería Norte')
    await userEvent.type(within(form).getByLabelText('RUT'), '9.876.543-3')
    await userEvent.type(within(form).getByLabelText('Dirección (opcional)'), 'Av. Siempre 1')
    await userEvent.click(within(form).getByRole('button', { name: 'Guardar cliente' }))
    expect(await screen.findByText('Ferretería Norte')).toBeInTheDocument()
    expect(screen.getByText('9876543-3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cambiar cliente' })).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Producto línea 1'), 'Cuchillo')
    await userEvent.type(screen.getByLabelText('Cantidad línea 1'), '1')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar trabajo' }))
    await screen.findByText('Trabajo N.º 1 guardado')
    const nuevo = (await repo.listarClientes()).find((c) => c.rut === '9876543-3')!
    expect(nuevo).toMatchObject({ nombre: 'Ferretería Norte', direccion: 'Av. Siempre 1', recorridoId: null })
    expect(trabajos[0].clienteId).toBe(nuevo.id)
  })

  it('un RUT escrito en el buscador prellena el RUT; RUT repetido o inválido dan mensajes en español', async () => {
    montar()
    await userEvent.type(await screen.findByLabelText('Cliente'), '11.111.111-1')
    await userEvent.click(screen.getByRole('button', { name: 'Cliente nuevo' }))
    const form = screen.getByRole('form', { name: 'Cliente nuevo' })
    expect(within(form).getByLabelText('RUT')).toHaveValue('11.111.111-1')
    await userEvent.clear(within(form).getByLabelText('RUT'))
    await userEvent.type(within(form).getByLabelText('RUT'), '76.123.456-7')
    await userEvent.type(within(form).getByLabelText('Nombre'), 'Otra imprenta')
    await userEvent.click(within(form).getByRole('button', { name: 'Guardar cliente' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Ya existe un cliente con ese RUT.')
    await userEvent.clear(within(form).getByLabelText('RUT'))
    await userEvent.type(within(form).getByLabelText('RUT'), 'abc')
    await userEvent.click(within(form).getByRole('button', { name: 'Guardar cliente' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('El RUT "abc" no es válido.')
  })

  it('si la base rechaza por RUT repetido (otro celular lo creó recién), el mensaje es amable y no técnico', async () => {
    montar(secretaria, (r) => ({
      ...r,
      crearCliente: () => Promise.reject(errorDeCliente({ code: '23505', message: 'duplicate key value violates unique constraint "clientes_rut_unico"' })),
    }))
    await userEvent.click(await screen.findByRole('button', { name: 'Cliente nuevo' }))
    const form = screen.getByRole('form', { name: 'Cliente nuevo' })
    await userEvent.type(within(form).getByLabelText('Nombre'), 'X')
    await userEvent.type(within(form).getByLabelText('RUT'), '5-1')
    await userEvent.click(within(form).getByRole('button', { name: 'Guardar cliente' }))
    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent('Ya existe un cliente con ese RUT. Búscalo por nombre o RUT en vez de crearlo de nuevo.')
    expect(alerta).not.toHaveTextContent('duplicate')
  })

  it('el chofer también crea clientes, con recorrido opcional; Cancelar vuelve al buscador', async () => {
    const usuario = chofer
    const base = crearMemoryRepo({
      usuario, etapas, clientes: [],
      recorridos: [{ id: 'r1', nombre: 'Norte', dia: 2, camioneta: 'A', lejano: false }],
    })
    render(<Recepcion repo={base} usuario={usuario} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Cliente nuevo' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.getByLabelText('Cliente')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cliente nuevo' }))
    const form = screen.getByRole('form', { name: 'Cliente nuevo' })
    await userEvent.type(within(form).getByLabelText('Nombre'), 'Taller Sur')
    await userEvent.type(within(form).getByLabelText('RUT'), '5-1')
    await userEvent.selectOptions(await within(form).findByLabelText('Recorrido (opcional)'), await within(form).findByRole('option', { name: 'Norte (martes)' }))
    await userEvent.click(within(form).getByRole('button', { name: 'Guardar cliente' }))
    expect(await screen.findByText('Taller Sur')).toBeInTheDocument()
    expect((await base.listarClientes())[0]).toMatchObject({ rut: '5-1', recorridoId: 'r1' })
  })

  it('sin clientes cargados lo dice y ofrece crear uno', async () => {
    render(<Recepcion repo={crearMemoryRepo({ usuario: secretaria, etapas })} usuario={secretaria} />)
    expect(await screen.findByText('Aún no hay clientes cargados. Crea uno con «Cliente nuevo».')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cliente nuevo' })).toBeInTheDocument()
  })

  it('un rol que no crea clientes no ve el botón', async () => {
    const op: UsuarioActual = { id: 'o', nombre: 'Op', rol: 'operario_afilado' }
    render(<Recepcion repo={crearMemoryRepo({ usuario: op, etapas })} usuario={op} />)
    expect(await screen.findByText('Aún no hay clientes cargados.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cliente nuevo' })).not.toBeInTheDocument()
  })
})
