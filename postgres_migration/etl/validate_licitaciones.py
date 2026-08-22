import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from common import sqlserver_conn, pg_conn

sql_cn = sqlserver_conn("cmde_public")
pg = pg_conn()

print("=== POZOS_COMPROMETIDOS ===")
cur = sql_cn.cursor()
cur.execute("""
    SELECT contrato, ronda, licitacion, pmteapozos, pozosplanes, terminados, enperforacion, porperforar
    FROM rdmx.T_21_PozosComprometidos ORDER BY contrato
""")
sql_rows = {r[0]: tuple(r[1:]) for r in cur.fetchall()}
cur.execute("SELECT COUNT(*), SUM(CAST(terminados as int)), SUM(CAST(enPerforacion as int)) FROM rdmx.T_21_PozosComprometidos")
print("SQL Server:", cur.fetchone())

with pg.cursor() as pcur:
    pcur.execute("""
        SELECT ct.asig_cont, lic.ronda, lic.licitacion, pc.pmt_pozos, pc.pozos_planes,
               pc.terminados, pc.en_perforacion, pc.por_perforar
        FROM core.fact_pozos_comprometidos pc
        JOIN core.dim_contrato ct ON ct.contrato_id = pc.contrato_id
        LEFT JOIN core.dim_licitacion lic ON lic.licitacion_id = pc.licitacion_id
    """)
    pg_rows = {r[0]: tuple(r[1:]) for r in pcur.fetchall()}
    pcur.execute("SELECT COUNT(*), SUM(terminados), SUM(en_perforacion) FROM core.fact_pozos_comprometidos")
    print("Postgres:  ", pcur.fetchone())

mismatches = 0
for k in sql_rows:
    s = sql_rows[k]
    p = pg_rows.get(k)
    sv = (s[0], s[1], float(s[2]) if s[2] else None, float(s[3]) if s[3] else None, s[4], s[5], s[6])
    pv = p if p else None
    if p is None or float(s[3] or 0) != float(p[4] or 0) or s[4] != p[5] or s[5] != p[6]:
        mismatches += 1
        if mismatches <= 5:
            print(f"DIFF contrato={k}: sql={s} pg={p}")
print(f"contratos SQL={len(sql_rows)} PG={len(pg_rows)} mismatches(pozos_planes/terminados/en_perforacion)={mismatches}")

print("\n=== LICITACIONES_OFERTAS (licitaciones_bloques_ofertas) ===")
cur.execute("SELECT COUNT(*), SUM(inv_usd), SUM(bono) FROM dbo.licitaciones_bloques_ofertas")
print("SQL Server:", cur.fetchone())
with pg.cursor() as pcur:
    pcur.execute("SELECT COUNT(*), SUM(inv_usd), SUM(bono) FROM core.fact_licitaciones_ofertas")
    print("Postgres:  ", pcur.fetchone())

sql_cn.close(); pg.close()
