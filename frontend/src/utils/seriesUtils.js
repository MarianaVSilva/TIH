// Algunas series (Nitrógeno, Agua...) empiezan a reportarse años después de
// que arranca la tabla de origen — antes de eso la base trae 0.0, no NULL,
// porque la columna existe desde siempre pero el dato no se medía. Graficar
// esos ceros dibuja una línea plana en el suelo antes de que la serie
// "aparezca", lo que se lee como "no producía" en vez de "no se medía".
//
// Esta función convierte esa RACHA INICIAL de ceros (o nulos) en null, para
// que ECharts no dibuje nada ahí — la línea/barra arranca justo donde
// comienza el primer dato real. Los ceros que aparecen DESPUÉS de que la
// serie ya tiene datos (p. ej. un pozo que un mes no produjo) se dejan
// intactos: ahí sí es información real, no una ausencia de medición.
export function sinCerosIniciales(data) {
  if (!Array.isArray(data)) return data;
  const idx = data.findIndex(v => v != null && v !== 0);
  if (idx <= 0) return data; // ya empieza con dato real, o no hay ningún dato real
  return data.map((v, i) => (i < idx ? null : v));
}
