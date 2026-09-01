import React, { useState, useEffect } from 'react';
import { supabase } from './supabase';

// FIX: segunda fase del proceso de Titulación y Cobranza (dinero), pedido
// por el equipo vía notas a mano. Por unidad Vendida se captura Valor
// venta / Tipo de crédito, una lista de abonos de enganche que Tesorería
// va agregando (fecha + monto), y los montos de las financieras. La
// fórmula sigue el orden de las notas:
//   Diferencia por cubrir = Valor venta - total de abonos
//   Saldo neto = Diferencia por cubrir - Financiera 1 - Financiera 2
//   Remanente = Financiera 1 + Financiera 2 - Liberación
const ROLES_GERENTE = ['Gerente Editor', 'Gerente Operador'];
const TIPO_CREDITO_OPCIONES = ['Contado', 'Infonavit', 'Fovissste', 'Bancario', 'Cofinavit'];
const fmt = (n) => `$${Number(n || 0).toLocaleString('es-MX', { maximumFractionDigits: 0 })}`;

const SEG_VACIO = {
  valor_venta: 0, tipo_credito: 'Contado',
  financiera_1_monto: 0, financiera_2_monto: 0, liberacion_monto: 0,
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

export default function Cobranza({ miRol, miAgente }) {
  const isMobile = useIsMobile();
  const [desarrollos, setDesarrollos] = useState([]);
  const [unidades, setUnidades] = useState([]);
  const [seguimientos, setSeguimientos] = useState({}); // unidad_id -> row
  const [pagosPorUnidad, setPagosPorUnidad] = useState({}); // unidad_id -> [pagos]
  const [compradores, setCompradores] = useState({});
  const [desarrolloSel, setDesarrolloSel] = useState('');
  const [cargando, setCargando] = useState(true);
  const [unidadAbierta, setUnidadAbierta] = useState(null);
  const [form, setForm] = useState(SEG_VACIO);
  const [nuevoPago, setNuevoPago] = useState({ fecha: new Date().toISOString().slice(0, 10), monto: '' });
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
      .select('id, numero, desarrollo_id')
      .eq('estatus', 'Vendido')
      .order('numero');
    const invConNombre = (inv || []).map(u => ({ ...u, desarrollo_nombre: mapaNombres[u.desarrollo_id] || '' }));
    setUnidades(invConNombre);

    const unidadIds = (inv || []).map(u => u.id);
    if (unidadIds.length > 0) {
      const { data: seg } = await supabase.from('cobranza_seguimiento').select('*').in('unidad_id', unidadIds);
      const mapa = {};
      (seg || []).forEach(s => { mapa[s.unidad_id] = s; });
      setSeguimientos(mapa);

      const { data: pagos } = await supabase.from('cobranza_pagos').select('*').in('unidad_id', unidadIds).order('fecha');
      const mapaPagos = {};
      (pagos || []).forEach(p => { (mapaPagos[p.unidad_id] = mapaPagos[p.unidad_id] || []).push(p); });
      setPagosPorUnidad(mapaPagos);

      const { data: movs } = await supabase.from('movimientos')
        .select('unidad_id, contacto_nombre, monto, created_at')
        .eq('tipo', 'Vendida')
        .in('unidad_id', unidadIds)
        .order('created_at', { ascending: false });
      const mapaComp = {};
      (movs || []).forEach(m => { if (!mapaComp[m.unidad_id]) mapaComp[m.unidad_id] = m; });
      setCompradores(mapaComp);
    } else {
      setSeguimientos({});
      setPagosPorUnidad({});
      setCompradores({});
    }
    setCargando(false);
  };

  const unidadesVisibles = unidades.filter(u => {
    if (ROLES_GERENTE.includes(miRol) && !idsPermitidos.includes(u.desarrollo_id)) return false;
    if (desarrolloSel && u.desarrollo_nombre !== desarrolloSel) return false;
    return true;
  });

  const totalPagos = (unidadId) => (pagosPorUnidad[unidadId] || []).reduce((s, p) => s + Number(p.monto || 0), 0);

  const calc = (unidadId, s) => {
    const pagado = totalPagos(unidadId);
    const diferenciaPorCubrir = Number(s.valor_venta || 0) - pagado;
    const saldoNeto = diferenciaPorCubrir - Number(s.financiera_1_monto || 0) - Number(s.financiera_2_monto || 0);
    const remanente = Number(s.financiera_1_monto || 0) + Number(s.financiera_2_monto || 0) - Number(s.liberacion_monto || 0);
    return { pagado, diferenciaPorCubrir, saldoNeto, remanente };
  };

  const abrirUnidad = (u) => {
    setUnidadAbierta(u);
    const s = seguimientos[u.id] || { ...SEG_VACIO, valor_venta: compradores[u.id]?.monto || 0 };
    setForm({ ...SEG_VACIO, ...s });
    setNuevoPago({ fecha: new Date().toISOString().slice(0, 10), monto: '' });
  };

  const guardarSeguimiento = async () => {
    setGuardando(true);
    const { data: { user } } = await supabase.auth.getUser();
    const payload = {
      unidad_id: unidadAbierta.id,
      desarrollo_id: unidadAbierta.desarrollo_id,
      valor_venta: Number(form.valor_venta) || 0,
      tipo_credito: form.tipo_credito,
      financiera_1_monto: Number(form.financiera_1_monto) || 0,
      financiera_2_monto: Number(form.financiera_2_monto) || 0,
      liberacion_monto: Number(form.liberacion_monto) || 0,
      actualizado_por: user?.email || null,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await supabase.from('cobranza_seguimiento')
      .upsert(payload, { onConflict: 'unidad_id' })
      .select().single();
    setGuardando(false);
    if (!error && data) {
      setSeguimientos(prev => ({ ...prev, [unidadAbierta.id]: data }));
    }
  };

  const agregarPago = async () => {
    if (!nuevoPago.monto || Number(nuevoPago.monto) <= 0) return;
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase.from('cobranza_pagos').insert([{
      unidad_id: unidadAbierta.id,
      fecha: nuevoPago.fecha,
      monto: Number(nuevoPago.monto),
      capturado_por: user?.email || null,
    }]).select().single();
    if (!error && data) {
      setPagosPorUnidad(prev => ({ ...prev, [unidadAbierta.id]: [...(prev[unidadAbierta.id] || []), data] }));
      setNuevoPago({ fecha: new Date().toISOString().slice(0, 10), monto: '' });
    }
  };

  const eliminarPago = async (pagoId) => {
    await supabase.from('cobranza_pagos').delete().eq('id', pagoId);
    setPagosPorUnidad(prev => ({ ...prev, [unidadAbierta.id]: (prev[unidadAbierta.id] || []).filter(p => p.id !== pagoId) }));
  };

  return (
    <div style={{ padding: isMobile ? '1rem' : '2rem' }}>
      <h2 style={{ fontSize: isMobile ? '16px' : '20px', fontWeight: '500', color: '#1a1a2e', marginBottom: '4px' }}>Cobranza</h2>
      <div style={{ fontSize: '12px', color: '#888', marginBottom: '1rem' }}>Enganche, pagos y financieras por unidad vendida</div>

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
        <select value={desarrolloSel} onChange={e => setDesarrolloSel(e.target.value)}
          style={{ padding: '8px 12px', border: '0.5px solid #ddd', borderRadius: '8px', fontSize: '13px', background: '#fff' }}>
          <option value=''>Todos los proyectos</option>
          {desarrollosPermitidos.map(d => <option key={d.id} value={d.nombre}>{d.nombre}</option>)}
        </select>
      </div>

      {cargando ? (
        <div style={{ color: '#888', fontSize: '13px' }}>Cargando...</div>
      ) : unidadesVisibles.length === 0 ? (
        <div style={{ color: '#888', fontSize: '13px' }}>No hay unidades que coincidan con el filtro.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {unidadesVisibles.map(u => {
            const s = seguimientos[u.id] || SEG_VACIO;
            const { pagado, saldoNeto } = calc(u.id, s);
            return (
              <div key={u.id} onClick={() => abrirUnidad(u)}
                style={{ background: '#fff', border: '0.5px solid #e0e0e0', borderRadius: '10px', padding: '12px 16px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: '14px', fontWeight: '600', color: '#1a1a2e' }}>{u.numero} — {u.desarrollo_nombre}</div>
                  <div style={{ fontSize: '12px', color: '#888' }}>{compradores[u.id]?.contacto_nombre || 'Sin comprador registrado'}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                  <div style={{ fontSize: '12px', color: '#888' }}>Pagado: <span style={{ color: '#1a1a2e', fontWeight: '600' }}>{fmt(pagado)}</span></div>
                  <div style={{ fontSize: '11px', fontWeight: '700', color: '#fff', background: saldoNeto <= 0 ? '#10B981' : '#F59E0B', borderRadius: '20px', padding: '4px 12px' }}>
                    Saldo neto: {fmt(saldoNeto)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {unidadAbierta && (() => {
        const { pagado, diferenciaPorCubrir, saldoNeto, remanente } = calc(unidadAbierta.id, form);
        const pagos = pagosPorUnidad[unidadAbierta.id] || [];
        return (
          <div onClick={() => setUnidadAbierta(null)}
            style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
            <div onClick={e => e.stopPropagation()}
              style={{ background: '#fff', borderRadius: '14px', padding: '1.5rem', width: '100%', maxWidth: '520px', maxHeight: '90vh', overflowY: 'auto' }}>
              <div style={{ fontSize: '16px', fontWeight: '700', color: '#1a1a2e', marginBottom: '2px' }}>{unidadAbierta.numero} — {unidadAbierta.desarrollo_nombre}</div>
              <div style={{ fontSize: '12px', color: '#888', marginBottom: '16px' }}>{compradores[unidadAbierta.id]?.contacto_nombre || 'Sin comprador registrado'}</div>

              <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '12px', color: '#555', display: 'block', marginBottom: '4px' }}>Valor venta</label>
                  <input type="number" value={form.valor_venta}
                    onChange={e => setForm(f => ({ ...f, valor_venta: e.target.value }))}
                    style={{ width: '100%', padding: '8px 10px', border: '0.5px solid #ddd', borderRadius: '8px', fontSize: '13px', boxSizing: 'border-box' }} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '12px', color: '#555', display: 'block', marginBottom: '4px' }}>Tipo de crédito</label>
                  <select value={form.tipo_credito} onChange={e => setForm(f => ({ ...f, tipo_credito: e.target.value }))}
                    style={{ width: '100%', padding: '8px 10px', border: '0.5px solid #ddd', borderRadius: '8px', fontSize: '13px', background: '#fff' }}>
                    {TIPO_CREDITO_OPCIONES.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
              </div>

              <div style={{ fontSize: '13px', fontWeight: '600', color: '#1a1a2e', margin: '16px 0 8px' }}>Enganche y pagos</div>
              {pagos.length > 0 && (
                <div style={{ marginBottom: '8px' }}>
                  {pagos.map(p => (
                    <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '0.5px solid #f0f0f0', fontSize: '13px' }}>
                      <span style={{ color: '#888' }}>{p.fecha}</span>
                      <span style={{ color: '#1a1a2e', fontWeight: '600' }}>{fmt(p.monto)}</span>
                      <button onClick={() => eliminarPago(p.id)}
                        style={{ border: 'none', background: 'none', color: '#EF4444', cursor: 'pointer', fontSize: '12px' }}>Eliminar</button>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                <input type="date" value={nuevoPago.fecha} onChange={e => setNuevoPago(p => ({ ...p, fecha: e.target.value }))}
                  style={{ flex: 1, padding: '8px 10px', border: '0.5px solid #ddd', borderRadius: '8px', fontSize: '13px' }} />
                <input type="number" placeholder="Monto" value={nuevoPago.monto} onChange={e => setNuevoPago(p => ({ ...p, monto: e.target.value }))}
                  style={{ flex: 1, padding: '8px 10px', border: '0.5px solid #ddd', borderRadius: '8px', fontSize: '13px' }} />
                <button onClick={agregarPago}
                  style={{ padding: '8px 14px', background: '#1a1a2e', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '13px', cursor: 'pointer' }}>
                  + Agregar
                </button>
              </div>
              <div style={{ fontSize: '12px', color: '#888', marginBottom: '16px' }}>Total abonado: <strong style={{ color: '#1a1a2e' }}>{fmt(pagado)}</strong></div>

              <div style={{ background: '#f9f9f9', borderRadius: '10px', padding: '12px', fontSize: '13px', marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <span style={{ color: '#555' }}>Diferencia por cubrir</span>
                  <span style={{ fontWeight: '600' }}>{fmt(diferenciaPorCubrir)}</span>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '12px', color: '#555', display: 'block', marginBottom: '4px' }}>Financiera 1</label>
                  <input type="number" value={form.financiera_1_monto}
                    onChange={e => setForm(f => ({ ...f, financiera_1_monto: e.target.value }))}
                    style={{ width: '100%', padding: '8px 10px', border: '0.5px solid #ddd', borderRadius: '8px', fontSize: '13px', boxSizing: 'border-box' }} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '12px', color: '#555', display: 'block', marginBottom: '4px' }}>Financiera 2</label>
                  <input type="number" value={form.financiera_2_monto}
                    onChange={e => setForm(f => ({ ...f, financiera_2_monto: e.target.value }))}
                    style={{ width: '100%', padding: '8px 10px', border: '0.5px solid #ddd', borderRadius: '8px', fontSize: '13px', boxSizing: 'border-box' }} />
                </div>
              </div>
              <div style={{ marginBottom: '10px' }}>
                <label style={{ fontSize: '12px', color: '#555', display: 'block', marginBottom: '4px' }}>Liberación</label>
                <input type="number" value={form.liberacion_monto}
                  onChange={e => setForm(f => ({ ...f, liberacion_monto: e.target.value }))}
                  style={{ width: '100%', padding: '8px 10px', border: '0.5px solid #ddd', borderRadius: '8px', fontSize: '13px', boxSizing: 'border-box' }} />
              </div>

              <div style={{ background: '#f9f9f9', borderRadius: '10px', padding: '12px', fontSize: '13px', marginBottom: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <span style={{ color: '#555' }}>Saldo neto</span>
                  <span style={{ fontWeight: '700', color: saldoNeto <= 0 ? '#10B981' : '#F59E0B' }}>{fmt(saldoNeto)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#555' }}>Remanente</span>
                  <span style={{ fontWeight: '700', color: '#1a1a2e' }}>{fmt(remanente)}</span>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={() => setUnidadAbierta(null)}
                  style={{ flex: 1, padding: '10px', background: '#fff', color: '#666', border: '0.5px solid #ddd', borderRadius: '8px', fontSize: '13px', cursor: 'pointer' }}>
                  Cerrar
                </button>
                <button onClick={guardarSeguimiento} disabled={guardando}
                  style={{ flex: 1, padding: '10px', background: '#C0203A', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '13px', cursor: 'pointer' }}>
                  {guardando ? 'Guardando...' : 'Guardar'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
