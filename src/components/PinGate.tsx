import React from 'react';
import {
  ArrowRight,
  Building2,
  LayoutDashboard,
  Megaphone,
  Receipt,
  ShieldCheck,
} from 'lucide-react';
import { TEAM_PROFILES, type TeamMember } from '../types';

interface PinGateProps {
  onUnlock: (member: TeamMember) => void;
}

const PROFILE_META: Record<
  TeamMember,
  {
    destination: string;
    icon: React.ComponentType<{ className?: string }>;
  }
> = {
  Ramiro: {
    destination: 'Resumen de todas las áreas',
    icon: LayoutDashboard,
  },
  Marketing: {
    destination: 'Ir a Marketing y Meta',
    icon: Megaphone,
  },
  Miguel: {
    destination: 'Ir a Empresas',
    icon: Building2,
  },
  Nahuel: {
    destination: 'Ir a Cobranzas',
    icon: Receipt,
  },
};

export const PinGate: React.FC<PinGateProps> = ({ onUnlock }) => {
  return (
    <div className="min-h-screen bg-[#101014] text-white flex flex-col lg:flex-row">
      {/* Left Brand Panel */}
      <div className="lg:w-[46%] p-8 lg:p-14 flex flex-col justify-between border-b lg:border-b-0 lg:border-r border-white/10">
        <div>
          <div className="flex items-center gap-3 mb-12">
            <div className="w-10 h-10 rounded-full overflow-hidden flex items-center justify-center shrink-0">
              <img
                src="/assets/aistudio/Logo_bt_3bfe4e47.png"
                alt="Bonus Ticket"
                className="w-full h-full object-contain"
              />
            </div>
            <span className="font-bold text-xl tracking-tight text-white">Bonus Ticket</span>
          </div>

          <h1 className="text-3xl lg:text-4xl font-bold tracking-tight text-white leading-tight max-w-md mb-5">
            Central de Gestión, Empresas y Facturación
          </h1>
          <p className="text-neutral-400 text-base leading-relaxed max-w-md">
            Plataforma interna del equipo en Tucumán. Cada área carga y sigue sus tareas sin
            pisarse, compartiendo la Ficha Maestra de Empresas y el tablero ejecutivo.
          </p>
        </div>

        <div className="mt-10 pt-8 border-t border-white/10 grid grid-cols-2 sm:grid-cols-4 gap-5 max-w-lg">
          <div>
            <div className="text-xs text-neutral-400 mb-1">Ramiro</div>
            <div className="text-sm font-semibold text-white">Resumen General</div>
          </div>
          <div>
            <div className="text-xs text-neutral-400 mb-1">Empresas</div>
            <div className="text-sm font-semibold text-white">Cartera y Propuestas</div>
          </div>
          <div>
            <div className="text-xs text-neutral-400 mb-1">Cobranzas</div>
            <div className="text-sm font-semibold text-white">Cálculo y Aumentos</div>
          </div>
          <div>
            <div className="text-xs text-neutral-400 mb-1">Marketing</div>
            <div className="text-sm font-semibold text-white">Meta CSV + IA</div>
          </div>
        </div>
      </div>

      {/* Right Direct Area Selector */}
      <div className="flex-1 bg-white text-[#101014] flex items-center justify-center p-6 lg:p-14">
        <div className="w-full max-w-lg bg-[#F5F6F8] border border-[#E2E6EC] shadow-[0_1px_2px_rgba(16,16,20,0.04)] rounded-xl p-8">
          <div className="flex items-center gap-2 text-xs font-medium text-neutral-500 mb-2">
            <ShieldCheck className="w-4 h-4 text-[#E52421]" />
            <span>Acceso interno de equipo · bonusticket.com.ar</span>
          </div>
          <h2 className="text-2xl font-bold text-[#101014] mb-1.5">
            Elegí tu área para ingresar
          </h2>
          <p className="text-xs text-neutral-500 mb-6">
            Seleccioná tu perfil para ir directamente a tu espacio de trabajo.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {TEAM_PROFILES.map((profile) => {
              const meta = PROFILE_META[profile.id];
              const Icon = meta.icon;
              return (
                <button
                  key={profile.id}
                  type="button"
                  onClick={() => onUnlock(profile.id)}
                  className="group text-left p-4 rounded-xl border border-[#E2E6EC] bg-white shadow-[0_1px_2px_rgba(16,16,20,0.03)] hover:border-[#101014] hover:bg-[#101014] hover:text-white transition-all flex flex-col justify-between gap-4 min-h-[126px]"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="w-9 h-9 rounded-lg bg-[#F5F6F8] group-hover:bg-[#E52421] text-[#101014] group-hover:text-white flex items-center justify-center transition-colors shrink-0">
                      <Icon className="w-4 h-4" />
                    </div>
                    <ArrowRight className="w-4 h-4 text-neutral-400 group-hover:text-white group-hover:translate-x-0.5 transition-all shrink-0 mt-1" />
                  </div>

                  <div className="min-w-0">
                    <div className="text-sm font-bold truncate">{profile.label}</div>
                    <div className="text-xs text-neutral-500 group-hover:text-neutral-300 mt-0.5 truncate">
                      {profile.role}
                    </div>
                    <div className="text-[11px] font-semibold text-[#E52421] group-hover:text-white/90 mt-2 truncate">
                      {meta.destination}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
