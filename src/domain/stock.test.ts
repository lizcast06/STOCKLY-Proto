import { describe, expect, it } from 'vitest'
import { nextQuantity, reachedMinimum, stockAccuracy } from './stock'

describe('inventario', () => {
  it('suma entradas y evita salidas que dejen existencias negativas', () => {
    expect(nextQuantity(8, 'ENTRY', 3)).toBe(11)
    expect(nextQuantity(8, 'EXIT', 8)).toBe(0)
    expect(() => nextQuantity(3, 'EXIT', 4)).toThrow(RangeError)
  })
  it('considera crítico el stock igual al mínimo', () => {
    expect(reachedMinimum(10, 10)).toBe(true)
    expect(reachedMinimum(11, 10)).toBe(false)
  })
  it('calcula exactitud de conteo físico, incluidos conteos en cero', () => {
    expect(stockAccuracy(98, 100)).toBeCloseTo(0.98)
    expect(stockAccuracy(4, 0)).toBe(0)
    expect(stockAccuracy(0, 0)).toBe(1)
  })
})
