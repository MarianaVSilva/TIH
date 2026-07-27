import { useAppStore } from "../../store/useAppStore";

const MONTHS = [
  "Enero","Febrero","Marzo","Abril","Mayo","Junio",
  "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre",
];

const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: currentYear - 1959 }, (_, i) => currentYear - i);

export default function FilterPanel({ onApply }) {
  const { filters, setFilters } = useAppStore();

  const handleChange = (key, value) => setFilters({ [key]: value });

  return (
    <div className="card flex flex-wrap gap-4 items-end">
      <div className="flex-1 min-w-[120px]">
        <label className="label">Año inicio</label>
        <select className="select" value={filters.start_year}
          onChange={(e) => handleChange("start_year", +e.target.value)}>
          {YEARS.map((y) => <option key={y}>{y}</option>)}
        </select>
      </div>

      <div className="flex-1 min-w-[120px]">
        <label className="label">Mes inicio</label>
        <select className="select" value={filters.start_month}
          onChange={(e) => handleChange("start_month", +e.target.value)}>
          {MONTHS.map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
        </select>
      </div>

      <div className="flex-1 min-w-[120px]">
        <label className="label">Año fin</label>
        <select className="select" value={filters.end_year}
          onChange={(e) => handleChange("end_year", +e.target.value)}>
          {YEARS.map((y) => <option key={y}>{y}</option>)}
        </select>
      </div>

      <div className="flex-1 min-w-[120px]">
        <label className="label">Mes fin</label>
        <select className="select" value={filters.end_month}
          onChange={(e) => handleChange("end_month", +e.target.value)}>
          {MONTHS.map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
        </select>
      </div>

      <div className="flex-1 min-w-[140px]">
        <label className="label">Periodicidad</label>
        <select className="select" value={filters.period}
          onChange={(e) => handleChange("period", e.target.value)}>
          <option value="monthly">Mensual</option>
          <option value="annually">Anual</option>
        </select>
      </div>

      <div className="flex-1 min-w-[160px]">
        <label className="label">Variable</label>
        <select className="select" value={filters.variable}
          onChange={(e) => handleChange("variable", e.target.value)}>
          <option value="liquidos_mbd">Líquidos (Mbd)</option>
          <option value="petroleo_mbd">Petróleo (Mbd)</option>
          <option value="condensado_mbd">Condensado (Mbd)</option>
          <option value="gas_mmpcd">Gas (MMpcd)</option>
          <option value="agua_mbd">Agua (Mbd)</option>
        </select>
      </div>

      <button className="btn-primary h-10 px-6" onClick={onApply}>
        Consultar
      </button>
    </div>
  );
}
