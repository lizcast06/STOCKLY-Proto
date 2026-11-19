export type ReplenishmentProductOption = {
  id: string
  supplierId?: string | null
}

export type ReplenishmentAlertOption = {
  id: string
  product: ReplenishmentProductOption
}

export function replenishmentDefaults(
  products: ReplenishmentProductOption[],
  sourceAlert?: ReplenishmentAlertOption | null,
) {
  const product = sourceAlert?.product ?? products[0]

  return {
    productId: product?.id ?? '',
    supplierId: product?.supplierId ?? '',
    alertId: sourceAlert?.id ?? '',
  }
}

export function selectReplenishmentProduct(
  products: ReplenishmentProductOption[],
  productId: string,
) {
  const product = products.find(candidate => candidate.id === productId)

  return {
    productId,
    supplierId: product?.supplierId ?? '',
    alertId: '',
  }
}
