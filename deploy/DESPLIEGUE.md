# Despliegue de TIH en el servidor Debian 13 ("Portales", 172.16.83.21)

Convive con: mvt_admin, mvt_mapa (Apache :80/:8000), precios_gasolina (Apache
:8090), pnih. Este despliegue usa recursos nuevos y no toca ninguno de los
existentes: puerto interno 8005 (backend), puerto público 8091 (Apache).

## 0. Requisitos ya confirmados en el servidor
- Driver `ODBC Driver 17 for SQL Server` instalado — coincide con lo que usa
  el código (`backend/app/database.py`), no requiere cambios.
- Python 3.13 disponible.
- Apache2 activo como reverse proxy (no hay Nginx).
- Node/npm **no están instalados** — el frontend se compila en tu máquina y
  se sube ya construido (`dist/`), no hace falta Node en el servidor.

## 1. En tu máquina: preparar el paquete a subir
```bash
cd frontend
npm run build          # genera frontend/dist
```
Sube al servidor (ajusta rutas/usuario):
```bash
scp -r backend mvazquez@172.16.83.21:/opt/tih_tmp_backend
scp -r frontend/dist mvazquez@172.16.83.21:/opt/tih_tmp_dist
scp -r deploy mvazquez@172.16.83.21:/opt/tih_tmp_deploy
```
(O clona el repo directo en el servidor con `git clone` si tienen acceso al
remoto desde ahí — evita el scp.)

## 2. En el servidor: armar /opt/tih
```bash
sudo mkdir -p /opt/tih
sudo mv /opt/tih_tmp_backend /opt/tih/backend
sudo mv /opt/tih_tmp_dist    /opt/tih/frontend/dist   # crea /opt/tih/frontend antes si hace falta
sudo mv /opt/tih_tmp_deploy  /opt/tih/deploy
sudo chown -R mvazquez:mvazquez /opt/tih
```

## 3. Backend: venv + dependencias
```bash
cd /opt/tih/backend
python3 -m venv .venv
.venv/bin/pip install --upgrade pip
.venv/bin/pip install -r requirements.txt
.venv/bin/pip install gunicorn   # si no está ya en requirements.txt
```

## 4. Backend: .env de producción
```bash
cp .env.example .env
nano .env
```
Rellenar como mínimo:
- `DB_SERVER`, `DB_INSTANCE`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` — credenciales
  reales de SQL Server. **Verifica antes que el servidor Linux tenga ruta de
  red al SQL Server** (puerto 1433) — es lo más probable que falle primero:
  ```bash
  nc -zv IP_DEL_SQLSERVER 1433
  ```
- `CORS_ORIGINS=http://172.16.83.21:8091` (o el dominio final si hay uno)
- `SECRET_KEY` — cambiar el valor de ejemplo.

## 5. Probar el backend a mano ANTES de systemd
```bash
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8005
```
Verifica en otra terminal (o `curl` desde el mismo servidor):
```bash
curl http://127.0.0.1:8005/api/v1/temas/
```
Si responde JSON, Ctrl+C y sigue. Si falla, es el momento de depurar
conexión a SQL Server / drivers, antes de meter systemd y Apache en la
ecuación.

## 6. Servicio systemd
```bash
sudo cp /opt/tih/deploy/tih_backend.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now tih_backend
sudo systemctl status tih_backend       # debe decir "active (running)"
journalctl -u tih_backend -n 50 --no-pager   # si algo falla, aquí está el motivo
```

## 7. Apache: publicar el sitio en :8091
```bash
sudo cp /opt/tih/deploy/apache_tih.conf /etc/apache2/sites-available/tih.conf
sudo a2enmod proxy proxy_http headers
sudo a2ensite tih
sudo apache2ctl configtest        # DEBE decir "Syntax OK"
sudo systemctl reload apache2
```

## 8. Verificar
```bash
curl http://127.0.0.1:8091/                  # debe devolver el index.html del frontend
curl http://127.0.0.1:8091/api/v1/temas/     # debe devolver JSON (proxy funcionando)
```
Desde tu navegador: `http://172.16.83.21:8091/`

## 9. Chat (Ollama) — opcional
Si el chat (`qwen2.5:7b`) debe funcionar, Ollama tiene que estar corriendo en
el servidor (o accesible por red) y la URL correspondiente configurada en
`.env`. Revisar RAM disponible (hay ~12GB libres) antes de cargar el modelo.

## 10. Actualizar el despliegue a futuro
```bash
# subir cambios de backend → reiniciar servicio
sudo systemctl restart tih_backend

# subir nuevo build de frontend → no requiere reiniciar nada, Apache sirve
# los archivos estáticos directo
```
