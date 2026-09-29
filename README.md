# STOCKLY

MVP web de gestión de inventario para PyMEs: React, Vite, TypeScript, Express, Zod, Prisma y PostgreSQL. La aplicación usa espacios separados por negocio, roles de Administrador/Empleado, cookies HttpOnly con access tokens de 15 minutos y refresh tokens rotativos, historial de movimientos y alertas por stock mínimo.

## Ejecutar en Windows

Requisitos: Node.js 20.19+ o 22.12+, npm y Docker Desktop.

1. Copia `.env.example` a `.env`. En PowerShell: `Copy-Item .env.example .env`.
2. Cambia `AUTH_SECRET` por una cadena aleatoria larga. No publiques `.env`.
3. Instala paquetes: `npm install`.
4. Inicia PostgreSQL: `docker compose up -d db`.
5. Genera Prisma y aplica las migraciones: `npm run db:generate` y `npm run db:deploy`.
6. Inicia web y API: `npm run dev`.
7. Abre <http://localhost:5173> y crea la cuenta administradora de tu negocio.

### Usuarios de prueba

Con PostgreSQL local iniciado y las migraciones aplicadas, ejecuta `npm run db:seed:demo` para crear o restablecer dos cuentas de prueba aisladas en el negocio `STOCKLY Demo`:

- Administrador: `admin@stockly.test` / `StocklyDemo2026!`
- Empleado: `empleado@stockly.test` / `StocklyDemo2026!`

El comando se bloquea si `NODE_ENV=production`. En Windows, asegúrate de tener Docker Desktop abierto y PostgreSQL en ejecución antes de iniciar la app. `Failed to fetch` normalmente significa que la web no logra conectar con la API; revisa que `npm run dev` mantenga activos ambos procesos y que <http://localhost:3001/api/health> responda con estado `ok`.

También puedes levantar todo con `docker compose up --build`; la web queda en el puerto 5173 y la API en el 3001. Para detener los servicios: `docker compose down`. Los datos locales viven en el volumen Docker `stockly_pg`.

## Flujos disponibles

- Registro de un negocio y primer usuario Administrador; inicio/cierre de sesión.
- Alta de usuarios Empleado o Administrador desde Equipo.
- Catálogo de productos, categorías, mínimos configurables, proveedor y exportación CSV.
- Registro de entradas y salidas. Una salida que exceda existencias se rechaza; cada movimiento conserva existencias antes/después, motivo, responsable y fecha.
- Alertas al llegar al mínimo, con atención, clasificación de falsos positivos y solicitudes de reabastecimiento.
- Recepción de una solicitud: crea movimientos de entrada y actualiza existencias dentro de una transacción.
- Conteos físicos para calcular exactitud y panel de métricas vinculadas al documento de Monitoreo.
- Monitoreo de salud de PostgreSQL, latencia de API, errores HTTP, memoria del proceso y memoria libre del host.
- Documentación interactiva del API en `/api/docs` y OpenAPI JSON en `/api/openapi.json`.

## Calidad, infraestructura y entrega

- `npm test`: pruebas unitarias Vitest para existencias, mínimos y exactitud.
- `npm run build`: chequeo TypeScript, compilación del API y build de Vite.
- `.github/workflows/ci.yml`: valida Prisma, ejecuta ESLint, Vitest y el build en cada PR y push a `main`/`develop`.
- `k6/stockly-load.js` y `.github/workflows/load-test.yml`: escenario manual de 500 usuarios virtuales y umbrales de p95 < 500 ms y fallos < 0.5%.
- `docker-compose.yml`: PostgreSQL, API y web en entorno local reproducible.
- `npm run db:backup:migrate`: respalda la base local con `pg_dump` antes de aplicar migraciones versionadas. En producción, `.github/workflows/backup.yml` crea una copia diaria cifrada si se configuran los secretos `PRODUCTION_DATABASE_URL` y `BACKUP_ENCRYPTION_PASSWORD`.
- `render.yaml` y `.github/workflows/deploy.yml`: blueprint y despliegue de Render. Tras CI exitoso en `main`, el workflow cifra y archiva un respaldo PostgreSQL antes de desplegar ese mismo commit en API y web.
- Render comprueba `/api/health` antes de enrutar una nueva versión. Si la instancia nueva no pasa las comprobaciones, Render cancela el despliegue y mantiene la versión previa atendiendo tráfico.

## Preparación para despliegue

1. Publica el repositorio en GitHub y protege `main` para aceptar cambios solo mediante Pull Request desde `develop`.
2. Conecta el repositorio a Render y sincroniza `render.yaml`.
3. Configura los secretos de GitHub `PRODUCTION_DATABASE_URL`, `BACKUP_ENCRYPTION_PASSWORD`, `RENDER_API_TOKEN`, `RENDER_API_SERVICE_ID` y `RENDER_WEB_SERVICE_ID` para activar respaldos y despliegues.
4. Comprueba el health check y ejecuta manualmente el workflow de carga contra la URL del API antes de una entrega.

## Alcance pendiente para una entrega de producción

El 98% definido en el documento es la meta de exactitud del conteo físico, no un porcentaje que la app pueda garantizar antes de operar. El valor comienza a calcularse después de guardar auditorías. La etapa actual deja lista una base funcional del MVP; todavía faltan notificaciones por correo, verificación real de carga contra el hosting elegido, revisión de seguridad externa y la configuración de cuentas/secretos de GitHub y Render. La métrica de GPU no está disponible en el runtime genérico de Render; la pantalla muestra esa limitación y presenta CPU/memoria/latencia que sí se pueden obtener.
