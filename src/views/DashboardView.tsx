import React, { useMemo } from 'react';
import {
  ArrowUpRight,
  Calendar,
  Download,
  FileBarChart2,
} from 'lucide-react';
import type { BonusTicketState, CompanyStatus, PaymentStatus, PlanSector, ViewId } from '../types';
import {
  daysOverdue,
  formatARS,
  formatNumber,
  formatPeriodLabel,
  hasUpcomingIncrease,
} from '../utils/calculations';
import {
  ALL_PLAN_SECTORS,
  SECTOR_VISUALS,
  exportDashboardConsolidatedExcel,
  getTaskSectors,
} from '../utils/planHelpers';

interface DashboardViewProps {
  state: BonusTicketState;
  activePeriod: string;
  onChangePeriod: (period: string) => void;
  onOpenExecutiveReport: () => void;
  onNavigate: (view: ViewId) => void;
}

const PERIOD_OPTIONS = ['2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03'];

function computeEffectivePaymentStatus(
  facturado: number,
  cobrado: number,
  retenciones: number,
  fechaVencimiento: string,
  explicitStatus?: PaymentStatus
): PaymentStatus {
  const saldo = Math.max(0, facturado - cobrado - retenciones);
  if (facturado > 0 && saldo <= 0) return 'Al día';
  if (facturado > 0 && explicitStatus === 'Al día' && saldo <= 0) return 'Al día';
  if (cobrado + retenciones > 0 && saldo > 0) return 'Parcial';
  if (
    facturado > 0 &&
    (explicitStatus === 'Vencida' || (saldo > 0 && daysOverdue(fechaVencimiento) > 0))
  ) {
    return 'Vencida';
  }
  return 'Pendiente';
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  state,
  activePeriod,
  onChangePeriod,
  onOpenExecutiveReport,
  onNavigate,
}) => {
  const kpis = useMemo(() => {
    // 1. Empresas summary (matches EmpresasView top strip)
    const statusCounts: Record<CompanyStatus, number> = {
      Activa: 0,
      Prospecto: 0,
      'Prospecto rechazada': 0,
      'Dado de baja': 0,
      Otros: 0,
    };
    for (const c of state.companies) {
      if (c.estado in statusCounts) {
        statusCounts[c.estado] += 1;
      }
    }
    const activeCompanies = state.companies.filter((c) => c.estado === 'Activa');
    const activeEmployees = activeCompanies.reduce((s, c) => s + (c.empleados || 0), 0);

    // 2. Cobranzas summary (matches CobranzasView top 9 KPIs exactly)
    const billingRows = activeCompanies.map((company) => {
      const payment = state.payments.find(
        (p) => p.empresaId === company.id && p.periodo === activePeriod
      );
      const isFacturada = Boolean(payment && (payment.facturada || payment.montoFacturado > 0));
      const facturado = isFacturada ? (payment?.montoFacturado ?? 0) : 0;
      const cobrado = payment ? payment.montoCobrado : 0;
      const retenciones = payment ? payment.retenciones : 0;
      const saldo = Math.max(0, facturado - cobrado - retenciones);
      const fechaPrevista = payment?.fechaVencimiento || `${activePeriod}-20`;
      const estado = computeEffectivePaymentStatus(
        facturado,
        cobrado,
        retenciones,
        fechaPrevista,
        payment?.estado
      );
      return {
        company,
        facturado,
        cobrado,
        retenciones,
        saldo,
        estado,
        marcadoFacturar: Boolean(payment?.marcadoFacturar),
      };
    });

    const cobClientes = billingRows.length;
    const cobMarcadas = billingRows.filter((r) => r.marcadoFacturar).length;
    const cobTotalFacturado = billingRows.reduce((s, r) => s + r.facturado, 0);
    const cobTotalCobrado = billingRows.reduce((s, r) => s + r.cobrado, 0);
    const cobTotalRetenciones = billingRows.reduce((s, r) => s + r.retenciones, 0);
    const cobTotalPendiente = billingRows.reduce((s, r) => s + r.saldo, 0);
    const cobPagadas = billingRows.filter((r) => r.estado === 'Al día').length;
    const cobParciales = billingRows.filter((r) => r.estado === 'Parcial').length;
    const cobVencidas = billingRows.filter((r) => r.estado === 'Vencida').length;
    const cobPorActualizar = billingRows.filter((r) => hasUpcomingIncrease(r.company, 45)).length;
    const cobRecuperadoPct =
      cobTotalFacturado > 0
        ? Math.round(((cobTotalCobrado + cobTotalRetenciones) / cobTotalFacturado) * 100)
        : 0;

    // 3. Marketing summary
    const latestMeta = [...state.metaReports].sort((a, b) =>
      b.fechaCarga.localeCompare(a.fechaCarga)
    )[0];

    const kitsEntregados = state.marketingLogs.filter(
      (l) => l.tipoEntrega === 'Kit Difusión WhatsApp/Email'
    ).length;
    const reelsEntregados = state.marketingLogs.filter(
      (l) => l.tipoEntrega === 'Reel de Fidelización'
    ).length;

    const engagementRate =
      latestMeta && latestMeta.alcance > 0
        ? ((latestMeta.interacciones / latestMeta.alcance) * 100).toFixed(1)
        : '0.0';

    // 4. Planificación Semanal summary
    const periodPlanTasks = state.planTasks.filter((t) =>
      t.fechaObjetivo.startsWith(activePeriod)
    );
    const planSource = periodPlanTasks.length > 0 ? periodPlanTasks : state.planTasks;
    const planTasksTotal = planSource.length;
    const planTasksCompletadas = planSource.filter((t) => t.estado === 'Completado').length;
    const planTasksEnProceso = planSource.filter((t) => t.estado === 'En Proceso').length;
    const planTasksPendientes = planSource.filter((t) => t.estado === 'Pendiente').length;
    const planTasksPct =
      planTasksTotal > 0 ? Math.round((planTasksCompletadas / planTasksTotal) * 100) : 0;

    const planBySector: Array<{
      sector: PlanSector;
      total: number;
      completadas: number;
    }> = ALL_PLAN_SECTORS.map((sec) => {
      const linked = planSource.filter((t) => getTaskSectors(t).includes(sec));
      return {
        sector: sec,
        total: linked.length,
        completadas: linked.filter((t) => t.estado === 'Completado').length,
      };
    });

    return {
      statusCounts,
      activeEmployees,
      cobClientes,
      cobMarcadas,
      cobTotalFacturado,
      cobTotalCobrado,
      cobTotalRetenciones,
      cobTotalPendiente,
      cobPagadas,
      cobParciales,
      cobVencidas,
      cobPorActualizar,
      cobRecuperadoPct,
      alcance: latestMeta?.alcance ?? 0,
      visualizaciones: latestMeta?.visualizaciones ?? 0,
      interacciones: latestMeta?.interacciones ?? 0,
      clicsEnlace: latestMeta?.clicsEnlace ?? 0,
      nuevosSeguidores: latestMeta?.nuevosSeguidores ?? 0,
      latestMetaPeriodo: latestMeta?.periodo ?? 'Sin reporte cargado',
      engagementRate,
      kitsEntregados,
      reelsEntregados,
      planTasksTotal,
      planTasksCompletadas,
      planTasksEnProceso,
      planTasksPendientes,
      planTasksPct,
      planBySector,
      planUsingFallback: periodPlanTasks.length === 0 && state.planTasks.length > 0,
    };
  }, [state, activePeriod]);

  return (
    <div className="space-y-7">
      {/* HEADER: Período + Reporte Excel + Reporte Ejecutivo */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-neutral-500 mb-1">
            Dirección General · Ramiro · Resumen consolidado de todas las áreas
          </p>
          <h1 className="text-2xl font-bold text-[#101014] tracking-tight">
            Área de Ramiro
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-2 bg-[#F5F6F8] border border-[#E2E6EC] rounded-lg px-3 py-2">
            <Calendar className="w-4 h-4 text-neutral-500 shrink-0" />
            <label htmlFor="dash-period" className="text-xs font-medium text-neutral-500">
              Período:
            </label>
            <select
              id="dash-period"
              value={activePeriod}
              onChange={(e) => onChangePeriod(e.target.value)}
              className="text-xs font-semibold text-[#101014] bg-transparent focus:outline-none"
            >
              {PERIOD_OPTIONS.map((p) => (
                <option key={p} value={p}>
                  {formatPeriodLabel(p)}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={() => exportDashboardConsolidatedExcel(state, activePeriod)}
            className="px-3.5 py-2 bg-[#F5F6F8] border border-[#E2E6EC] hover:border-[#101014] text-[#101014] text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Reporte Excel</span>
          </button>

          <button
            type="button"
            onClick={onOpenExecutiveReport}
            className="px-4 py-2 bg-[#101014] hover:bg-neutral-800 text-white text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
          >
            <FileBarChart2 className="w-3.5 h-3.5" />
            <span>Reporte Ejecutivo</span>
          </button>
        </div>
      </div>

      {/* ================================================================= */}
      {/* BLOQUE 1: RESUMEN DE EMPRESAS (mismo resumen que sección Empresas) */}
      {/* ================================================================= */}
      <section className="space-y-3" aria-label="Resumen de Empresas">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold text-neutral-500">
              01. Comercial · Miguel
            </div>
            <h2 className="text-base font-bold text-[#101014]">Resumen de Empresas</h2>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('empresas')}
            className="text-xs font-semibold text-[#101014] hover:text-[#E52421] flex items-center gap-1 transition-colors whitespace-nowrap"
          >
            <span>Ver Empresas</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
          <button
            type="button"
            onClick={() => onNavigate('empresas')}
            className="text-left bg-[#F5F6F8] border border-[#E2E6EC] shadow-[0_1px_2px_rgba(16,16,20,0.04)] hover:border-[#16A34A] rounded-xl p-3.5 transition-colors"
          >
            <div className="text-[11px] font-medium text-neutral-500">Empresas activas</div>
            <div className="text-xl font-bold font-mono tabular-nums text-[#16A34A] mt-1">
              {kpis.statusCounts['Activa']}
            </div>
            <div className="text-[11px] text-neutral-400 mt-0.5">
              {kpis.activeEmployees.toLocaleString('es-AR')} empleados activos
            </div>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('empresas')}
            className="text-left bg-[#F5F6F8] border border-[#E2E6EC] shadow-[0_1px_2px_rgba(16,16,20,0.04)] hover:border-[#D97706] rounded-xl p-3.5 transition-colors"
          >
            <div className="text-[11px] font-medium text-neutral-500">
              Empresas con propuestas
            </div>
            <div className="text-xl font-bold font-mono tabular-nums text-[#D97706] mt-1">
              {kpis.statusCounts['Prospecto']}
            </div>
            <div className="text-[11px] text-neutral-400 mt-0.5">En seguimiento comercial</div>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('empresas')}
            className="text-left bg-[#F5F6F8] border border-[#E2E6EC] shadow-[0_1px_2px_rgba(16,16,20,0.04)] hover:border-[#DC2626] rounded-xl p-3.5 transition-colors"
          >
            <div className="text-[11px] font-medium text-neutral-500">Propuestas rechazadas</div>
            <div className="text-xl font-bold font-mono tabular-nums text-[#DC2626] mt-1">
              {kpis.statusCounts['Prospecto rechazada']}
            </div>
            <div className="text-[11px] text-neutral-400 mt-0.5">Propuestas no concretadas</div>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('empresas')}
            className="text-left bg-[#F5F6F8] border border-[#E2E6EC] shadow-[0_1px_2px_rgba(16,16,20,0.04)] hover:border-[#101014] rounded-xl p-3.5 transition-colors"
          >
            <div className="text-[11px] font-medium text-neutral-500">Empresas dadas de baja</div>
            <div className="text-xl font-bold font-mono tabular-nums text-neutral-700 mt-1">
              {kpis.statusCounts['Dado de baja']}
            </div>
            <div className="text-[11px] text-neutral-400 mt-0.5">Histórico de bajas</div>
          </button>
        </div>
      </section>

      {/* ================================================================= */}
      {/* BLOQUE 2: RESUMEN DE COBRANZAS (mismo resumen que Cobranzas)      */}
      {/* ================================================================= */}
      <section className="space-y-3" aria-label="Resumen de Cobranzas">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold text-neutral-500">
              02. Facturación y Finanzas · Nahuel
            </div>
            <h2 className="text-base font-bold text-[#101014]">
              Resumen de Cobranzas ({formatPeriodLabel(activePeriod)})
            </h2>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('cobranzas')}
            className="text-xs font-semibold text-[#101014] hover:text-[#E52421] flex items-center gap-1 transition-colors whitespace-nowrap"
          >
            <span>Ver Cobranzas</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 sm:gap-3">
          <div className="bg-[#F5F6F8] border border-[#E2E6EC] shadow-[0_1px_2px_rgba(16,16,20,0.04)] rounded-xl p-3.5">
            <div className="text-[11px] font-medium text-neutral-500">Clientes activos</div>
            <div className="text-xl font-bold font-mono tabular-nums text-[#101014] mt-1">
              {kpis.cobClientes}
            </div>
            <div className="text-[11px] text-neutral-400 mt-0.5">
              {kpis.cobMarcadas} marcada{kpis.cobMarcadas === 1 ? '' : 's'} p/ lote
            </div>
          </div>

          <div className="bg-[#F5F6F8] border border-[#E2E6EC] shadow-[0_1px_2px_rgba(16,16,20,0.04)] rounded-xl p-3.5">
            <div className="text-[11px] font-medium text-neutral-500">Facturado</div>
            <div className="text-lg sm:text-xl font-bold font-mono tabular-nums text-[#101014] mt-1 truncate">
              {formatARS(kpis.cobTotalFacturado)}
            </div>
            <div className="text-[11px] text-neutral-400 mt-0.5">
              {formatPeriodLabel(activePeriod)}
            </div>
          </div>

          <div className="bg-[#F5F6F8] border border-[#E2E6EC] shadow-[0_1px_2px_rgba(16,16,20,0.04)] rounded-xl p-3.5">
            <div className="text-[11px] font-medium text-neutral-500">Cobrado efectivo</div>
            <div className="text-lg sm:text-xl font-bold font-mono tabular-nums text-[#16A34A] mt-1 truncate">
              {formatARS(kpis.cobTotalCobrado)}
            </div>
            <div className="text-[11px] text-neutral-400 mt-0.5">
              {kpis.cobTotalFacturado > 0 ? `${kpis.cobRecuperadoPct}% recuperado` : '0%'}
            </div>
          </div>

          <div className="bg-[#F5F6F8] border border-[#E2E6EC] shadow-[0_1px_2px_rgba(16,16,20,0.04)] rounded-xl p-3.5">
            <div className="text-[11px] font-medium text-neutral-500">Retenciones</div>
            <div className="text-lg sm:text-xl font-bold font-mono tabular-nums text-[#101014] mt-1 truncate">
              {formatARS(kpis.cobTotalRetenciones)}
            </div>
            <div className="text-[11px] text-neutral-400 mt-0.5">IIBB / Certificados</div>
          </div>

          <div className="bg-[#F5F6F8] border border-[#E2E6EC] shadow-[0_1px_2px_rgba(16,16,20,0.04)] rounded-xl p-3.5 col-span-2 sm:col-span-1">
            <div className="text-[11px] font-medium text-neutral-500">Saldo pendiente</div>
            <div
              className={`text-lg sm:text-xl font-bold font-mono tabular-nums mt-1 truncate ${
                kpis.cobTotalPendiente > 0 ? 'text-[#E52421]' : 'text-[#16A34A]'
              }`}
            >
              {formatARS(kpis.cobTotalPendiente)}
            </div>
            <div className="text-[11px] text-neutral-400 mt-0.5">Neto a cobrar</div>
          </div>

          {/* 4 Operational Counters */}
          <button
            type="button"
            onClick={() => onNavigate('cobranzas')}
            className="text-left bg-[#F5F6F8] border border-[#E2E6EC] shadow-[0_1px_2px_rgba(16,16,20,0.04)] hover:border-[#16A34A] rounded-xl p-3 transition-colors min-h-[68px]"
          >
            <div className="text-[11px] font-medium text-neutral-500">Pagadas</div>
            <div className="text-xl font-bold font-mono tabular-nums text-[#16A34A] mt-0.5">
              {kpis.cobPagadas}
            </div>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('cobranzas')}
            className="text-left bg-[#F5F6F8] border border-[#E2E6EC] shadow-[0_1px_2px_rgba(16,16,20,0.04)] hover:border-[#D97706] rounded-xl p-3 transition-colors min-h-[68px]"
          >
            <div className="text-[11px] font-medium text-neutral-500">Parciales</div>
            <div className="text-xl font-bold font-mono tabular-nums text-[#D97706] mt-0.5">
              {kpis.cobParciales}
            </div>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('cobranzas')}
            className="text-left bg-[#F5F6F8] border border-[#E2E6EC] shadow-[0_1px_2px_rgba(16,16,20,0.04)] hover:border-[#DC2626] rounded-xl p-3 transition-colors min-h-[68px]"
          >
            <div className="text-[11px] font-medium text-neutral-500">Vencidas</div>
            <div className="text-xl font-bold font-mono tabular-nums text-[#DC2626] mt-0.5">
              {kpis.cobVencidas}
            </div>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('cobranzas')}
            className="text-left bg-[#F5F6F8] border border-[#E2E6EC] shadow-[0_1px_2px_rgba(16,16,20,0.04)] hover:border-[#101014] rounded-xl p-3 transition-colors min-h-[68px] col-span-2 sm:col-span-3 lg:col-span-2 flex items-center justify-between gap-2"
          >
            <div>
              <div className="text-[11px] font-medium text-neutral-500">Por actualizar tarifa</div>
              <div className="text-xl font-bold font-mono tabular-nums text-[#D97706] mt-0.5">
                {kpis.cobPorActualizar}
              </div>
            </div>
            <span className="text-xs font-semibold text-[#101014] flex items-center gap-1">
              <span>Cobranzas</span>
              <ArrowUpRight className="w-4 h-4" />
            </span>
          </button>
        </div>
      </section>

      {/* ================================================================= */}
      {/* BLOQUE 3 & 4: MARKETING Y PLANIFICACIÓN SEMANAL                   */}
      {/* ================================================================= */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* PANEL 3: Métricas de Redes Sociales (Meta) */}
        <article className="bg-[#F5F6F8] border border-[#E2E6EC] shadow-[0_1px_2px_rgba(16,16,20,0.04)] rounded-xl p-6 flex flex-col justify-between space-y-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold text-neutral-500">
                03. Métricas de Redes Sociales · Marketing
              </div>
              <h2 className="text-lg font-bold text-[#101014] mt-0.5">
                Rendimiento Meta ({kpis.latestMetaPeriodo})
              </h2>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('marketing')}
              className="text-xs font-semibold text-[#101014] hover:text-[#E52421] flex items-center gap-1 transition-colors whitespace-nowrap"
            >
              <span>Ver Marketing</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <div className="text-xs text-neutral-500 mb-1">Alcance</div>
              <div className="text-3xl font-bold font-mono tabular-nums text-[#101014]">
                {formatNumber(kpis.alcance)}
              </div>
            </div>
            <div>
              <div className="text-xs text-neutral-500 mb-1">Interacciones</div>
              <div className="text-3xl font-bold font-mono tabular-nums text-[#101014]">
                {formatNumber(kpis.interacciones)}
              </div>
            </div>
            <div>
              <div className="text-xs text-neutral-500 mb-1">Clics a Web</div>
              <div className="text-3xl font-bold font-mono tabular-nums text-[#E52421]">
                {formatNumber(kpis.clicsEnlace)}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4 border-t border-[#E2E6EC] text-xs">
            <div>
              <div className="text-neutral-500 mb-0.5">Visualizaciones</div>
              <div className="text-base font-bold font-mono tabular-nums text-[#101014]">
                {formatNumber(kpis.visualizaciones)}
              </div>
            </div>
            <div>
              <div className="text-neutral-500 mb-0.5">Nuevos seg.</div>
              <div className="text-base font-bold font-mono tabular-nums text-[#16A34A]">
                +{formatNumber(kpis.nuevosSeguidores)}
              </div>
            </div>
            <div>
              <div className="text-neutral-500 mb-0.5">Tasa interacción</div>
              <div className="text-base font-bold font-mono tabular-nums text-[#101014]">
                {kpis.engagementRate}%
              </div>
            </div>
            <div>
              <div className="text-neutral-500 mb-0.5">Kits / Reels</div>
              <div className="text-base font-bold font-mono tabular-nums text-[#101014]">
                {kpis.kitsEntregados} / {kpis.reelsEntregados}
              </div>
            </div>
          </div>
        </article>

        {/* PANEL 4: Resumen de Planificación Semanal */}
        <article className="bg-[#F5F6F8] border border-[#E2E6EC] shadow-[0_1px_2px_rgba(16,16,20,0.04)] rounded-xl p-6 flex flex-col justify-between space-y-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold text-neutral-500">
                04. Planificación Semanal · Reuniones de Lunes
              </div>
              <h2 className="text-lg font-bold text-[#101014] mt-0.5">
                Tareas Semanales Completadas vs. Pendientes
              </h2>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('planificacion')}
              className="text-xs font-semibold text-[#101014] hover:text-[#E52421] flex items-center gap-1 transition-colors whitespace-nowrap"
            >
              <span>Abrir Tablero</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <div className="text-xs text-neutral-500 mb-1">Completadas</div>
              <div className="text-4xl font-bold font-mono tabular-nums text-[#16A34A]">
                {kpis.planTasksCompletadas}
              </div>
            </div>
            <div>
              <div className="text-xs text-neutral-500 mb-1">En Proceso</div>
              <div className="text-4xl font-bold font-mono tabular-nums text-[#D97706]">
                {kpis.planTasksEnProceso}
              </div>
            </div>
            <div>
              <div className="text-xs text-neutral-500 mb-1">Pendientes</div>
              <div className="text-4xl font-bold font-mono tabular-nums text-[#E52421]">
                {kpis.planTasksPendientes}
              </div>
            </div>
          </div>

          <div className="space-y-3 pt-4 border-t border-[#E2E6EC]">
            <div className="flex items-center justify-between text-xs">
              <span className="text-neutral-600 font-medium">
                Cumplimiento{' '}
                {kpis.planUsingFallback
                  ? '(total tablero)'
                  : `(${formatPeriodLabel(activePeriod)})`}
              </span>
              <span className="font-mono font-bold text-[#101014] tabular-nums">
                {kpis.planTasksPct}% ({kpis.planTasksCompletadas} de {kpis.planTasksTotal})
              </span>
            </div>
            <div className="w-full h-3 bg-[#E5E8EE] rounded-full overflow-hidden">
              <div
                className="h-full bg-[#E52421] transition-all duration-300"
                style={{ width: `${kpis.planTasksPct}%` }}
              />
            </div>

            {/* Area Breakdown with Representative Colors */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-2">
              {kpis.planBySector.map((item) => {
                const vis = SECTOR_VISUALS[item.sector];
                return (
                  <div key={item.sector} className="text-xs">
                    <div className="flex items-center gap-1.5 text-neutral-600 font-medium">
                      <span
                        className="w-2.5 h-2.5 rounded-[2px] shrink-0"
                        style={{ backgroundColor: vis.hex }}
                      />
                      <span className="truncate">{vis.label}</span>
                    </div>
                    <div className="font-mono font-bold text-[#101014] tabular-nums mt-0.5">
                      {item.completadas}/{item.total}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </article>
      </section>
    </div>
  );
};
