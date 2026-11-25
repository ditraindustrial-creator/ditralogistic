type CryptoMinimo = Partial<Pick<Crypto, 'randomUUID' | 'getRandomValues'>>

/**
 * Clave de idempotencia (uuid v4) para una solicitud: la app genera una por formulario abierto y la
 * reenvía en cada reintento, así la base no duplica un trabajo ni una entrega si se perdió la
 * respuesta. `crypto.randomUUID` solo existe en contextos seguros (https); si falta se arma con
 * `getRandomValues`, y en último caso con Math.random (suficiente: solo debe no repetirse).
 */
export function nuevaClave(c: CryptoMinimo | undefined = globalThis.crypto): string {
  if (c?.randomUUID) return c.randomUUID()
  const b = new Uint8Array(16)
  if (c?.getRandomValues) c.getRandomValues(b)
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256)
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
