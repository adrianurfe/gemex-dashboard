import React, { useState, useEffect } from 'react';
import { supabase } from './supabase';

const FRECUENCIAS = [
  { id: 'semanal', label: 'Semanal' },
  { id: 'quincenal', label: 'Quincenal' },
  { id: 'mensual', label: 'Mensual' },
];
const DIAS_SEMANA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState(window.innerWidth < 768);
  React.useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return isMobile;
}

export default function ReportesAutomaticos({ miRol }) {
  const isMobile = useIsMobile();
  const [desarrollos, setDesarrollos] = useState([]);
  const [configs, setConfigs] = useState({}); // desarrollo_id -> config
  const [loading, setLoading] = useState(true);
  const [guardandoId, setGuardandoId] = useState(null);
  const [nuevoCorreo, setNuevoCorreo] = useState({}); // desarrollo_id -> texto en el input

  const puedeVer = miRol === 'Super Admin' || miRol === 'Admin';

  useEffect(() => { if (puedeVer) cargarTodo(); }, [puedeVer]);

  const cargarTodo = async () => {
    setLoading(true);
    const [{ data: devs }, { data: cfgs }] = await Promise.all([
      supabase.from('desarrollos').select('id, nombre').eq('activo', true).order('nombre'),
      supabase.from('reportes_email_config').select('*'),
    ]);
    setDesarrollos(devs || []);
    const mapa = {};
    (cfgs || []).forEach(c => { mapa[c.desarrollo_id] = c; });
    setConfigs(mapa);
    setLoading(false);
  };

  const configDe = (desarrolloId) => configs[desarrolloId] || {
    desarrollo_id: desarrolloId, destinatarios: [], frecuencia: 'mensual', dia_envio: 1, activo: false,
  };

  const actualizarConfig = (desarrolloId, campo, valor) => {
    setConfigs(prev => ({ ...prev, [desarrolloId]: { ...configDe(desarrolloId), [campo]: valor } }));
  };

  const handleAgregarCorreo = (desarrolloId) => {
    const correo = (nuevoCorreo[desarrolloId] || '').trim().toLowerCase();
    if (!correo || !correo.includes('@')) return;
    const cfg = configDe(desarrolloId);
    if (cfg.destinatarios.includes(correo)) { setNuevoCorreo(prev => ({ ...prev, [desarrolloId]: '' })); return; }
    actualizarConfig(desarrolloId, 'destinatarios', [...cfg.destinatarios, correo]);
    setNuevoCorreo(prev => ({ ...prev, [desarrolloId]: '' }));
  };

  const handleQuitarCorreo = (desarrolloId, correo) => {
    const cfg = configDe(desarrolloId);
    actualizarConfig(desarrolloId, 'destinatarios', cfg.destinatarios.filter(c => c !== correo));
  };

  const handleGuardar = async (desarrolloId) => {
    setGuardandoId(desarrolloId);
    const cfg = configDe(desarrolloId);
    const payload = {
      desarrollo_id: desarrolloId,
      destinatarios: cfg.destinatarios,
      frecuencia: cfg.frecuencia,
      dia_envio: cfg.dia_envio,
      activo: cfg.activo,
    };
    const { data, error } = await supabase.from('reportes_email_config')
      .upsert(payload, { onConflict: 'desarrollo_id' }).select().single();
    setGuardandoId(null);
    if (!error && data) {
      setConfigs(prev => ({ ...prev, [desarrolloId]: data }));
    } else if (error) {
      alert('Error al guardar: ' + error.message);
    }
  };

  if (!puedeVer) {
    return <div style={{ padding: '2rem', textAlign: 'center', color: '#888' }}>No tienes acceso a este módulo</div>;
  }

  return (
    <div style={{ padding: isMobile ? '1rem' : '2rem' }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: isMobile ? '17px' : '20px', fontWeight: '500', color: '#1a1a2e', marginBottom: '4px' }}>Reportes Automáticos</h2>
        <div style={{ fontSize: '13px', color: '#888' }}>Configura a quién y cada cuánto se envía el reporte PDF de cada proyecto</div>
      </div>

      <div style={{ padding: '12px 16px', background: '#FFF8E1', color: '#856404', borderRadius: '8px', fontSize: '12px', marginBottom: '1.5rem' }}>
        ⚠️ El envío automático todavía no está activo — falta conectar el servicio de correo. Puedes configurar todo desde ahora; en cuanto esté conectado, empezará a mandarse solo según lo que dejes guardado aquí.
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', color: '#888', padding: '2rem' }}>Cargando...</div>
      ) : desarrollos.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#888', padding: '2rem' }}>Sin desarrollos activos</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {desarrollos.map(d => {
            const cfg = configDe(d.id);
            return (
              <div key={d.id} style={{ background: '#fff', border: '0.5px solid #e0e0e0', borderRadius: '12px', padding: isMobile ? '14px' : '18px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
                  <div style={{ fontSize: '14px', fontWeight: '600', color: '#1a1a2e' }}>{d.nombre}</div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#666', cursor: 'pointer' }}>
                    <input type='checkbox' checked={!!cfg.activo} onChange={e => actualizarConfig(d.id, 'activo', e.target.checked)}
                      style={{ width: '16px', height: '16px' }} />
                    Activo
                  </label>
                </div>

                <div style={{ marginBottom: '12px' }}>
                  <label style={{ fontSize: '11px', color: '#888', display: 'block', marginBottom: '6px' }}>Destinatarios</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
                    {cfg.destinatarios.length === 0 ? (
                      <span style={{ fontSize: '12px', color: '#ccc' }}>Sin destinatarios configurados</span>
                    ) : cfg.destinatarios.map(correo => (
                      <span key={correo} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 10px', background: '#f0f0f0', borderRadius: '20px', fontSize: '12px', color: '#333' }}>
                        {correo}
                        <button onClick={() => handleQuitarCorreo(d.id, correo)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#999', fontSize: '13px', padding: 0 }}>✕</button>
                      </span>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input value={nuevoCorreo[d.id] || ''} onChange={e => setNuevoCorreo(prev => ({ ...prev, [d.id]: e.target.value }))}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAgregarCorreo(d.id); } }}
                      placeholder='correo@ejemplo.com'
                      style={{ flex: 1, padding: '8px 12px', border: '0.5px solid #ddd', borderRadius: '6px', fontSize: '13px' }} />
                    <button onClick={() => handleAgregarCorreo(d.id)}
                      style={{ padding: '8px 16px', background: '#C0203A', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '13px', cursor: 'pointer' }}>
                      + Agregar
                    </button>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '12px' }}>
                  <div>
                    <label style={{ fontSize: '11px', color: '#888', display: 'block', marginBottom: '6px' }}>Frecuencia</label>
                    <select value={cfg.frecuencia} onChange={e => actualizarConfig(d.id, 'frecuencia', e.target.value)}
                      style={{ padding: '8px 12px', border: '0.5px solid #ddd', borderRadius: '6px', fontSize: '13px', background: '#fff' }}>
                      {FRECUENCIAS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: '11px', color: '#888', display: 'block', marginBottom: '6px' }}>
                      {cfg.frecuencia === 'semanal' ? 'Día de la semana' : 'Día del mes'}
                    </label>
                    {cfg.frecuencia === 'semanal' ? (
                      <select value={cfg.dia_envio} onChange={e => actualizarConfig(d.id, 'dia_envio', parseInt(e.target.value))}
                        style={{ padding: '8px 12px', border: '0.5px solid #ddd', borderRadius: '6px', fontSize: '13px', background: '#fff' }}>
                        {DIAS_SEMANA.map((dia, i) => <option key={i} value={i}>{dia}</option>)}
                      </select>
                    ) : (
                      <select value={cfg.dia_envio} onChange={e => actualizarConfig(d.id, 'dia_envio', parseInt(e.target.value))}
                        style={{ padding: '8px 12px', border: '0.5px solid #ddd', borderRadius: '6px', fontSize: '13px', background: '#fff' }}>
                        {Array.from({ length: 28 }, (_, i) => i + 1).map(n => <option key={n} value={n}>Día {n}</option>)}
                      </select>
                    )}
                  </div>
                  {cfg.ultimo_envio && (
                    <div style={{ fontSize: '11px', color: '#aaa' }}>
                      Último envío: {new Date(cfg.ultimo_envio).toLocaleDateString('es-MX')}
                    </div>
                  )}
                </div>

                <button onClick={() => handleGuardar(d.id)} disabled={guardandoId === d.id}
                  style={{ padding: '8px 20px', background: '#C0203A', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '13px', cursor: 'pointer', fontWeight: '500' }}>
                  {guardandoId === d.id ? 'Guardando...' : 'Guardar'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}