import { PrismaClient } from '@prisma/client'
import { randomBytes, scryptSync } from 'node:crypto'

if (process.env.NODE_ENV === 'production') {
  throw new Error('Las cuentas demo solo se pueden crear fuera de producción.')
}

const prisma = new PrismaClient()
const demoPassword = 'StocklyDemo2026!'
const passwordHash = (password: string) => {
  const salt = randomBytes(16).toString('hex')
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`
}

try {
  const business = await prisma.business.findFirst({ where: { name: 'STOCKLY Demo' } })
    ?? await prisma.business.create({ data: { name: 'STOCKLY Demo' } })

  const accounts = [
    { name: 'Admin Demo', email: 'admin@stockly.test', role: 'ADMIN' as const },
    { name: 'Empleado Demo', email: 'empleado@stockly.test', role: 'EMPLOYEE' as const },
  ]

  for (const account of accounts) {
    await prisma.user.upsert({
      where: { email: account.email },
      create: { ...account, businessId: business.id, passwordHash: passwordHash(demoPassword) },
      update: { ...account, businessId: business.id, passwordHash: passwordHash(demoPassword) },
    })
  }

  console.log('Cuentas demo listas:')
  console.log('Admin: admin@stockly.test / StocklyDemo2026!')
  console.log('Empleado: empleado@stockly.test / StocklyDemo2026!')
} finally {
  await prisma.$disconnect()
}
