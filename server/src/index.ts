import cors from 'cors'
import express, { type NextFunction, type Request, type Response } from 'express'
import swaggerUi from 'swagger-ui-express'
import { Prisma, PrismaClient, type Role } from '@prisma/client'
import { z } from 'zod'
import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import os from 'node:os'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { nextQuantity, reachedMinimum, stockAccuracy } from '../../src/domain/stock.js'

const localEnv = join(process.cwd(), '.env')
if (existsSync(localEnv)) for (const line of readFileSync(localEnv, 'utf8').split(/\r?\n/)) {
  const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
  if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^(["'])(.*)\1$/, '$2')
}

const prisma = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] })
let dbQueryCount = 0, dbQueryLatency = 0, slowDbQueryCount = 0
prisma.$on('query', event => { dbQueryCount++; dbQueryLatency += event.duration; if (event.duration >= 250) slowDbQueryCount++ })
const app = express()
const cookieName = 'stockly_session'
const refreshCookieName = 'stockly_refresh'
const authSecret = process.env.AUTH_SECRET ?? 'local-only-stockly-secret-change-before-deploy'
const isProd = process.env.NODE_ENV === 'production'
if (isProd && authSecret === 'local-only-stockly-secret-change-before-deploy') throw new Error('AUTH_SECRET is required in production')
app.disable('x-powered-by')
app.use((_req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin'); next() })
app.use(cors({ origin: process.env.WEB_ORIGIN ?? 'http://localhost:5173', credentials: true }))
app.use(express.json({ limit: '100kb' }))
app.use((req, _res, next) => {
  const header = req.headers.cookie ?? ''
  const cookies = Object.fromEntries(header.split(';').filter(Boolean).map(part => { const index = part.indexOf('='); return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())] }))
  Object.assign(req, { cookies })
  next()
})
const openApiSpec = {
  openapi: '3.1.0', info: { title: 'STOCKLY API', version: '0.1.0', description: 'API REST de inventario para PyMEs. Las rutas protegidas usan la cookie de sesión HttpOnly.' },
  servers: [{ url: '/' }], components: { securitySchemes: { stocklySession: { type: 'apiKey', in: 'cookie', name: 'stockly_session' } } },
  paths: {
    '/api/health': { get: { summary: 'Comprobar API y PostgreSQL', responses: { '200': { description: 'Servicios disponibles' }, '503': { description: 'Base de datos no disponible' } } } },
    '/api/auth/register': { post: { summary: 'Crear negocio y cuenta administradora', responses: { '201': { description: 'Cuenta creada y sesión iniciada' }, '409': { description: 'Correo ya registrado' } } } },
    '/api/auth/login': { post: { summary: 'Iniciar sesión', responses: { '200': { description: 'Sesión iniciada' }, '401': { description: 'Credenciales inválidas' } } } },
    '/api/auth/refresh': { post: { summary: 'Renovar access token y rotar refresh token', responses: { '200': { description: 'Sesión renovada' }, '401': { description: 'Refresh token vencido o ya utilizado' } } } },
    '/api/auth/logout': { post: { summary: 'Cerrar sesión', security: [{ stocklySession: [] }], responses: { '204': { description: 'Sesión cerrada' } } } },
    '/api/auth/me': { get: { summary: 'Consultar sesión actual', security: [{ stocklySession: [] }], responses: { '200': { description: 'Usuario autenticado' }, '401': { description: 'Sin sesión' } } } },
    '/api/products': { get: { summary: 'Listar productos del negocio', security: [{ stocklySession: [] }], responses: { '200': { description: 'Catálogo del negocio actual' } } }, post: { summary: 'Crear producto', security: [{ stocklySession: [] }], responses: { '201': { description: 'Producto creado' }, '400': { description: 'Datos inválidos' }, '403': { description: 'Solo administradores' } } } },
    '/api/movements': { get: { summary: 'Consultar historial inmutable', security: [{ stocklySession: [] }], responses: { '200': { description: 'Movimientos del negocio actual' } } }, post: { summary: 'Registrar entrada o salida', security: [{ stocklySession: [] }], responses: { '201': { description: 'Movimiento aplicado' }, '409': { description: 'Existencias insuficientes' } } } },
    '/api/suppliers': { get: { summary: 'Listar proveedores', security: [{ stocklySession: [] }], responses: { '200': { description: 'Proveedores del negocio' } } }, post: { summary: 'Crear proveedor', security: [{ stocklySession: [] }], responses: { '201': { description: 'Proveedor creado' }, '403': { description: 'Solo administradores' } } } },
    '/api/alerts': { get: { summary: 'Listar alertas de inventario', security: [{ stocklySession: [] }], responses: { '200': { description: 'Alertas del negocio' } } } },
    '/api/replenishments': { get: { summary: 'Listar solicitudes de reabastecimiento', security: [{ stocklySession: [] }], responses: { '200': { description: 'Solicitudes del negocio' } } }, post: { summary: 'Crear solicitud de compra', security: [{ stocklySession: [] }], responses: { '201': { description: 'Solicitud creada' } } } },
    '/api/audits': { get: { summary: 'Consultar conteos físicos', security: [{ stocklySession: [] }], responses: { '200': { description: 'Auditorías del negocio' } } }, post: { summary: 'Registrar conteo físico', security: [{ stocklySession: [] }], responses: { '201': { description: 'Exactitud calculada' } } } },
    '/api/reports/metrics': { get: { summary: 'Consultar indicadores operativos', security: [{ stocklySession: [] }], responses: { '200': { description: 'Métricas de alertas, quiebres, exactitud y falsos positivos' } } } },
  },
}
app.get('/api/openapi.json', (_req, res) => res.json(openApiSpec))
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApiSpec))

