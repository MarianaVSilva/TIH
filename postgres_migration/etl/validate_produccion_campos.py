import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from common import sqlserver_conn, pg_conn

sql_cn = sqlserver_conn("cmde_public")
pg = pg_conn()

cur = sql_cn.cursor()
cur.execute("""
    SELECT YEAR(fecha), SUM(petroleo_mbd), SUM(gas_mmpcd)
    FROM cmde_public.dbo.PRODUCCION_CAMPOS
    WHERE id <> 1
    GROUP BY YEAR(fecha) ORDER BY YEAR(fecha) DESC
""")
sql_rows = {r[0]: (round(float(r[1] or 0), 1), round(float(r[2] or 0), 1)) for r in cur.fetchall()}

with pg.cursor() as pcur:
    pcur.execute("""
        SELECT EXTRACT(YEAR FROM fecha)::int, SUM(petroleo_mbd), SUM(gas_mmpcd)
        FROM core.fact_produccion_campo GROUP BY 1 ORDER BY 1 DESC
    """)
    pg_rows = {r[0]: (round(float(r[1] or 0), 1), round(float(r[2] or 0), 1)) for r in pcur.fetchall()}

years = sorted(set(sql_rows) | set(pg_rows), reverse=True)
print(f"{'anio':>6} {'sql_petro':>14} {'pg_petro':>14} {'sql_gas':>14} {'pg_gas':>14}  match")
diffs = 0
for y in years:
    s = sql_rows.get(y, (None, None)); p = pg_rows.get(y, (None, None))
    match = "OK" if s == p else "DIFF"
    if match == "DIFF": diffs += 1
    print(f"{y:>6} {s[0]!s:>14} {p[0]!s:>14} {s[1]!s:>14} {p[1]!s:>14}  {match}")
print(f"\n{len(years)} años comparados, {diffs} con diferencia")

sql_cn.close(); pg.close()
