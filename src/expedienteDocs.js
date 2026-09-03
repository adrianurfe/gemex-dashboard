// Lógica de qué documentos requiere un expediente (movimiento tipo
// 'Apartado') según su tipo_compra, y cuándo se considera completo/
// aprobado. Extraído de Expedientes.js para poder reutilizarlo en
// Titulacion.js (que necesita saber si el expediente de una unidad ya
// está aprobado antes de mostrarla).
const DOCS_ASESOR = [
  { id: 'ine_pasaporte', opcional: false },
  { id: 'validacion_ine', opcional: false },
  { id: 'comprobante_domicilio', opcional: false },
  { id: 'acta_nacimiento', opcional: false },
  { id: 'acta_matrimonio', opcional: false },
  { id: 'curp', opcional: false },
  { id: 'constancia_fiscal', opcional: false },
  { id: 'cotizacion', opcional: false },
  { id: 'comprobante_apartado', opcional: false },
  { id: 'kyc', opcional: false },
  { id: 'referencia_bancaria', opcional: true },
  { id: 'documento_adicional', opcional: true },
];
const DOC_ORDEN_CONTRATO = { id: 'orden_contrato', opcional: false };

const docsBaseIdentidad = (prefix) => [
  { id: `${prefix}ine_pasaporte`, opcional: false },
  { id: `${prefix}acta_nacimiento`, opcional: false },
  { id: `${prefix}acta_matrimonio`, opcional: true },
  { id: `${prefix}curp`, opcional: false },
  { id: `${prefix}constancia_fiscal`, opcional: false },
  { id: `${prefix}comprobante_domicilio`, opcional: false },
];

const DOCS_FINANCIADO_ESPECIFICOS = {
  Infonavit: { comunes: ['precalificacion_infonavit', 'constancia_taller', 'estado_cuenta_afore'], soloTitular: ['liquidacion_gemex'] },
  Fovissste: { comunes: ['validacion_credito_sofom', 'ultimo_talon_pago'], soloTitular: ['liquidacion_gemex'] },
  Bancario: { comunes: ['carta_autorizacion_banco'], soloTitular: ['liquidacion_gemex'] },
  Cofinavit: { comunes: ['precalificacion_infonavit', 'constancia_taller', 'estado_cuenta_afore'], soloTitular: ['carta_autorizacion_cofinavit', 'liquidacion_gemex'] },
};

export const docsRequeridos = (movimiento, persona = 'titular') => {
  const cfg = DOCS_FINANCIADO_ESPECIFICOS[movimiento?.tipo_compra];
  if (!cfg) return persona === 'titular' ? DOCS_ASESOR : [];
  const prefix = persona === 'coacreditado' ? 'coac_' : '';
  const base = docsBaseIdentidad(prefix);
  const comunes = cfg.comunes.map(id => ({ id: `${prefix}${id}`, opcional: false }));
  const soloTitular = persona === 'titular' ? cfg.soloTitular.map(id => ({ id, opcional: false })) : [];
  return [...base, ...comunes, ...soloTitular];
};

export const docsRequeridosCompletos = (movimiento) => {
  const titular = docsRequeridos(movimiento, 'titular');
  const coacreditado = movimiento?.tiene_coacreditado ? docsRequeridos(movimiento, 'coacreditado') : [];
  return [...titular, ...coacreditado, DOC_ORDEN_CONTRATO];
};

// true si TODOS los documentos requeridos del expediente ya están
// subidos y con estado_revision='aprobado' (o marcados no_aplica si son
// opcionales). `docs` es un mapa { tipo_documento: fila_expediente_documentos }.
export const expedienteAprobado = (movimiento, docs) => {
  if (!movimiento) return false;
  return docsRequeridosCompletos(movimiento).every(t => {
    const d = docs[t.id];
    if (t.opcional && d?.no_aplica) return true;
    return !!(d?.archivo_path || d?.archivos_json) && d?.estado_revision === 'aprobado';
  });
};
