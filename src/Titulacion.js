import React, { useState, useEffect } from 'react';
import { supabase } from './supabase';

// FIX: primera fase del proceso de Titulación y Cobranza (checklist),
// pedido por el equipo de Titulación vía notas a mano. Cada unidad
// Vendida pasa por 3 etapas: Contrato y Expediente -> Titulación ->
// Escriturado. El Paso 1 (Avance obra %, DTU, Lista para avalúo)
// habilita el paso a "Titulación"; el Paso 2 (Avalúo, Saldo cobrado,
// Asignar SOFOM, Autorización financiera 1/2, Liquidación final, Carta
// liberación) habilita el paso a "Escriturado". CNA/Agua y
// Cuotas/Predial son trámites posteriores a la carta de liberación.
const ROLES_GERENTE = ['Gerente Editor', 'Gerente Operador'];

const PASO1 = [
  { campo: 'dtu', label: 'DTU' },
  { campo: 'lista_avaluo', label: 'Lista para avalúo' },
];
const PASO2 = [
  { campo: 'avaluo', label: 'Avalúo' },
  { campo: 'saldo_cobrado', label: 'Saldo cobrado' },
  { campo: 'asignar_sofom', label: 'Asignar SOFOM' },
  { campo: 'autorizacion_financiera_1', label: 'Autorización financiera 1' },
  { campo: 'autorizacion_financiera_2', label: 'Autorización financiera 2' },
  { campo: 'liquidacion_final', label: 'Liquidación final' },
  { campo: 'carta_liberacion', label: 'Carta liberación' },
];
const TRAMITES = [
  { campo: 'cna_agua', label: 'CNA / Agua' },
  { campo: 'cuotas_predial', label: 'Cuotas / Predial' },
];

const VACIO = {
  avance_obra_pct: 0, dtu: false, lista_avaluo: false,
  avaluo: false, saldo_cobrado: false, asignar_sofom: false,
  autorizacion_financiera_1: false, autorizacion_financiera_2: false,
  liquidacion_final: false, carta_liberacion: false,
  cna_agua: false, cuotas_predial: false,
};

function calcularEtapa(s) {
  const paso1 = s.dtu && s.lista_avaluo;
  const paso2 = paso1 && PASO2.every(p => s[p.campo]);
  if (paso2) return 'Escriturado';
  if (paso1) return 'Titulación';
  return 'Contrato y Expediente';
}

const COLOR_ETAPA = {
  'Contrato y Expediente': '#F59E0B',
  'Titulación': '#3B82F6',
  'Escriturado': '#10B981',
};

function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState(window.innerWidth < 768);
  React.useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return isMobile;
}

