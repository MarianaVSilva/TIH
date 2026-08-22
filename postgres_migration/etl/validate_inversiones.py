import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from common import sqlserver_conn, pg_conn

sql_cn = sqlserver_conn("cmde_public")
pg = pg_conn()

cur = sql_cn.cursor()
cur.execute("""
    SELECT COUNT(*), SUM(MONTO_USD) FROM cmde_public.dbo.INVERSIONES_APROBADAS
""")
n_sql, sum_sql = cur.fetchone()
cur.execute("""
    SELECT ANIO, SUM(MONTO_USD) FROM cmde_public.dbo.INVERSIONES_APROBADAS
    GROUP BY ANIO ORDER BY ANIO DESC
""")
sql_rows = {int(r[0]): round(float(r[1] or 0), 0) for r in cur.fetchall() if r[0] is not None}

with pg.cursor() as pcur:
    pcur.execute("SELECT COUNT(*), SUM(monto_usd) FROM core.fact_inversiones")
    n_pg, sum_pg = pcur.fetchone()
    pcur.execute("SELECT anio, SUM(monto_usd) FROM core.fact_inversiones GROUP BY anio ORDER BY anio DESC")
    pg_rows = {int(r[0]): round(float(r[1] or 0), 0) for r in pcur.fetchall()}

print(f"Total filas: SQL={n_sql} PG={n_pg}  {'OK' if n_sql==n_pg else 'DIFF'}")
print(f"Total MONTO_USD: SQL={float(sum_sql):,.0f} PG={float(sum_pg):,.0f}  {'OK' if round(float(sum_sql),0)==round(float(sum_pg),0) else 'DIFF'}")
print()

years = sorted(set(sql_rows) | set(pg_rows), reverse=True)[:15]
print(f"{'anio':>6} {'sql_monto':>18} {'pg_monto':>18}  match")
for y in years:
    s = sql_rows.get(y); p = pg_rows.get(y)
    print(f"{y:>6} {s:>18,.0f} {p!s:>18}  {'OK' if s==p else 'DIFF'}")

sql_cn.close(); pg.close()
