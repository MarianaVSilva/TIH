import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from common import sqlserver_conn, pg_conn

sql_cn = sqlserver_conn("cmde_public")
pg = pg_conn()

print("=== RESERVAS_CAMPOS: totales por año, categoria PROBADAS ===")
cur = sql_cn.cursor()
cur.execute("""
    SELECT YEAR(fecha), SUM(rr_aceite_mmb), SUM(rr_gas_mmmpc)
    FROM cmde_public.dbo.RESERVAS_CAMPOS
    WHERE categoria = 'PROBADAS'
    GROUP BY YEAR(fecha)
    ORDER BY YEAR(fecha) DESC
""")
sql_rows = {r[0]: (round(float(r[1] or 0), 3), round(float(r[2] or 0), 3)) for r in cur.fetchall()}

with pg.cursor() as pcur:
    pcur.execute("""
        SELECT EXTRACT(YEAR FROM fecha)::int, SUM(rr_aceite_mmb), SUM(rr_gas_mmmpc)
        FROM core.fact_reservas_campo
        WHERE categoria = 'PROBADAS'
        GROUP BY 1 ORDER BY 1 DESC
    """)
    pg_rows = {r[0]: (round(float(r[1] or 0), 3), round(float(r[2] or 0), 3)) for r in pcur.fetchall()}

years = sorted(set(sql_rows) | set(pg_rows), reverse=True)[:8]
print(f"{'anio':>6} {'sql_aceite':>14} {'pg_aceite':>14} {'sql_gas':>14} {'pg_gas':>14}  match")
for y in years:
    s = sql_rows.get(y, (None, None))
    p = pg_rows.get(y, (None, None))
    match = "OK" if s == p else "DIFF"
    print(f"{y:>6} {s[0]!s:>14} {p[0]!s:>14} {s[1]!s:>14} {p[1]!s:>14}  {match}")

sql_cn.close()
pg.close()
