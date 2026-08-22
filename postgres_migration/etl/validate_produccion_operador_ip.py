import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from common import sqlserver_conn, pg_conn

sql_cn = sqlserver_conn("cmde_public")
pg = pg_conn()

cur = sql_cn.cursor()
cur.execute("""
    SELECT YEAR(fecha), SUM(petroleo_mbd * factor_o), SUM(gas_mmpcd * factor_o), COUNT(DISTINCT empresa)
    FROM cmde_public.dbo.PRODUCCION_OPERADOR_IP
    GROUP BY YEAR(fecha) ORDER BY YEAR(fecha) DESC
""")
sql_rows = {r[0]: (round(float(r[1] or 0), 1), round(float(r[2] or 0), 1), r[3]) for r in cur.fetchall()}

with pg.cursor() as pcur:
    pcur.execute("""
        SELECT EXTRACT(YEAR FROM fecha)::int, SUM(petroleo_mbd*factor_o), SUM(gas_mmpcd*factor_o), COUNT(DISTINCT empresa_id)
        FROM core.fact_produccion_operador GROUP BY 1 ORDER BY 1 DESC
    """)
    pg_rows = {r[0]: (round(float(r[1] or 0), 1), round(float(r[2] or 0), 1), r[3]) for r in pcur.fetchall()}

years = sorted(set(sql_rows) | set(pg_rows), reverse=True)
print(f"{'anio':>6} {'sql_petro':>12} {'pg_petro':>12} {'sql_gas':>12} {'pg_gas':>12} {'sql_emp':>8} {'pg_emp':>8}  match")
diffs = 0
for y in years:
    s = sql_rows.get(y, (None, None, None)); p = pg_rows.get(y, (None, None, None))
    match = "OK" if s[:2] == p[:2] else "DIFF"
    if match == "DIFF": diffs += 1
    print(f"{y:>6} {s[0]!s:>12} {p[0]!s:>12} {s[1]!s:>12} {p[1]!s:>12} {s[2]!s:>8} {p[2]!s:>8}  {match}")
print(f"\n{len(years)} años comparados, {diffs} con diferencia")

sql_cn.close(); pg.close()