export default function Titulacion({ miRol, miAgente }) {
  const isMobile = useIsMobile();
  const [desarrollos, setDesarrollos] = useState([]);
  const [unidades, setUnidades] = useState([]);
  const [seguimientos, setSeguimientos] = useState({}); // unidad_id -> row
  const [compradores, setCompradores] = useState({}); // unidad_id -> contacto_nombre
  const [desarrolloSel, setDesarrolloSel] = useState('');
  const [etapaSel, setEtapaSel] = useState('');
  const [cargando, setCargando] = useState(true);
  const [unidadAbierta, setUnidadAbierta] = useState(null); // unidad completa
  const [form, setForm] = useState(VACIO);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => { cargarTodo(); }, []);

  const desarrollosPermitidos = ROLES_GERENTE.includes(miRol)
    ? desarrollos.filter(d => (miAgente?.desarrollos_cargo || []).includes(d.nombre))
    : desarrollos;
  const idsPermitidos = desarrollosPermitidos.map(d => d.id);

  const cargarTodo = async () => {
    setCargando(true);
    const { data: des } = await supabase.from('desarrollos').select('id, nombre').eq('activo', true).order('nombre');
    setDesarrollos(des || []);

    const mapaNombres = {};
    (des || []).forEach(d => { mapaNombres[d.id] = d.nombre; });

    const { data: inv } = await supabase.from('inventario')
      .select('id, numero, desarrollo_id, precio_lista_respaldo')
      .eq('estatus', 'Vendido')
      .order('numero');
    const invConNombre = (inv || []).map(u => ({ ...u, desarrollo_nombre: mapaNombres[u.desarrollo_id] || '' }));
    setUnidades(invConNombre);

    const unidadIds = (inv || []).map(u => u.id);
    if (unidadIds.length > 0) {
      const { data: seg } = await supabase.from('titulacion_seguimiento').select('*').in('unidad_id', unidadIds);
      const mapa = {};
      (seg || []).forEach(s => { mapa[s.unidad_id] = s; });
      setSeguimientos(mapa);

      const { data: movs } = await supabase.from('movimientos')
        .select('unidad_id, contacto_nombre, created_at')
        .eq('tipo', 'Vendida')
        .in('unidad_id', unidadIds)
        .order('created_at', { ascending: false });
      const mapaComp = {};
      (movs || []).forEach(m => { if (!mapaComp[m.unidad_id]) mapaComp[m.unidad_id] = m.contacto_nombre; });
      setCompradores(mapaComp);
    } else {
      setSeguimientos({});
      setCompradores({});
    }
    setCargando(false);
  };

  const unidadesVisibles = unidades.filter(u => {
    if (ROLES_GERENTE.includes(miRol) && !idsPermitidos.includes(u.desarrollo_id)) return false;
    if (desarrolloSel && u.desarrollo_nombre !== desarrolloSel) return false;
    if (etapaSel) {
      const s = seguimientos[u.id] || VACIO;
      if (calcularEtapa(s) !== etapaSel) return false;
    }
    return true;
  });

  const abrirUnidad = (u) => {
    setUnidadAbierta(u);
    setForm({ ...VACIO, ...(seguimientos[u.id] || {}) });
  };

  const guardar = async () => {
    setGuardando(true);
    const { data: { user } } = await supabase.auth.getUser();
    const payload = {
      unidad_id: unidadAbierta.id,
      desarrollo_id: unidadAbierta.desarrollo_id,
      ...form,
      actualizado_por: user?.email || null,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await supabase.from('titulacion_seguimiento')
      .upsert(payload, { onConflict: 'unidad_id' })
      .select().single();
    setGuardando(false);
    if (!error && data) {
      setSeguimientos(prev => ({ ...prev, [unidadAbierta.id]: data }));
      setUnidadAbierta(null);
    }
  };

  const conteos = { 'Contrato y Expediente': 0, 'Titulación': 0, 'Escriturado': 0 };
  unidadesVisibles.forEach(u => { conteos[calcularEtapa(seguimientos[u.id] || VACIO)]++; });

  return (
    <div style={{ padding: isMobile ? '1rem' : '2rem' }}>
      <h2 style={{ fontSize: isMobile ? '16px' : '20px', fontWeight: '500', color: '#1a1a2e', marginBottom: '4px' }}>Titulación</h2>
      <div style={{ fontSize: '12px', color: '#888', marginBottom: '1rem' }}>Seguimiento de unidades vendidas hasta escrituración</div>

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <select value={desarrolloSel} onChange={e => setDesarrolloSel(e.target.value)}
          style={{ padding: '8px 12px', border: '0.5px solid #ddd', borderRadius: '8px', fontSize: '13px', background: '#fff' }}>
          <option value=''>Todos los proyectos</option>
          {desarrollosPermitidos.map(d => <option key={d.id} value={d.nombre}>{d.nombre}</option>)}
        </select>
        <select value={etapaSel} onChange={e => setEtapaSel(e.target.value)}
          style={{ padding: '8px 12px', border: '0.5px solid #ddd', borderRadius: '8px', fontSize: '13px', background: '#fff' }}>
          <option value=''>Todas las etapas</option>
          {Object.keys(COLOR_ETAPA).map(e => <option key={e} value={e}>{e}</option>)}
        </select>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr 1fr' : 'repeat(3, 1fr)', gap: '10px', marginBottom: '1.5rem', maxWidth: isMobile ? 'none' : '600px' }}>
        {Object.entries(conteos).map(([etapa, n]) => (
          <div key={etapa} style={{ background: '#fff', border: `2px solid ${COLOR_ETAPA[etapa]}`, borderRadius: '12px', padding: '12px' }}>
            <div style={{ fontSize: '20px', fontWeight: '700', color: '#1a1a2e' }}>{n}</div>
            <div style={{ fontSize: '11px', color: '#888' }}>{etapa}</div>
          </div>
        ))}
      </div>

      {cargando ? (
        <div style={{ color: '#888', fontSize: '13px' }}>Cargando...</div>
      ) : unidadesVisibles.length === 0 ? (
        <div style={{ color: '#888', fontSize: '13px' }}>No hay unidades que coincidan con el filtro.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {unidadesVisibles.map(u => {
            const s = seguimientos[u.id] || VACIO;
            const etapa = calcularEtapa(s);
            const totalItems = PASO1.length + PASO2.length;
            const hechos = PASO1.filter(p => s[p.campo]).length + PASO2.filter(p => s[p.campo]).length;
            return (
              <div key={u.id} onClick={() => abrirUnidad(u)}
                style={{ background: '#fff', border: '0.5px solid #e0e0e0', borderRadius: '10px', padding: '12px 16px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: '14px', fontWeight: '600', color: '#1a1a2e' }}>{u.numero} — {u.desarrollo_nombre}</div>
                  <div style={{ fontSize: '12px', color: '#888' }}>{compradores[u.id] || 'Sin comprador registrado'}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ fontSize: '11px', color: '#888' }}>{hechos}/{totalItems} pasos</div>
                  <div style={{ fontSize: '11px', fontWeight: '700', color: '#fff', background: COLOR_ETAPA[etapa], borderRadius: '20px', padding: '4px 12px' }}>{etapa}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {unidadAbierta && (
        <div onClick={() => setUnidadAbierta(null)}
          style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: '14px', padding: '1.5rem', width: '100%', maxWidth: '480px', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ fontSize: '16px', fontWeight: '700', color: '#1a1a2e', marginBottom: '2px' }}>{unidadAbierta.numero} — {unidadAbierta.desarrollo_nombre}</div>
            <div style={{ fontSize: '12px', color: '#888', marginBottom: '4px' }}>{compradores[unidadAbierta.id] || 'Sin comprador registrado'}</div>
            <div style={{ fontSize: '11px', fontWeight: '700', color: '#fff', background: COLOR_ETAPA[calcularEtapa(form)], borderRadius: '20px', padding: '4px 12px', display: 'inline-block', marginBottom: '16px' }}>
              {calcularEtapa(form)}
            </div>

            <div style={{ fontSize: '13px', fontWeight: '600', color: '#1a1a2e', marginBottom: '8px' }}>Paso 1 — Contrato a Titulación</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
              <label style={{ fontSize: '13px', color: '#555' }}>Avance de obra</label>
              <input type="number" min="0" max="100" value={form.avance_obra_pct}
                onChange={e => setForm(f => ({ ...f, avance_obra_pct: e.target.value }))}
                style={{ width: '70px', padding: '6px 8px', border: '0.5px solid #ddd', borderRadius: '6px', fontSize: '13px' }} />
              <span style={{ fontSize: '13px', color: '#555' }}>%</span>
            </div>
            {PASO1.map(p => (
              <label key={p.campo} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#333', marginBottom: '8px', cursor: 'pointer' }}>
                <input type="checkbox" checked={!!form[p.campo]} onChange={e => setForm(f => ({ ...f, [p.campo]: e.target.checked }))} />
                {p.label}
              </label>
            ))}

            <div style={{ fontSize: '13px', fontWeight: '600', color: '#1a1a2e', margin: '16px 0 8px' }}>Paso 2 — Titulación a Escritura</div>
            {PASO2.map(p => (
              <label key={p.campo} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#333', marginBottom: '8px', cursor: 'pointer' }}>
                <input type="checkbox" checked={!!form[p.campo]} onChange={e => setForm(f => ({ ...f, [p.campo]: e.target.checked }))} />
                {p.label}
              </label>
            ))}

            <div style={{ fontSize: '13px', fontWeight: '600', color: '#1a1a2e', margin: '16px 0 8px' }}>Trámites tras carta de liberación</div>
            {TRAMITES.map(p => (
              <label key={p.campo} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#333', marginBottom: '8px', cursor: 'pointer' }}>
                <input type="checkbox" checked={!!form[p.campo]} onChange={e => setForm(f => ({ ...f, [p.campo]: e.target.checked }))} />
                {p.label}
              </label>
            ))}

            <div style={{ display: 'flex', gap: '8px', marginTop: '20px' }}>
              <button onClick={() => setUnidadAbierta(null)}
                style={{ flex: 1, padding: '10px', background: '#fff', color: '#666', border: '0.5px solid #ddd', borderRadius: '8px', fontSize: '13px', cursor: 'pointer' }}>
                Cancelar
              </button>
              <button onClick={guardar} disabled={guardando}
                style={{ flex: 1, padding: '10px', background: '#C0203A', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '13px', cursor: 'pointer' }}>
                {guardando ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
