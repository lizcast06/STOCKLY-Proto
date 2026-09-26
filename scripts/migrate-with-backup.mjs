import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const directory = join(process.cwd(), 'backups')
mkdirSync(directory, { recursive: true })
const filename = join(directory, `stockly-${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}.dump`)
const backup = execFileSync('docker', ['compose', 'exec', '-T', 'db', 'pg_dump', '-U', 'stockly', '-d', 'stockly', '--format=custom', '--no-owner', '--no-privileges'])
writeFileSync(filename, backup)
if (statSync(filename).size < 100) throw new Error('El respaldo quedó vacío; la migración se canceló.')
const migration = spawnSync('npx', ['prisma', 'migrate', 'deploy'], { stdio: 'inherit', shell: process.platform === 'win32' })
if (migration.status !== 0) throw new Error(`Falló la migración. El respaldo está en ${filename}`)
console.log(`Migración completada. Respaldo previo: ${filename}`)