type Session = { id: string; businessId: string; role: Role; name: string; email: string }
declare global { namespace Express { interface Request { session?: Session; cookies?: Record<string, string> } } }
let requestCount = 0, errorCount = 0, totalLatency = 0, slowCount = 0
const startedAt = Date.now()
app.use((_req, res, next) => { const t = performance.now(); res.on('finish', () => { const ms = performance.now() - t; requestCount++; totalLatency += ms; if (ms > 500) slowCount++; if (res.statusCode >= 500) errorCount++ }); next() })

function sign(payload: object) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const head = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const content = `${head}.${body}`
  return `${content}.${createHmac('sha256', authSecret).update(content).digest('base64url')}`
}
function verify(token: string): Session & { exp: number } {
  const [head, body, signature] = token.split('.')
  if (!head || !body || !signature) throw new Error('Invalid token')
  const content = `${head}.${body}`
  const expected = createHmac('sha256', authSecret).update(content).digest()
  const received = Buffer.from(signature, 'base64url')
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) throw new Error('Invalid token')
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString())
  if (payload.exp < Math.floor(Date.now() / 1000)) throw new Error('Expired token')
  return payload
}
function passwordHash(password: string, salt = randomBytes(16).toString('hex')) {
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`
}
function passwordMatches(password: string, stored: string) {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const actual = scryptSync(password, salt, 64), expected = Buffer.from(hash, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
function hashToken(token: string) { return createHash('sha256').update(token).digest('hex') }
function setSessionCookies(res: Response, user: Session, refreshToken: string) {
  const accessToken = sign({ ...user, exp: Math.floor(Date.now() / 1000) + 15 * 60 })
  res.cookie(cookieName, accessToken, { httpOnly: true, secure: isProd, sameSite: 'lax', maxAge: 15 * 60 * 1000, path: '/' })
  res.cookie(refreshCookieName, refreshToken, { httpOnly: true, secure: isProd, sameSite: 'strict', maxAge: 7 * 24 * 60 * 60 * 1000, path: '/' })
}
async function setSession(res: Response, user: Session) {
  const refreshToken = randomBytes(48).toString('base64url')
  await prisma.user.update({ where: { id: user.id }, data: { refreshTokenHash: hashToken(refreshToken), refreshExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) } })
  setSessionCookies(res, user, refreshToken)
}
function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[cookieName] as string | undefined
  try { if (!token) throw new Error('Missing'); req.session = verify(token); next() }
  catch { res.status(401).json({ error: 'Inicia sesión para continuar' }) }
}
function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.session?.role !== 'ADMIN') return res.status(403).json({ error: 'Esta acción requiere permisos de administradora' })
  next()
}
function route(handler: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => { handler(req, res).catch(next) }
}
const userSession = (user: { id: string; businessId: string; role: Role; name: string; email: string }): Session => ({ id: user.id, businessId: user.businessId, role: user.role, name: user.name, email: user.email })
const registerSchema = z.object({ business: z.string().trim().min(2).max(100), name: z.string().trim().min(2).max(80), email: z.string().trim().email().max(200), password: z.string().min(10).max(100) })
const loginSchema = z.object({ email: z.string().trim().email(), password: z.string().min(1) })
const productSchema = z.object({ sku: z.string().trim().min(1).max(40), name: z.string().trim().min(2).max(120), category: z.string().trim().min(1).max(60), supplierId: z.string().optional().nullable(), unit: z.string().trim().min(1).max(16).default('pz'), quantity: z.number().int().nonnegative(), minStock: z.number().int().nonnegative(), price: z.number().nonnegative() })
const supplierSchema = z.object({ name: z.string().trim().min(2).max(120), email: z.union([z.string().email(), z.literal('')]).optional(), phone: z.string().max(30).optional() })

app.get('/api/health', route(async (_req, res) => {
  let database: 'ok' | 'error' = 'ok', databaseLatencyMs: number | null = null
  const started = performance.now()
  try { await prisma.$queryRaw`SELECT 1`; databaseLatencyMs = Math.round(performance.now() - started) } catch { database = 'error' }
  res.status(database === 'ok' ? 200 : 503).json({ status: database === 'ok' ? 'ok' : 'degraded', service: 'stockly-api', database, databaseLatencyMs })
}))
app.get('/api/monitoring', requireAuth, requireAdmin, route(async (_req, res) => {
  const started = performance.now(); let database = 'ok'
  try { await prisma.$queryRaw`SELECT 1` } catch { database = 'error' }
  let databaseActiveConnections: number | null = null
  try { const rows = await prisma.$queryRaw<{ active: number }[]>`SELECT count(*)::int AS active FROM pg_stat_activity WHERE datname = current_database() AND usename = current_user AND state = 'active'`; databaseActiveConnections = rows[0]?.active ?? 0 } catch { /* El rol puede no tener acceso a pg_stat_activity. */ }
  res.json({ uptimeSeconds: Math.round(process.uptime()), requests: requestCount, requestsPerSecond: Number((requestCount / Math.max(1, (Date.now() - startedAt) / 1000)).toFixed(2)), averageLatencyMs: Number((totalLatency / Math.max(1, requestCount)).toFixed(1)), errors5xx: errorCount, errorRatePercent: Number((100 * errorCount / Math.max(1, requestCount)).toFixed(2)), slowRequestsOver500ms: slowCount, processMemoryBytes: process.memoryUsage(), hostMemory: { totalBytes: os.totalmem(), freeBytes: os.freemem() }, cpuLoadAverage: os.loadavg(), gpu: 'No expuesta por el runtime del servidor', database, databaseLatencyMs: Math.round(performance.now() - started), databaseActiveConnections, databaseQueries: dbQueryCount, averageQueryLatencyMs: Number((dbQueryLatency / Math.max(1, dbQueryCount)).toFixed(1)), slowQueriesOver250ms: slowDbQueryCount })
}))

app.post('/api/auth/register', route(async (req, res) => {
  const parsed = registerSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Revisa los datos. La contraseña debe tener al menos 10 caracteres.', details: parsed.error.flatten() })
  const input = parsed.data
  const email = input.email.toLowerCase()
  const exists = await prisma.user.findFirst({ where: { email } })
  if (exists) return res.status(409).json({ error: 'Ese correo ya está registrado' })
  const user = await prisma.$transaction(async tx => {
    const business = await tx.business.create({ data: { name: input.business } })
    return tx.user.create({ data: { businessId: business.id, name: input.name, email, passwordHash: passwordHash(input.password), role: 'ADMIN' } })
  })
  const session = userSession(user); await setSession(res, session); res.status(201).json({ user: session })
}))
app.post('/api/auth/login', route(async (req, res) => {
  const parsed = loginSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Correo o contraseña inválidos' })
  const user = await prisma.user.findFirst({ where: { email: parsed.data.email.toLowerCase() } })
  if (!user || !passwordMatches(parsed.data.password, user.passwordHash)) return res.status(401).json({ error: 'Correo o contraseña inválidos' })
  const session = userSession(user); await setSession(res, session); res.json({ user: session })
}))
app.post('/api/auth/refresh', route(async (req, res) => {
  const refreshToken = req.cookies?.[refreshCookieName]
  if (!refreshToken) return res.status(401).json({ error: 'La sesión expiró' })
  const currentHash = hashToken(refreshToken)
  const user = await prisma.user.findFirst({ where: { refreshTokenHash: currentHash, refreshExpiresAt: { gt: new Date() } } })
  if (!user) return res.status(401).json({ error: 'La sesión expiró' })
  const nextRefreshToken = randomBytes(48).toString('base64url')
  const nextRefreshExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  const rotated = await prisma.user.updateMany({ where: { id: user.id, refreshTokenHash: currentHash, refreshExpiresAt: { gt: new Date() } }, data: { refreshTokenHash: hashToken(nextRefreshToken), refreshExpiresAt: nextRefreshExpiry } })
  if (!rotated.count) return res.status(401).json({ error: 'La sesión ya se renovó en otro dispositivo' })
  const session = userSession(user); setSessionCookies(res, session, nextRefreshToken); res.json({ user: session })
}))
app.post('/api/auth/logout', route(async (req, res) => {
  const refreshToken = req.cookies?.[refreshCookieName]
  if (refreshToken) await prisma.user.updateMany({ where: { refreshTokenHash: hashToken(refreshToken) }, data: { refreshTokenHash: null, refreshExpiresAt: null } })
  res.clearCookie(cookieName, { httpOnly: true, secure: isProd, sameSite: 'lax', path: '/' })
  res.clearCookie(refreshCookieName, { httpOnly: true, secure: isProd, sameSite: 'strict', path: '/' })
  res.status(204).end()
}))
app.get('/api/auth/me', requireAuth, (req, res) => res.json({ user: req.session }))
app.get('/api/users', requireAuth, requireAdmin, route(async (req, res) => res.json(await prisma.user.findMany({ where: { businessId: req.session!.businessId }, select: { id: true, name: true, email: true, role: true, createdAt: true }, orderBy: { createdAt: 'asc' } }))))
app.post('/api/users', requireAuth, requireAdmin, route(async (req, res) => {
  const parsed = z.object({ name: z.string().trim().min(2).max(80), email: z.string().trim().email(), password: z.string().min(10).max(100), role: z.enum(['ADMIN', 'EMPLOYEE']) }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Datos de usuario inválidos', details: parsed.error.flatten() })
  const data = parsed.data
  try { const user = await prisma.user.create({ data: { businessId: req.session!.businessId, name: data.name, email: data.email.toLowerCase(), passwordHash: passwordHash(data.password), role: data.role }, select: { id: true, name: true, email: true, role: true } }); res.status(201).json(user) }
  catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return res.status(409).json({ error: 'Ese correo ya está registrado en este negocio' }); throw error }
}))

app.get('/api/products', requireAuth, route(async (req, res) => {
  const products = await prisma.product.findMany({ where: { businessId: req.session!.businessId, active: true }, include: { category: true, supplier: true }, orderBy: { name: 'asc' } })
  res.json(products)
}))
app.post('/api/products', requireAuth, requireAdmin, route(async (req, res) => {
  const parsed = productSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Datos de producto inválidos', details: parsed.error.flatten() })
  const data = parsed.data, businessId = req.session!.businessId
  const category = await prisma.category.upsert({ where: { businessId_name: { businessId, name: data.category } }, create: { businessId, name: data.category }, update: {} })
  const supplierId = data.supplierId || null
  if (supplierId && !await prisma.supplier.findFirst({ where: { id: supplierId, businessId } })) return res.status(400).json({ error: 'El proveedor no pertenece a este negocio' })
  try {
    const product = await prisma.product.create({ data: { businessId, sku: data.sku, name: data.name, categoryId: category.id, supplierId, unit: data.unit, quantity: data.quantity, minStock: data.minStock, price: data.price }, include: { category: true, supplier: true } })
    if (product.quantity <= product.minStock) await prisma.alert.create({ data: { businessId, productId: product.id } })
    res.status(201).json(product)
  } catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return res.status(409).json({ error: 'Ya existe un producto con ese SKU' }); throw error }
}))
app.patch('/api/products/:id', requireAuth, requireAdmin, route(async (req, res) => {
  const parsed = productSchema.partial().safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Datos de producto inválidos', details: parsed.error.flatten() })
  const businessId = req.session!.businessId
  const existing = await prisma.product.findFirst({ where: { id: String(req.params.id), businessId, active: true } })
  if (!existing) return res.status(404).json({ error: 'Producto no encontrado' })
  const { category, quantity, ...fields } = parsed.data
  const categoryData = category ? await prisma.category.upsert({ where: { businessId_name: { businessId, name: category } }, create: { businessId, name: category }, update: {} }) : undefined
  const product = await prisma.$transaction(async tx => {
    if (quantity !== undefined && quantity !== existing.quantity) {
      const changed = await tx.product.updateMany({ where: { id: existing.id, businessId, quantity: existing.quantity }, data: { quantity } })
      if (!changed.count) throw Object.assign(new Error('Las existencias cambiaron mientras editabas. Recarga y vuelve a intentar.'), { status: 409 })
      await tx.movement.create({ data: { businessId, productId: existing.id, userId: req.session!.id, type: 'ADJUSTMENT', quantity, beforeQty: existing.quantity, afterQty: quantity, reason: 'Ajuste de inventario desde edición de producto' } })
    }
    return tx.product.update({ where: { id: existing.id }, data: { ...fields, ...(categoryData ? { categoryId: categoryData.id } : {}) }, include: { category: true, supplier: true } })
  })
  if (product.quantity <= product.minStock) await prisma.alert.upsert({ where: { id: (await prisma.alert.findFirst({ where: { businessId, productId: product.id, status: 'OPEN' }, select: { id: true } }))?.id ?? '__none__' }, create: { businessId, productId: product.id }, update: {} })
  res.json(product)
}))
app.delete('/api/products/:id', requireAuth, requireAdmin, route(async (req, res) => {
  const result = await prisma.product.updateMany({ where: { id: String(req.params.id), businessId: req.session!.businessId }, data: { active: false } })
  res.status(result.count ? 204 : 404).end()
}))

app.get('/api/categories', requireAuth, route(async (req, res) => res.json(await prisma.category.findMany({ where: { businessId: req.session!.businessId }, orderBy: { name: 'asc' } }))))
app.get('/api/suppliers', requireAuth, route(async (req, res) => res.json(await prisma.supplier.findMany({ where: { businessId: req.session!.businessId }, include: { _count: { select: { products: true, requests: true } } }, orderBy: { name: 'asc' } }))))
app.post('/api/suppliers', requireAuth, requireAdmin, route(async (req, res) => {
  const parsed = supplierSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: 'Datos de proveedor inválidos', details: parsed.error.flatten() })
  const supplier = await prisma.supplier.create({ data: { businessId: req.session!.businessId, ...parsed.data } }); res.status(201).json(supplier)
}))
app.patch('/api/suppliers/:id', requireAuth, requireAdmin, route(async (req, res) => {
  const parsed = supplierSchema.partial().safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: 'Datos de proveedor inválidos', details: parsed.error.flatten() })
  const updated = await prisma.supplier.updateMany({ where: { id: String(req.params.id), businessId: req.session!.businessId }, data: parsed.data }); if (!updated.count) return res.status(404).json({ error: 'Proveedor no encontrado' })
  res.json(await prisma.supplier.findFirst({ where: { id: String(req.params.id), businessId: req.session!.businessId } }))
}))
app.delete('/api/suppliers/:id', requireAuth, requireAdmin, route(async (req, res) => {
  const supplier = await prisma.supplier.findFirst({ where: { id: String(req.params.id), businessId: req.session!.businessId }, include: { _count: { select: { products: true, requests: true } } } })
  if (!supplier) return res.status(404).json({ error: 'Proveedor no encontrado' })
  if (supplier._count.products || supplier._count.requests) return res.status(409).json({ error: 'No se puede eliminar un proveedor vinculado a productos o solicitudes' })
  await prisma.supplier.delete({ where: { id: supplier.id } }); res.status(204).end()
}))

app.get('/api/movements', requireAuth, route(async (req, res) => {
  const rows = await prisma.movement.findMany({ where: { businessId: req.session!.businessId }, include: { product: true, user: { select: { id: true, name: true } } }, orderBy: { createdAt: 'desc' }, take: 200 })
  res.json(rows)
}))
const movementSchema = z.object({ productId: z.string().min(1), type: z.enum(['ENTRY', 'EXIT', 'ADJUSTMENT']), quantity: z.number().int().positive(), reason: z.string().trim().min(2).max(200) })
async function recordMovement(input: z.infer<typeof movementSchema>, session: Session, tx: Prisma.TransactionClient) {
  const product = await tx.product.findFirst({ where: { id: input.productId, businessId: session.businessId, active: true } })
  if (!product) throw Object.assign(new Error('Producto no encontrado en este negocio'), { status: 404 })
  let next: number
  try { next = input.type === 'ADJUSTMENT' ? input.quantity : nextQuantity(product.quantity, input.type, input.quantity) }
  catch { throw Object.assign(new Error('No hay existencias suficientes o la cantidad no es válida'), { status: 409 }) }
  await tx.product.update({ where: { id: product.id }, data: { quantity: next } })
  const movement = await tx.movement.create({ data: { businessId: session.businessId, productId: product.id, userId: session.id, type: input.type, quantity: input.quantity, beforeQty: product.quantity, afterQty: next, reason: input.reason }, include: { product: true } })
  if (reachedMinimum(next, product.minStock)) {
    const open = await tx.alert.findFirst({ where: { businessId: session.businessId, productId: product.id, status: 'OPEN' } })
    if (!open) await tx.alert.create({ data: { businessId: session.businessId, productId: product.id } })
  }
  return movement
}
app.post('/api/movements', requireAuth, route(async (req, res) => {
  const parsed = movementSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: 'Datos de movimiento inválidos', details: parsed.error.flatten() })
  if (parsed.data.type === 'ADJUSTMENT' && req.session!.role !== 'ADMIN') return res.status(403).json({ error: 'Solo una administradora puede ajustar existencias manualmente' })
  try { const movement = await prisma.$transaction(tx => recordMovement(parsed.data, req.session!, tx)); res.status(201).json(movement) }
  catch (error) { const status = (error as { status?: number }).status; if (status) return res.status(status).json({ error: (error as Error).message }); throw error }
}))

app.get('/api/alerts', requireAuth, route(async (req, res) => res.json(await prisma.alert.findMany({ where: { businessId: req.session!.businessId }, include: { product: true, attendedBy: { select: { name: true } } }, orderBy: [{ status: 'asc' }, { createdAt: 'desc' }] }))))
app.patch('/api/alerts/:id/attend', requireAuth, requireAdmin, route(async (req, res) => {
  const parsed = z.object({ falsePositive: z.boolean().default(false) }).safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: 'Datos de atención inválidos' })
  const alert = await prisma.alert.findFirst({ where: { id: String(req.params.id), businessId: req.session!.businessId, status: 'OPEN' } }); if (!alert) return res.status(404).json({ error: 'Alerta abierta no encontrada' })
  res.json(await prisma.alert.update({ where: { id: alert.id }, data: { status: 'ATTENDED', attendedAt: new Date(), attendedById: req.session!.id, falsePositive: parsed.data.falsePositive } }))
}))

const requestSchema = z.object({ supplierId: z.string().min(1), alertId: z.string().optional(), notes: z.string().max(300).optional(), items: z.array(z.object({ productId: z.string().min(1), quantity: z.number().int().positive() })).min(1) })
app.get('/api/replenishments', requireAuth, route(async (req, res) => res.json(await prisma.replenishmentRequest.findMany({ where: { businessId: req.session!.businessId }, include: { supplier: true, items: { include: { product: true } } }, orderBy: { createdAt: 'desc' } }))))
app.post('/api/replenishments', requireAuth, requireAdmin, route(async (req, res) => {
  const parsed = requestSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: 'Datos de solicitud inválidos', details: parsed.error.flatten() })
  const { supplierId, items, ...data } = parsed.data, businessId = req.session!.businessId
  if (!await prisma.supplier.findFirst({ where: { id: supplierId, businessId } })) return res.status(400).json({ error: 'Proveedor no encontrado en este negocio' })
  const ids = [...new Set(items.map(x => x.productId))]; const validCount = await prisma.product.count({ where: { id: { in: ids }, businessId, active: true } }); if (validCount !== ids.length) return res.status(400).json({ error: 'Uno o más productos no pertenecen a este negocio' })
  if (data.alertId) {
    const alert = await prisma.alert.findFirst({ where: { id: data.alertId, businessId } })
    if (!alert) return res.status(400).json({ error: 'Alerta no encontrada en este negocio' })
    if (!items.some(item => item.productId === alert.productId)) return res.status(400).json({ error: 'La solicitud debe incluir el producto de la alerta seleccionada' })
  }
  const request = await prisma.replenishmentRequest.create({ data: { businessId, supplierId, alertId: data.alertId, notes: data.notes, items: { create: items.map(item => ({ ...item, businessId })) } }, include: { supplier: true, items: { include: { product: true } } } }); res.status(201).json(request)
}))
app.patch('/api/replenishments/:id/status', requireAuth, requireAdmin, route(async (req, res) => {
  const parsed = z.object({ status: z.enum(['SENT', 'CANCELLED', 'RECEIVED']) }).safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: 'Estado inválido' })
  const businessId = req.session!.businessId, request = await prisma.replenishmentRequest.findFirst({ where: { id: String(req.params.id), businessId }, include: { items: true } }); if (!request) return res.status(404).json({ error: 'Solicitud no encontrada' })
  if (['RECEIVED', 'CANCELLED'].includes(request.status)) return res.status(409).json({ error: 'La solicitud ya fue cerrada' })
  if (parsed.data.status !== 'RECEIVED') return res.json(await prisma.replenishmentRequest.update({ where: { id: request.id }, data: { status: parsed.data.status } }))
  try {
    const result = await prisma.$transaction(async tx => {
      const claimed = await tx.replenishmentRequest.updateMany({ where: { id: request.id, businessId, status: { in: ['DRAFT', 'SENT'] } }, data: { status: 'RECEIVED', receivedAt: new Date() } })
      if (!claimed.count) throw new Error('La solicitud ya fue recibida o cerrada')
      let stockoutAvoided = Boolean(request.alertId)
      for (const item of request.items) {
        const product = await tx.product.findFirst({ where: { id: item.productId, businessId } }); if (!product) throw new Error('Producto de la solicitud ya no disponible')
        if (product.quantity <= 0) stockoutAvoided = false
        await recordMovement({ productId: item.productId, type: 'ENTRY', quantity: item.quantity, reason: `Recepción de solicitud ${request.id}` }, req.session!, tx)
      }
      if (request.alertId) await tx.alert.updateMany({ where: { id: request.alertId, businessId, status: 'OPEN' }, data: { status: 'ATTENDED', attendedAt: new Date(), attendedById: req.session!.id, falsePositive: false } })
      return tx.replenishmentRequest.update({ where: { id: request.id }, data: { stockoutAvoided }, include: { supplier: true, items: { include: { product: true } } } })
    }); res.json(result)
  } catch (error) { res.status(409).json({ error: (error as Error).message }) }
}))

const auditSchema = z.object({ items: z.array(z.object({ productId: z.string(), physicalQuantity: z.number().int().nonnegative() })).min(1) })
app.post('/api/audits', requireAuth, route(async (req, res) => {
  const parsed = auditSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: 'Datos de auditoría inválidos', details: parsed.error.flatten() })
  const businessId = req.session!.businessId, ids = [...new Set(parsed.data.items.map(x => x.productId))]
  const products = await prisma.product.findMany({ where: { id: { in: ids }, businessId, active: true } }); if (products.length !== ids.length) return res.status(400).json({ error: 'Uno o más productos no pertenecen a este negocio' })
  const byId = new Map(products.map(p => [p.id, p]))
  const audit = await prisma.stockAudit.create({ data: { businessId, userId: req.session!.id, lines: { create: parsed.data.items.map(item => { const product = byId.get(item.productId)!; const accuracy = stockAccuracy(product.quantity, item.physicalQuantity); return { businessId, productId: item.productId, systemQuantity: product.quantity, physicalQuantity: item.physicalQuantity, accuracy } }) } }, include: { lines: { include: { product: true } }, user: { select: { name: true } } } })
  res.status(201).json(audit)
}))
app.get('/api/audits', requireAuth, requireAdmin, route(async (req, res) => res.json(await prisma.stockAudit.findMany({ where: { businessId: req.session!.businessId }, include: { lines: true, user: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 20 }))))
app.get('/api/reports/metrics', requireAuth, requireAdmin, route(async (req, res) => {
  const businessId = req.session!.businessId
  const [alerts, avoided, auditLines, products, movements] = await Promise.all([
    prisma.alert.findMany({ where: { businessId }, select: { createdAt: true, attendedAt: true, falsePositive: true } }),
    prisma.replenishmentRequest.count({ where: { businessId, status: 'RECEIVED', stockoutAvoided: true, receivedAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) } } }),
    prisma.stockAuditLine.findMany({ where: { businessId, audit: { createdAt: { gte: new Date(Date.now() - 30 * 86400000) } } }, select: { accuracy: true } }),
    prisma.product.count({ where: { businessId, active: true } }),
    prisma.movement.count({ where: { businessId, createdAt: { gte: new Date(Date.now() - 30 * 86400000) } } }),
  ])
  const attended = alerts.filter(a => a.attendedAt)
  const onTime = attended.filter(a => a.attendedAt!.getTime() - a.createdAt.getTime() <= 86400000).length
  const avgResponseHours = attended.length ? attended.reduce((n, a) => n + (a.attendedAt!.getTime() - a.createdAt.getTime()) / 3600000, 0) / attended.length : null
  const falsePositiveCount = attended.filter(a => a.falsePositive).length
  res.json({ alertsAttendedWithin24hPercent: alerts.length ? Number((100 * onTime / alerts.length).toFixed(1)) : null, stockoutsAvoidedThisMonth: avoided, averageAlertResponseHours: avgResponseHours === null ? null : Number(avgResponseHours.toFixed(1)), inventoryAccuracyPercent: auditLines.length ? Number((100 * auditLines.reduce((n, line) => n + line.accuracy, 0) / auditLines.length).toFixed(1)) : null, falsePositiveAlertPercent: attended.length ? Number((100 * falsePositiveCount / attended.length).toFixed(1)) : null, openAlerts: alerts.length - attended.length, products, movementsLast30Days: movements, auditLinesLast30Days: auditLines.length })
}))

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error('STOCKLY API error:', err)
  const status = (err as { status?: number })?.status
  if (status) return res.status(status).json({ error: (err as Error).message })
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return res.status(409).json({ error: 'El registro ya existe' })
  res.status(500).json({ error: 'Ocurrió un error interno' })
})

const port = Number(process.env.PORT ?? 3001)
app.listen(port, () => console.log(`STOCKLY API en http://localhost:${port}`))

