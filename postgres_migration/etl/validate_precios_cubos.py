"""Valida staging/core en Postgres contra los valores reales que hoy
devuelven las vistas de SQL Server que consume el backend
(dbo.PRECIOS, dbo.CUBOS) -- no solo contra las tablas base.
"""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from common import sqlserver_conn, pg_conn

sql_cn = sqlserver_conn("cmde_public")
pg = pg_conn()

print("=== CUBOS ===")
cur = sql_cn.cursor()
cur.execute("SELECT COUNT(*) FROM cmde_public.dbo.CUBOS")
print("SQL Server dbo.CUBOS filas:", cur.fetchone()[0])

with pg.cursor() as pcur:
    pcur.execute("SELECT COUNT(*) FROM core.dim_tema")
    print("Postgres core.dim_tema filas:", pcur.fetchone()[0])
    pcur.execute("SELECT COUNT(*) FROM api.v_temas")
    print("Postgres api.v_temas filas (tras filtro json_arg):", pcur.fetchone()[0])

cur.execute("SELECT COUNT(*) FROM cmde_public.dbo.CUBOS WHERE JSON_ARG <> '' AND JSON_ARG NOT IN ('BalanceGas','InvAsig')")
print("SQL Server dbo.CUBOS filas tras mismo filtro:", cur.fetchone()[0])

print()
print("=== PRECIOS ===")
cur.execute("SELECT COUNT(*), MIN(fecha), MAX(fecha) FROM cmde_public.dbo.PRECIOS")
n, mn, mx = cur.fetchone()
print(f"SQL Server dbo.PRECIOS (vista real que usa el backend): {n} filas, rango {mn} - {mx}")

with pg.cursor() as pcur:
    pcur.execute("SELECT COUNT(*), MIN(fecha), MAX(fecha) FROM core.fact_precios")
    print("Postgres core.fact_precios:", pcur.fetchone())

# Comparar valores de una fecha conocida (fija, no depende del "hoy" del origen)
cur.execute("SELECT fecha, brent, wti, mme, henry_hub FROM cmde_public.dbo.PRECIOS WHERE fecha = '2020-04-20'")
row = cur.fetchone()
print("SQL Server 2020-04-20 (WTI negativo histórico):", tuple(row) if row else None)

with pg.cursor() as pcur:
    pcur.execute("SELECT fecha, brent, wti, mme, henry_hub FROM core.fact_precios WHERE fecha = '2020-04-20'")
    print("Postgres  2020-04-20:", pcur.fetchone())

# Muestreo aleatorio de 5 fechas más, comparación exacta
cur.execute("SELECT TOP 5 fecha, brent, wti, mme, henry_hub FROM cmde_public.dbo.PRECIOS ORDER BY fecha")
rows_sql = cur.fetchall()
print("\nMuestra (5 filas más antiguas):")
with pg.cursor() as pcur:
    for r in rows_sql:
        pcur.execute("SELECT fecha, brent, wti, mme, henry_hub FROM core.fact_precios WHERE fecha=%s", (r[0],))
        pg_row = pcur.fetchone()
        match = "OK" if pg_row and tuple(pg_row) == tuple(r) else "DIFF"
        print(f"  {r[0]}  SQLServer={tuple(r)}  Postgres={pg_row}  -> {match}")

sql_cn.close()
pg.close()
