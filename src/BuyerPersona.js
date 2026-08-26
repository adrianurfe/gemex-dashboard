import React, { useState, useEffect } from 'react';
import { supabase } from './supabase';

const ROLES_GERENTE = ['Gerente Editor', 'Gerente Operador'];
const RANGOS_EDAD = [
  { label: '18-25', min: 18, max: 25 },
  { label: '26-35', min: 26, max: 35 },
  { label: '36-45', min: 36, max: 45 },
  { label: '46-55', min: 46, max: 55 },
  { label: '56-65', min: 56, max: 65 },
  { label: '66+', min: 66, max: 200 },
];

function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState(window.innerWidth < 768);
  React.useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return isMobile;
}

// FIX: nuevo dashboard — perfil demográfico de los compradores
// (Buyer Persona), a partir de los 4 campos que el asesor captura en
// Expedientes. Visible para Super Admin, Admin y los tres tipos de
// Gerente — cada Gerente ve solo lo de su(s) desarrollo(s), igual que ya
// pasa en el resto de Dirección.
export default function BuyerPersona({ miRol, miAgente }) {
  const isMobile = useIsMobile();
  const [contactosData, setContactosData] = useState([]);
  const [desarrollos, setDesarrollos] = useState([]);
  const [filtroDesarrollo, setFiltroDesarrollo] = useState('');
  const [loading, setLoading] = useState(true);

  const esMesaControl = miRol === 'Mesa de Control';
  const esGerente = ROLES_GERENTE.includes(miRol) || esMesaControl;

  const desarrollosPermitidos = esGerente
    ? desarrollos.filter(d => (miAgente?.desarrollos_cargo || []).includes(d.nombre))
    : desarrollos;

  useEffect(() => { cargarDesarrollos(); }, []);
  useEffect(() => { cargarContactos(); }, [filtroDesarrollo, miRol, miAgente, desarrollos]);

  const cargarDesarrollos = async () => {
    const { data } = await supabase.from('desarrollos').select('id, nombre').eq('activo', true).order('nombre');
    setDesarrollos(data || []);
  };

  const cargarContactos = async () => {
    if (desarrollos.length === 0) return;
    setLoading(true);
    let query = supabase.from('contactos').select('genero, estado_civil, edad, ocupacion_categoria, desarrollo, asesor_ventas')
      .not('genero', 'is', null);

    if (filtroDesarrollo) {
      query = query.eq('desarrollo', filtroDesarrollo);
    } else if (esGerente) {
      const cargo = miAgente?.desarrollos_cargo || [];
      if (cargo.length === 0) { setContactosData([]); setLoading(false); return; }
      query = query.in('desarrollo', cargo);
    }

    const { data } = await query.limit(10000);
    let filas = data || [];

    // FIX: Mesa de Control se limita además a "su gente" (él + agentes_cargo)
    if (esMesaControl) {
      const nombreCompleto = miAgente ? `${miAgente.nombre || ''} ${miAgente.apellidos || ''}`.trim() : '';
      const { data: equipoAgentes } = await supabase.from('agentes').select('nombre, apellidos, correo').in('correo', [miAgente?.correo, ...(miAgente?.agentes_cargo || [])].filter(Boolean));
      const nombresEquipo = new Set([nombreCompleto, ...(equipoAgentes || []).map(a => `${a.nombre || ''} ${a.apellidos || ''}`.trim())].filter(Boolean));
      filas = filas.filter(c => nombresEquipo.has(c.asesor_ventas));
    }

    setContactosData(filas);
    setLoading(false);
  };

  const total = contactosData.length;

  const porGenero = ['Hombre', 'Mujer'].map(g => ({
    label: g, count: contactosData.filter(c => c.genero === g).length,
  }));

  const porEstadoCivil = ['Casado', 'Soltero'].map(e => ({
    label: e, count: contactosData.filter(c => c.estado_civil === e).length,
  }));

  const porEdad = RANGOS_EDAD.map(r => ({
    label: r.label, count: contactosData.filter(c => c.edad >= r.min && c.edad <= r.max).length,
  }));

  const porOcupacion = (() => {
    const mapa = {};
    contactosData.forEach(c => {
      const key = c.ocupacion_categoria || 'Sin categoría';
      mapa[key] = (mapa[key] || 0) + 1;
    });
    return Object.entries(mapa).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count).slice(0, 8);
  })();

  const Barra = ({ label, count, max, color }) => (
    <div style={{ marginBottom: '10px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '4px' }}>
        <span style={{ color: '#333' }}>{label}</span>
        <span style={{ fontWeight: '600', color: '#1a1a2e' }}>{count} {total > 0 ? `(${Math.round((count / total) * 100)}%)` : ''}</span>
      </div>
      <div style={{ height: '8px', background: '#f0f0f0', borderRadius: '4px' }}>
        <div style={{ height: '100%', background: color, borderRadius: '4px', width: `${max > 0 ? (count / max) * 100 : 0}%`, transition: 'width 0.4s' }} />
      </div>
    </div>
  );

  // FIX: gráfica de pastel (dona) con leyenda — usada en Género, Estado
  // civil y Rango de edad. Top 8 ocupaciones se queda en barras porque
  // con 8 categorías un pastel se satura y es más difícil de leer.
  const Pastel = ({ datos, colores }) => {
    const totalLocal = datos.reduce((s, d) => s + d.count, 0);
    if (totalLocal === 0) return <div style={{ fontSize: '13px', color: '#aaa', textAlign: 'center', padding: '1.5rem' }}>Sin datos todavía</div>;
    let offset = 0;
    const r = 55; const cx = 70; const cy = 70;
    return (
      <div style={{ display: 'flex', gap: '20px', alignItems: 'center', flexWrap: 'wrap' }}>
        <svg width="140" height="140" viewBox="0 0 140 140" style={{ flexShrink: 0 }}>
          {datos.filter(d => d.count > 0).map((d, i) => {
            const angle = (d.count / totalLocal) * 360;
            const startAngle = offset; offset += angle;
            const toRad = a => (a - 90) * Math.PI / 180;
            const x1 = cx + r * Math.cos(toRad(startAngle));
            const y1 = cy + r * Math.sin(toRad(startAngle));
            const x2 = cx + r * Math.cos(toRad(startAngle + angle));
            const y2 = cy + r * Math.sin(toRad(startAngle + angle));
            const grande = angle > 180 ? 1 : 0;
            if (datos.filter(x => x.count > 0).length === 1) {
              return <circle key={i} cx={cx} cy={cy} r={r} fill={colores[i % colores.length]} />;
            }
            return <path key={i} d={`M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${grande} 1 ${x2} ${y2} Z`} fill={colores[i % colores.length]} stroke="#fff" strokeWidth="2" />;
          })}
          <circle cx={cx} cy={cy} r="32" fill="#fff" />
          <text x={cx} y={cy - 4} textAnchor="middle" fontSize="16" fontWeight="700" fill="#1a1a2e">{totalLocal}</text>
          <text x={cx} y={cy + 12} textAnchor="middle" fontSize="9" fill="#888">total</text>
        </svg>
        <div style={{ flex: 1, minWidth: '140px' }}>
          {datos.map((d, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: colores[i % colores.length], flexShrink: 0 }} />
              <div style={{ flex: 1, fontSize: '12px', color: '#333' }}>{d.label}</div>
              <div style={{ fontSize: '12px', fontWeight: '600', color: '#1a1a2e' }}>
                {d.count} {totalLocal > 0 ? `(${Math.round((d.count / totalLocal) * 100)}%)` : ''}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const TarjetaPastel = ({ titulo, datos, colores }) => (
    <div style={{ background: '#fff', border: '0.5px solid #e0e0e0', borderRadius: '12px', padding: '1.25rem' }}>
      <div style={{ fontSize: '13px', fontWeight: '600', color: '#555', marginBottom: '14px' }}>{titulo}</div>
      <Pastel datos={datos} colores={colores} />
    </div>
  );

  const Tarjeta = ({ titulo, datos, color }) => {
    const max = Math.max(...datos.map(d => d.count), 1);
    return (
      <div style={{ background: '#fff', border: '0.5px solid #e0e0e0', borderRadius: '12px', padding: '1.25rem' }}>
        <div style={{ fontSize: '13px', fontWeight: '600', color: '#555', marginBottom: '14px' }}>{titulo}</div>
        {datos.every(d => d.count === 0) ? (
          <div style={{ fontSize: '13px', color: '#aaa', textAlign: 'center', padding: '1.5rem' }}>Sin datos todavía</div>
        ) : datos.map((d, i) => <Barra key={i} label={d.label} count={d.count} max={max} color={color} />)}
      </div>
    );
  };

  return (
    <div style={{ padding: isMobile ? '1rem' : '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <h2 style={{ fontSize: isMobile ? '17px' : '20px', fontWeight: '500', color: '#1a1a2e', marginBottom: '4px' }}>Buyer Persona</h2>
          <div style={{ fontSize: '13px', color: '#888' }}>{total} compradores con datos capturados</div>
        </div>
        <select value={filtroDesarrollo} onChange={e => setFiltroDesarrollo(e.target.value)}
          style={{ padding: '8px 14px', border: '0.5px solid #ddd', borderRadius: '8px', fontSize: '13px', background: '#fff', minWidth: isMobile ? '100%' : '200px' }}>
          <option value=''>Todos los proyectos</option>
          {desarrollosPermitidos.map(d => <option key={d.id} value={d.nombre}>{d.nombre}</option>)}
        </select>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', color: '#888', padding: '2rem' }}>Cargando...</div>
      ) : total === 0 ? (
        <div style={{ textAlign: 'center', color: '#aaa', padding: '3rem', background: '#fff', border: '0.5px solid #e0e0e0', borderRadius: '12px', fontSize: '13px' }}>
          Todavía no hay compradores con el Buyer Persona capturado en Expedientes.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '16px' }}>
          <TarjetaPastel titulo="Género" datos={porGenero} colores={['#3B82F6', '#EC4899']} />
          <TarjetaPastel titulo="Estado civil" datos={porEstadoCivil} colores={['#8B5CF6', '#F59E0B']} />
          <TarjetaPastel titulo="Rango de edad" datos={porEdad} colores={['#10B981', '#3B82F6', '#8B5CF6', '#F59E0B', '#EC4899', '#EF4444']} />
          <Tarjeta titulo="Categorías de ocupación (top 8)" datos={porOcupacion} color="#F59E0B" />
        </div>
      )}
    </div>
  );
}