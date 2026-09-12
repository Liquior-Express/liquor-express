# Liquor Express — Guía de despliegue (Railway)

Front (Next.js) y back (Express) se publican **juntos en un solo servicio** de Railway.
Railway lee `railway.json`: compila con `npm run build`, arranca con `npm start` y revisa `/api/health`.

---

## 1 · Antes de publicar

- [ ] Todo el código está en GitHub (`main`) y probado.
- [ ] Pasar lo probado a la rama **`produccion`** (es la que se publica). En la carpeta del proyecto:

```bash
git checkout produccion
```
```bash
git merge main
```
```bash
git push origin produccion
```
```bash
git checkout main
```

- [ ] Generar un **secreto nuevo** para producción (no reutilizar el de desarrollo):

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

## 2 · Crear el servicio en Railway

1. Entrar a **railway.com** con la cuenta de Liquor Express (`bar.liquorexpress@gmail.com`).
2. **New Project → Deploy from GitHub repo →** `Liquior-Express/liquor-express`.
3. En el servicio: **Settings → Source → Branch:** `produccion`.
4. **Variables** (pestaña *Variables*), una por una:

| Variable | Valor |
|---|---|
| `SUPABASE_URL` | `https://dqmtquitoisikdilqcpp.supabase.co` |
| `SUPABASE_ANON_KEY` | la llave *publishable* (Supabase → Settings → API) |
| `SUPABASE_SERVICE_ROLE_KEY` | la llave *secret* (Supabase → Settings → API) |
| `API_JWT_SECRET` | el secreto nuevo del paso 1 |
| `API_PORT` | `4000` |

> `PORT` lo pone Railway solo. No subir nunca estas llaves a GitHub.

5. **Settings → Networking → Generate Domain** → queda una dirección tipo `liquor-express-production.up.railway.app`.
6. Esperar el primer despliegue (unos minutos) y abrir la dirección.

## 3 · Verificar

- [ ] `https://<tu-dominio>/api/health` responde `"bd":"conectada"`.
- [ ] Iniciar sesión con **Admin** y recorrer: Ventas, Caja, Inventario, Compras, Reportes.
- [ ] **Instalar la app**: en Chrome (PC) el ícono de instalar en la barra de direcciones; en el celular, menú → *Agregar a pantalla de inicio*.
- [ ] **Sin conexión**: con la app abierta una vez, cortar el internet y recargar → abre y deja vender; al volver la señal, las ventas se envían solas.

## 4 · Dominio propio (opcional)

Railway → *Settings → Networking → Custom Domain* → escribir el dominio (ej. `app.liquorexpress.co`) y crear en el proveedor del dominio el registro **CNAME** que indica Railway.

## 5 · Salida en vivo

- [ ] Borrar los datos de prueba (productos de ensayo, ventas, cajas) o empezar con la base limpia.
- [ ] **Importar el catálogo real** (Inventario → *Importar Excel*; se puede descargar la plantilla ahí mismo).
- [ ] Revisar usuarios y contraseñas (Admin, Gerencia, Caja).
- [ ] Registrar la **tasa del Real** del día y **abrir la primera caja**.

## 6 · Respaldo y mantenimiento

- **Respaldo:** Admin → Inicio → *Descargar respaldo de los datos* (archivo con todas las tablas, sin contraseñas). Recomendado **cada semana**, guardado en USB o nube.
- En el plan gratis de Supabase, revisar *Database → Backups*; si no hay copias automáticas, el respaldo semanal es la copia de seguridad.
- El plan gratis de Supabase **pausa** el proyecto tras ~7 días sin uso; con uso diario no pasa.
- **Actualizar la app:** cada `git push origin produccion` vuelve a publicar automáticamente.
- **Costos:** Railway (plan Hobby, ~USD 5/mes) + Supabase (gratis al inicio). Dominio: opcional.
