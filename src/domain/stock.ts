export function nextQuantity(current: number, movement: 'ENTRY' | 'EXIT', quantity: number): number {
  if (!Number.isInteger(current) || current < 0 || !Number.isInteger(quantity) || quantity <= 0) throw new RangeError('Existencias y cantidad deben ser enteros válidos')
  const next = movement === 'ENTRY' ? current + quantity : current - quantity
  if (next < 0) throw new RangeError('La salida supera las existencias disponibles')
  return next
}

export function reachedMinimum(quantity: number, minimum: number): boolean {
  return quantity <= minimum
}

export function stockAccuracy(system: number, physical: number): number {
  if (!Number.isInteger(system) || system < 0 || !Number.isInteger(physical) || physical < 0) throw new RangeError('Las cantidades deben ser enteros no negativos')
  if (physical === 0) return system === 0 ? 1 : 0
  return Math.max(0, 1 - Math.abs(physical - system) / physical)
}
