# TIH – Tablero de Información de Hidrocarburos v2.0

Modernización del SIH. Stack: **Python 3.11 + FastAPI** · **React 18 + Vite** · **Apache ECharts** · **Tailwind CSS** · **Nginx + Uvicorn**.

---

## Estructura

```
TIH/
├── backend/          # FastAPI app
│   ├── app/
│   │   ├── main.py
│   │   ├── config.py
│   │   ├── database.py
│   │   ├── models/schemas.py
│   │   ├── routers/  (temas, produccion, reservas)
│   │   └── services/ (lógica de negocio / queries)
│   ├── requirements.txt
│   └── .env.example  →  copiar a .env y ajustar
├── frontend/         # React 18 + Vite
│   ├── src/
│   │   ├── App.jsx
│   │   ├── api/client.js
│   │   ├── store/useAppStore.js
│   │   ├── components/ (Charts, Filters, Layout, UI)
│   │   └── pages/ (Dashboard, Produccion, Reservas, Contratos)
│   ├── package.json
│   └── vite.config.js
└── nginx/nginx.conf  # Config producción Linux
```

---

## Arranque local (desarrollo)

### Backend

```bash
cd backend
cp .env.example .env          # ajustar si es necesario
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
# Swagger: http://localhost:8000/docs
```

### Frontend

```bash
cd frontend
npm install
npm run dev
# App: http://localhost:5173
```

---

## Producción (Linux)

```bash
# Build frontend
cd frontend && npm run build
sudo cp -r dist /var/www/tih/

# Backend con systemd / supervisor
uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 4

# Nginx
sudo cp nginx/nginx.conf /etc/nginx/sites-available/tih
sudo ln -s /etc/nginx/sites-available/tih /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

---

## Base de datos

Misma conexión que SIH:
```
mssql+pyodbc://estadistica:***@172.16.200.98\UMBRACODB/cmde_public?driver=SQL+Server
```
Configurar en `backend/.env` como `DB_URL=...`

---

## API Reference

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/v1/health` | Estado del servicio |
| GET | `/api/v1/temas/` | Lista de temas/cubos disponibles |
| GET | `/api/v1/produccion/cuenca` | Series por cuenca |
| GET | `/api/v1/produccion/detalle` | Desglose variable seleccionada |
| GET | `/api/v1/reservas/` | Reservas por cuenca y año |

Swagger completo: `http://localhost:8000/docs`
