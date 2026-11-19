import { describe, expect, it } from 'vitest'
import { replenishmentDefaults, selectReplenishmentProduct } from './replenishment'

const products = [
  { id: 'product-a', supplierId: 'supplier-a' },
  { id: 'product-b', supplierId: 'supplier-b' },
  { id: 'product-c', supplierId: null },
]

describe('formulario de reabastecimiento', () => {
  it('usa exactamente el producto, proveedor y alerta desde la que se abrió', () => {
    expect(replenishmentDefaults(products, {
      id: 'alert-b',
      product: products[1],
    })).toEqual({
      productId: 'product-b',
      supplierId: 'supplier-b',
      alertId: 'alert-b',
    })
  })

  it('no inventa un proveedor para un producto que no tiene uno asociado', () => {
    expect(replenishmentDefaults(products, {
      id: 'alert-c',
      product: products[2],
    })).toEqual({
      productId: 'product-c',
      supplierId: '',
      alertId: 'alert-c',
    })
  })

  it('limpia la alerta y actualiza el proveedor al cambiar de producto', () => {
    expect(selectReplenishmentProduct(products, 'product-a')).toEqual({
      productId: 'product-a',
      supplierId: 'supplier-a',
      alertId: '',
    })
  })
})
