import React, { useMemo, useState } from 'react';
import {
  Calendar,
  Check,
  Download,
  ExternalLink,
  FileSpreadsheet,
  Film,
  Gift,
  Link as LinkIcon,
  ListPlus,
  Plus,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  MARKETING_ESPECIAL_RUBROS,
  MARKETING_REEL_CATEGORIAS,
  type Company,
  type MarketingEspecial,
  type MarketingEspecialRubro,
  type MarketingLog,
  type MarketingReelCategoria,
  type MarketingReelSorteo,
  type MetaReport,
  type PlanTask,
} from '../types';
import {
  formatNumber,
  formatPeriodLabel,
  parseMetaCsvTexts,
  sanitizeFirestoreId,
} from '../utils/calculations';
import { exportMarketingExcel } from '../utils/planHelpers';
import { QuickTaskModal } from '../components/QuickTaskModal';

interface MarketingViewProps {
  companies: Company[];
  metaReports: MetaReport[];
  marketingLogs: MarketingLog[];
  marketingEspeciales: MarketingEspecial[];
  marketingReelsSorteos: MarketingReelSorteo[];
  onAddMetaReport: (report: MetaReport) => void;
  onDeleteMetaReport: (id: string) => void;
  onSaveMarketingLog: (log: MarketingLog) => void;
  onSaveMarketingEspecial: (especial: MarketingEspecial) => void;
  onDeleteMarketingEspecial: (id: string) => void;
  onAddMarketingReelSorteo: (item: MarketingReelSorteo) => void;
  onDeleteMarketingReelSorteo: (id: string) => void;
  onAddPlanTask: (task: PlanTask) => void;
}

const SAMPLE_META_CSV = `Fecha,Alcance,Visualizaciones,Visitas al perfil,Interacciones,Clics en el enlace,Nuevos seguidores
2026-11-17,22400,48900,1410,1890,420,135
2026-11-18,24100,52300,1520,2140,465,152
2026-11-19,21800,46200,1380,1750,390,118
2026-11-20,26900,59400,1790,2480,540,184
2026-11-21,28400,63100,1920,2690,595,205
2026-11-22,25000,42500,1400,1900,430,146`;

interface ReelCategoryVisual {
  borderClass: string;
  badgeTextClass: string;
  iconBgClass: string;
  iconTextClass: string;
  isGift: boolean;
}

const REEL_CATEGORY_VISUALS: Record<MarketingReelCategoria, ReelCategoryVisual> = {
  'Reel Comunidad (Abogados / Psicólogos / USPT / TP)': {
    borderClass: 'border-l-[#2563EB]',
    badgeTextClass: 'text-[#1D4ED8]',
    iconBgClass: 'bg-blue-50 border-blue-200',
    iconTextClass: 'text-[#2563EB]',
    isGift: false,
  },
  'Reel Evento / Cobertura': {
    borderClass: 'border-l-[#D97706]',
    badgeTextClass: 'text-[#B45309]',
    iconBgClass: 'bg-amber-50 border-amber-200',
    iconTextClass: 'text-[#D97706]',
    isGift: false,
  },
  'Reel Educativo / Comodines': {
    borderClass: 'border-l-[#059669]',
    badgeTextClass: 'text-[#047857]',
    iconBgClass: 'bg-emerald-50 border-emerald-200',
    iconTextClass: 'text-[#059669]',
    isGift: false,
  },
  'Reel Emocional / Magoya': {
    borderClass: 'border-l-[#7C3AED]',
    badgeTextClass: 'text-[#6D28D9]',
    iconBgClass: 'bg-violet-50 border-violet-200',
    iconTextClass: 'text-[#7C3AED]',
    isGift: false,
  },
  'Sorteo Realizado': {
    borderClass: 'border-l-[#E52421]',
    badgeTextClass: 'text-[#C91D1A]',
    iconBgClass: 'bg-red-50 border-red-200',
    iconTextClass: 'text-[#E52421]',
    isGift: true,
  },
};

function formatDateAR(isoDate: string): string {
  if (!isoDate || !isoDate.includes('-')) return isoDate;
  const [y, m, d] = isoDate.split('-');
  if (!y || !m || !d) return isoDate;
  return `${d}/${m}/${y}`;
}

function calcInclusiveDays(fechaInicio: string, fechaFin: string): number {
  if (!fechaInicio || !fechaFin) return 1;
  const start = new Date(`${fechaInicio}T00:00:00`);
  const end = new Date(`${fechaFin}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 1;
  const diff = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  return Math.max(1, diff + 1);
}

function formatDurationBadge(days: number): string {
  if (days <= 1) return '1 día';
  if (days === 2) return '2 días';
  return `${days} días`;
}

function buildMonthOptions(dates: string[]): string[] {
  const months = new Set<string>();
  const now = new Date();
  for (let offset = -2; offset <= 2; offset++) {
    const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    months.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  dates.forEach((iso) => {
    if (iso && /^\d{4}-\d{2}/.test(iso)) {
      months.add(iso.slice(0, 7));
    }
  });
  return Array.from(months).sort((a, b) => b.localeCompare(a));
}

function normalizeAndValidateHttpUrl(raw: string): { valid: boolean; normalized: string; error?: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { valid: true, normalized: '' };

  // Block dangerous schemes explicitly before prepending https://
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) && !/^https?:\/\//i.test(trimmed)) {
    return {
      valid: false,
      normalized: '',
      error: 'El enlace debe comenzar con http:// o https://.',
    };
  }

  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return {
        valid: false,
        normalized: '',
        error: 'Solo se permiten enlaces seguros http:// o https://.',
      };
    }
    if (!parsed.hostname || !parsed.hostname.includes('.')) {
      return {
        valid: false,
        normalized: '',
        error: 'Ingresá un enlace válido (ej. instagram.com/... o drive.google.com/...).',
      };
    }
    return { valid: true, normalized: parsed.toString() };
  } catch {
    return {
      valid: false,
      normalized: '',
      error: 'Ingresá un enlace válido (ej. instagram.com/... o drive.google.com/...).',
    };
  }
}

function getSafeExternalLinkLabel(url: string): string {
  const lower = url.toLowerCase();
  if (lower.includes('instagram.com') || lower.includes('instagr.am')) {
    return 'Ver en Instagram';
  }
  if (lower.includes('drive.google.com') || lower.includes('docs.google.com')) {
    return 'Ver en Drive';
  }
  return 'Abrir enlace';
}

export const MarketingView: React.FC<MarketingViewProps> = ({
  companies,
  metaReports,
  marketingLogs,
  marketingEspeciales,
  marketingReelsSorteos,
  onAddMetaReport,
  onDeleteMetaReport,
  onSaveMarketingLog,
  onSaveMarketingEspecial,
  onDeleteMarketingEspecial,
  onAddMarketingReelSorteo,
  onDeleteMarketingReelSorteo,
  onAddPlanTask,
}) => {
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);

  // Global feedback banner & task modal
  const [confirmBanner, setConfirmBanner] = useState('');
  const [taskModalOpen, setTaskModalOpen] = useState(false);

  const showConfirmBanner = (msg: string) => {
    setConfirmBanner(msg);
    window.setTimeout(() => {
      setConfirmBanner((prev) => (prev === msg ? '' : prev));
    }, 3200);
  };

  // =========================================================================
  // 1. IMPORTADOR AUTOMÁTICO DE REPORTES META (SOLO CSV)
  // =========================================================================
  const [periodLabel, setPeriodLabel] = useState('Noviembre 2026 · Cierre Semanal');
  const [csvStatus, setCsvStatus] = useState('');
  const [isDraggingCsv, setIsDraggingCsv] = useState(false);
  const [draft, setDraft] = useState<{
    alcance: number;
    visualizaciones: number;
    visitasPerfil: number;
    interacciones: number;
    clicsEnlace: number;
    nuevosSeguidores: number;
    analisisEjecutivo: string;
    ready: boolean;
  }>({
    alcance: 0,
    visualizaciones: 0,
    visitasPerfil: 0,
    interacciones: 0,
    clicsEnlace: 0,
    nuevosSeguidores: 0,
    analisisEjecutivo: '',
    ready: false,
  });

  const handleCsvFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const files: Array<{ name: string; content: string }> = [];
    for (const file of Array.from(fileList)) {
      const text = await file.text();
      files.push({ name: file.name, content: text });
    }
    const parsed = parseMetaCsvTexts(files);
    setDraft({
      alcance: parsed.alcance,
      visualizaciones: parsed.visualizaciones,
      visitasPerfil: parsed.visitasPerfil,
      interacciones: parsed.interacciones,
      clicsEnlace: parsed.clicsEnlace,
      nuevosSeguidores: parsed.nuevosSeguidores,
      analisisEjecutivo: `Reporte importado desde ${parsed.filesProcessed} archivo(s) CSV de Meta Business Suite. Métricas detectadas: ${
        parsed.detectedMetrics.join(', ') || 'verificá y editá los campos debajo'
      }.`,
      ready: true,
    });
    setCsvStatus(
      `Se procesaron ${parsed.filesProcessed} archivo(s) CSV (${parsed.detectedMetrics.length} métricas detectadas).`
    );
  };

  const handleLoadSampleCsv = () => {
    const parsed = parseMetaCsvTexts([
      { name: 'meta_resultados_noviembre.csv', content: SAMPLE_META_CSV },
    ]);
    setDraft({
      alcance: parsed.alcance,
      visualizaciones: parsed.visualizaciones,
      visitasPerfil: parsed.visitasPerfil,
      interacciones: parsed.interacciones,
      clicsEnlace: parsed.clicsEnlace,
      nuevosSeguidores: parsed.nuevosSeguidores,
      analisisEjecutivo:
        'Importación automática desde CSV de Meta Business Suite. Pico de alcance e interacciones entre jueves y sábado impulsado por Reels y difusión de comercios.',
      ready: true,
    });
    setCsvStatus('CSV de ejemplo Meta procesado automáticamente. Revisá los valores y guardá.');
  };

  const handleSaveDraftReport = () => {
    const newReport: MetaReport = {
      id: sanitizeFirestoreId('meta'),
      periodo: periodLabel.trim() || 'Período Meta',
      fechaCarga: new Date().toISOString().slice(0, 10),
      origen: 'CSV Meta',
      alcance: draft.alcance,
      visualizaciones: draft.visualizaciones,
      visitasPerfil: draft.visitasPerfil,
      interacciones: draft.interacciones,
      clicsEnlace: draft.clicsEnlace,
      nuevosSeguidores: draft.nuevosSeguidores,
      analisisEjecutivo: draft.analisisEjecutivo.trim(),
    };
    onAddMetaReport(newReport);
    setDraft((prev) => ({ ...prev, ready: false }));
    setCsvStatus('');
    showConfirmBanner('Reporte Meta guardado en el historial y reflejado en el Dashboard Ejecutivo.');
  };

  // =========================================================================
  // 3. REGISTRO MENSUAL DE ESPECIALES (PROMO DUPLICA / CAMPAÑAS)
  // =========================================================================
  const [especialMonthFilter, setEspecialMonthFilter] = useState<string>('TODOS');
  const [espNombre, setEspNombre] = useState('');
  const [espFechaInicio, setEspFechaInicio] = useState(todayIso);
  const [espFechaFin, setEspFechaFin] = useState(todayIso);
  const [espRubros, setEspRubros] = useState<MarketingEspecialRubro[]>([]);
  const [espVideo3Dias, setEspVideo3Dias] = useState(false);
  const [espPlaca1Dia, setEspPlaca1Dia] = useState(false);
  const [espHistoriasDia, setEspHistoriasDia] = useState(false);
  const [espObservaciones, setEspObservaciones] = useState('');
  const [espError, setEspError] = useState('');

  const especialMonthOptions = useMemo(
    () =>
      buildMonthOptions(
        marketingEspeciales.flatMap((e) => [e.fechaInicio, e.fechaFin])
      ),
    [marketingEspeciales]
  );

  const filteredEspeciales = useMemo(() => {
    return [...marketingEspeciales]
      .filter((esp) => {
        if (especialMonthFilter === 'TODOS') return true;
        return (
          esp.fechaInicio.startsWith(especialMonthFilter) ||
          esp.fechaFin.startsWith(especialMonthFilter)
        );
      })
      .sort((a, b) => b.fechaInicio.localeCompare(a.fechaInicio));
  }, [marketingEspeciales, especialMonthFilter]);

  const liveEspecialDays = useMemo(
    () => calcInclusiveDays(espFechaInicio, espFechaFin),
    [espFechaInicio, espFechaFin]
  );

  const handleEspFechaInicioChange = (nextInicio: string) => {
    setEspFechaInicio(nextInicio);
    if (nextInicio && espFechaFin && nextInicio > espFechaFin) {
      setEspFechaFin(nextInicio);
    }
  };

  const handleEspFechaFinChange = (nextFin: string) => {
    if (nextFin && espFechaInicio && nextFin < espFechaInicio) {
      setEspFechaFin(espFechaInicio);
    } else {
      setEspFechaFin(nextFin);
    }
  };

  const toggleEspRubro = (rubro: MarketingEspecialRubro) => {
    setEspRubros((prev) =>
      prev.includes(rubro) ? prev.filter((r) => r !== rubro) : [...prev, rubro]
    );
  };

  const handleSaveEspecial = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = espNombre.trim();
    if (!trimmedName) {
      setEspError('Ingresá el nombre del Especial antes de guardar.');
      return;
    }
    const safeInicio = espFechaInicio || todayIso;
    const safeFin = !espFechaFin || espFechaFin < safeInicio ? safeInicio : espFechaFin;

    const newEspecial: MarketingEspecial = {
      id: sanitizeFirestoreId('mesp'),
      nombre: trimmedName,
      fechaInicio: safeInicio,
      fechaFin: safeFin,
      rubros: espRubros,
      video3DiasAntes: espVideo3Dias,
      placa1DiaAntes: espPlaca1Dia,
      historiasDelDia: espHistoriasDia,
      observaciones: espObservaciones.trim(),
    };

    onSaveMarketingEspecial(newEspecial);
    setEspNombre('');
    setEspFechaInicio(todayIso);
    setEspFechaFin(todayIso);
    setEspRubros([]);
    setEspVideo3Dias(false);
    setEspPlaca1Dia(false);
    setEspHistoriasDia(false);
    setEspObservaciones('');
    setEspError('');
    showConfirmBanner(`Especial "${trimmedName}" guardado correctamente.`);
  };

  const handleToggleEspecialProtocol = (
    especial: MarketingEspecial,
    field: 'video3DiasAntes' | 'placa1DiaAntes' | 'historiasDelDia'
  ) => {
    onSaveMarketingEspecial({
      ...especial,
      [field]: !especial[field],
    });
  };

  // =========================================================================
  // 4A. BITÁCORA SEMANAL RÁPIDA (2 MINUTOS)
  // =========================================================================
  const currentChecklist = useMemo(() => {
    return (
      marketingLogs.find((l) => l.tipoEntrega === 'Checklist Semanal') ?? {
        id: 'mlog_sem48_actual',
        semana: 'Semana 48 · 23 al 29 Nov 2026',
        grillaDiaria: true,
        colaboraciones: true,
        magoyaVideos: false,
        promoDuplica: false,
        tipoEntrega: 'Checklist Semanal' as const,
        fecha: todayIso,
        notas: '',
      }
    );
  }, [marketingLogs, todayIso]);

  const toggleChecklistField = (
    field: 'grillaDiaria' | 'colaboraciones' | 'magoyaVideos' | 'promoDuplica'
  ) => {
    onSaveMarketingLog({
      ...currentChecklist,
      [field]: !currentChecklist[field],
    });
  };

  const checklistCompletedCount = [
    currentChecklist.grillaDiaria,
    currentChecklist.colaboraciones,
    currentChecklist.magoyaVideos,
    currentChecklist.promoDuplica,
  ].filter(Boolean).length;

  // =========================================================================
  // 4B. REGISTRO DE REELS ARMADOS Y SORTEOS REALIZADOS
  // =========================================================================
  const [reelMonthFilter, setReelMonthFilter] = useState<string>('TODOS');
  const [reelCategoryFilter, setReelCategoryFilter] = useState<'TODAS' | MarketingReelCategoria>(
    'TODAS'
  );
  const [reelCategoria, setReelCategoria] = useState<MarketingReelCategoria>(
    MARKETING_REEL_CATEGORIAS[0]
  );
  const [reelFecha, setReelFecha] = useState(todayIso);
  const [reelTitulo, setReelTitulo] = useState('');
  const [reelEmpresaId, setReelEmpresaId] = useState('');
  const [reelEnlace, setReelEnlace] = useState('');
  const [reelError, setReelError] = useState('');

  const reelMonthOptions = useMemo(
    () => buildMonthOptions(marketingReelsSorteos.map((r) => r.fecha)),
    [marketingReelsSorteos]
  );

  const sortedCompanies = useMemo(
    () => [...companies].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
    [companies]
  );

  const filteredReelsSorteos = useMemo(() => {
    return [...marketingReelsSorteos]
      .filter((item) => {
        if (reelMonthFilter !== 'TODOS' && !item.fecha.startsWith(reelMonthFilter)) {
          return false;
        }
        if (reelCategoryFilter !== 'TODAS' && item.categoria !== reelCategoryFilter) {
          return false;
        }
        return true;
      })
      .sort((a, b) => b.fecha.localeCompare(a.fecha));
  }, [marketingReelsSorteos, reelMonthFilter, reelCategoryFilter]);

  const handleSaveReelSorteo = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedTitle = reelTitulo.trim();
    if (!trimmedTitle) {
      setReelError('Ingresá un título o descripción antes de registrar.');
      return;
    }

    const urlCheck = normalizeAndValidateHttpUrl(reelEnlace);
    if (!urlCheck.valid) {
      setReelError(urlCheck.error || 'Enlace inválido.');
      return;
    }

    const company = companies.find((c) => c.id === reelEmpresaId);
    const newItem: MarketingReelSorteo = {
      id: sanitizeFirestoreId('mreel'),
      fecha: reelFecha || todayIso,
      categoria: reelCategoria,
      titulo: trimmedTitle,
      empresaId: company?.id || '',
      empresaNombre: company?.nombre || '',
      enlace: urlCheck.normalized,
    };

    onAddMarketingReelSorteo(newItem);
    setReelTitulo('');
    setReelEmpresaId('');
    setReelEnlace('');
    setReelError('');
    showConfirmBanner(
      reelCategoria === 'Sorteo Realizado'
        ? `Sorteo "${trimmedTitle}" registrado en la bitácora.`
        : `Reel "${trimmedTitle}" registrado en la bitácora.`
    );
  };

  return (
    <div className="space-y-8">
      {/* 0. ENCABEZADO Y ACCIONES RÁPIDAS */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-neutral-500 mb-1">
            Cero burocracia diaria · Carga automática de métricas y bitácora semanal en 2 minutos
          </p>
          <h1 className="text-2xl font-bold text-[#101014] tracking-tight">
            Marketing — Reportes Meta (CSV) y Bitácora
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() =>
              exportMarketingExcel(
                metaReports,
                marketingLogs,
                marketingEspeciales,
                marketingReelsSorteos
              )
            }
            className="px-3.5 py-2 bg-[#F8F6F4] border border-[#E2E6EC] hover:border-[#101014] text-[#101014] text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Reporte Excel</span>
          </button>
          <button
            type="button"
            onClick={() => setTaskModalOpen(true)}
            className="px-3.5 py-2 bg-[#101014] hover:bg-neutral-800 text-white text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
          >
            <ListPlus className="w-4 h-4" />
            <span>Nueva Tarea</span>
          </button>
        </div>
      </div>

      {/* Confirmation Banner */}
      {confirmBanner && (
        <div className="px-4 py-2.5 bg-[#101014] text-white text-xs font-medium rounded-lg flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4 text-[#16A34A] shrink-0" />
            <span>{confirmBanner}</span>
          </div>
          <button
            type="button"
            onClick={() => setConfirmBanner('')}
            aria-label="Cerrar aviso"
            className="p-0.5 text-neutral-400 hover:text-white"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* 1. IMPORTADOR AUTOMÁTICO DE REPORTES META (SOLO CSV) */}
      <section className="bg-[#F5F6F8] border border-[#E2E6EC] shadow-[0_1px_2px_rgba(16,16,20,0.04)] rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-[#E2E6EC] bg-[#ECEFF3] flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#101014] text-white flex items-center justify-center shrink-0">
              <FileSpreadsheet className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[#101014]">
                Importador Automático de Reportes Meta (CSV)
              </h2>
              <p className="text-xs text-neutral-500">
                Subí uno o varios archivos .CSV de Meta Business Suite (serie individual por fecha o
                tabla multi-columna en español/inglés)
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleLoadSampleCsv}
            className="px-3.5 py-2 bg-white border border-[#E2E6EC] hover:border-[#E52421] text-[#E52421] text-xs font-semibold rounded-lg transition-colors whitespace-nowrap"
          >
            Probar con CSV de ejemplo Meta
          </button>
        </div>

        <div className="p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <label
              htmlFor="meta-period-label"
              className="text-xs font-semibold text-neutral-700 shrink-0"
            >
              Etiqueta del período:
            </label>
            <input
              id="meta-period-label"
              value={periodLabel}
              onChange={(e) => setPeriodLabel(e.target.value)}
              placeholder="Ej: Noviembre 2026 · Cierre Semanal"
              className="px-3 py-2 bg-white border border-[#E2E6EC] rounded-lg text-sm flex-1 max-w-md text-[#101014] focus:outline-none focus:border-[#101014]"
            />
          </div>

          <div className="space-y-3">
            <label
              onDragOver={(e) => {
                e.preventDefault();
                setIsDraggingCsv(true);
              }}
              onDragLeave={() => setIsDraggingCsv(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDraggingCsv(false);
                void handleCsvFiles(e.dataTransfer.files);
              }}
              className={`block border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
                isDraggingCsv
                  ? 'border-[#E52421] bg-red-50/40'
                  : 'border-neutral-300 hover:border-[#E52421] bg-white'
              }`}
            >
              <input
                type="file"
                accept=".csv,text/csv"
                multiple
                className="hidden"
                onChange={(e) => {
                  void handleCsvFiles(e.target.files);
                  e.target.value = '';
                }}
              />
              <Upload className="w-7 h-7 text-neutral-400 mx-auto mb-2.5" />
              <div className="text-sm font-semibold text-[#101014]">
                Arrastrá y soltá tus archivos .CSV de Meta Business Suite o hacé clic para elegirlos
              </div>
              <p className="text-xs text-neutral-500 mt-1">
                Detecta automáticamente Alcance, Visualizaciones, Visitas al perfil, Interacciones,
                Clics en el enlace y Nuevos seguidores (delimitador , o ;)
              </p>
            </label>

            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="text-neutral-500">
                {csvStatus || 'Listo para importar uno o varios archivos .CSV'}
              </span>
              {draft.ready && (
                <button
                  type="button"
                  onClick={() => {
                    setDraft((prev) => ({ ...prev, ready: false }));
                    setCsvStatus('');
                  }}
                  className="text-neutral-500 hover:text-[#101014] font-medium"
                >
                  Descartar vista previa
                </button>
              )}
            </div>
          </div>

          {/* Extracted Preview & Confirm Save */}
          {draft.ready && (
            <div className="p-5 bg-[#F8F6F4] border border-[#E2E6EC] rounded-xl space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs font-bold text-[#101014]">
                  Vista previa editable (CSV Meta) — Revisá las 6 métricas y confirmá para guardar
                </div>
                <button
                  type="button"
                  onClick={handleSaveDraftReport}
                  className="px-4 py-2 bg-[#E52421] hover:bg-[#C91D1A] text-white text-xs font-semibold rounded-lg transition-colors"
                >
                  Guardar en historial Meta
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                {(
                  [
                    { key: 'alcance', label: 'Alcance' },
                    { key: 'visualizaciones', label: 'Visualizaciones' },
                    { key: 'visitasPerfil', label: 'Visitas al perfil' },
                    { key: 'interacciones', label: 'Interacciones' },
                    { key: 'clicsEnlace', label: 'Clics en el enlace' },
                    { key: 'nuevosSeguidores', label: 'Nuevos seguidores' },
                  ] as const
                ).map((item) => (
                  <div
                    key={item.key}
                    className="bg-white border border-[#E2E6EC] rounded-lg p-3"
                  >
                    <label className="block text-[11px] font-medium text-neutral-500 mb-1">
                      {item.label}
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={draft[item.key]}
                      onChange={(e) =>
                        setDraft((prev) => ({
                          ...prev,
                          [item.key]: Math.max(0, Number(e.target.value) || 0),
                        }))
                      }
                      className="w-full font-mono font-bold text-base tabular-nums text-[#101014] focus:outline-none"
                    />
                  </div>
                ))}
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">
                  Análisis ejecutivo del período
                </label>
                <textarea
                  rows={3}
                  value={draft.analisisEjecutivo}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, analisisEjecutivo: e.target.value }))
                  }
                  placeholder="Resumen ejecutivo de resultados y aprendizajes de la semana o mes..."
                  className="w-full px-3 py-2 bg-white border border-[#E2E6EC] rounded-lg text-xs leading-relaxed text-[#101014] focus:outline-none focus:border-[#101014]"
                />
              </div>
            </div>
          )}
        </div>
      </section>

      {/* 2. HISTORIAL DE REPORTES META */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-bold text-[#101014]">
            Historial de Reportes Meta ({metaReports.length})
          </h2>
          <span className="text-[11px] text-neutral-500">
            El último reporte se refleja automáticamente en el Dashboard Ejecutivo
          </span>
        </div>

        <div className="bg-[#F5F6F8] border border-[#E2E6EC] shadow-[0_1px_2px_rgba(16,16,20,0.04)] rounded-xl overflow-x-auto">
          {metaReports.length === 0 ? (
            <div className="p-8 text-center text-xs text-neutral-500">
              Todavía no cargaste reportes de Meta. Importá un archivo .CSV arriba para comenzar.
            </div>
          ) : (
            <table className="w-full text-left text-xs min-w-[760px]">
              <thead className="bg-[#ECEFF3] border-b border-[#E2E6EC] text-neutral-600">
                <tr>
                  <th className="py-3 px-4 font-semibold">Período</th>
                  <th className="py-3 px-3 font-semibold text-right">Alcance</th>
                  <th className="py-3 px-3 font-semibold text-right">Visualizaciones</th>
                  <th className="py-3 px-3 font-semibold text-right">Visitas Perfil</th>
                  <th className="py-3 px-3 font-semibold text-right">Interacciones</th>
                  <th className="py-3 px-3 font-semibold text-right">Clics Web</th>
                  <th className="py-3 px-3 font-semibold text-right">Seguidores</th>
                  <th className="py-3 px-3 font-semibold"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E6EC]/70">
                {metaReports.map((r) => (
                  <tr key={r.id} className="hover:bg-[#ECEFF3]/60">
                    <td className="py-3.5 px-4">
                      <div className="font-semibold text-[#101014]">{r.periodo}</div>
                      <div className="text-[11px] text-neutral-500 mt-0.5">
                        {r.origen} · {formatDateAR(r.fechaCarga)}
                      </div>
                      {r.analisisEjecutivo && (
                        <p className="text-[11px] text-neutral-600 mt-1 max-w-md leading-relaxed">
                          {r.analisisEjecutivo}
                        </p>
                      )}
                    </td>
                    <td className="py-3.5 px-3 text-right font-mono font-bold tabular-nums text-[#101014]">
                      {formatNumber(r.alcance)}
                    </td>
                    <td className="py-3.5 px-3 text-right font-mono tabular-nums text-neutral-700">
                      {formatNumber(r.visualizaciones)}
                    </td>
                    <td className="py-3.5 px-3 text-right font-mono tabular-nums text-neutral-700">
                      {formatNumber(r.visitasPerfil)}
                    </td>
                    <td className="py-3.5 px-3 text-right font-mono font-bold tabular-nums text-[#101014]">
                      {formatNumber(r.interacciones)}
                    </td>
                    <td className="py-3.5 px-3 text-right font-mono font-bold text-[#E52421] tabular-nums">
                      {formatNumber(r.clicsEnlace)}
                    </td>
                    <td className="py-3.5 px-3 text-right font-mono text-[#16A34A] font-semibold tabular-nums">
                      +{formatNumber(r.nuevosSeguidores)}
                    </td>
                    <td className="py-3.5 px-3 text-right">
                      <button
                        type="button"
                        onClick={() => onDeleteMetaReport(r.id)}
                        className="p-1.5 text-neutral-400 hover:text-[#DC2626] rounded transition-colors"
                        aria-label={`Eliminar reporte ${r.periodo}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* 3. REGISTRO MENSUAL DE ESPECIALES (PROMO DUPLICA / CAMPAÑAS) */}
      <section className="bg-[#F5F6F8] border border-[#E2E6EC] shadow-[0_1px_2px_rgba(16,16,20,0.04)] rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-[#E2E6EC] bg-[#ECEFF3] flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#E52421] text-white flex items-center justify-center shrink-0">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[#101014]">
                Registro Mensual de Especiales (Promo Duplica / Campañas)
              </h2>
              <p className="text-xs text-neutral-500">
                Planificá cada especial por fechas, rubros participantes y controlá los 3 pasos del
                protocolo
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <label
              htmlFor="especial-month-filter"
              className="text-xs font-medium text-neutral-600 shrink-0"
            >
              Mes y Año:
            </label>
            <select
              id="especial-month-filter"
              value={especialMonthFilter}
              onChange={(e) => setEspecialMonthFilter(e.target.value)}
              className="px-3 py-1.5 bg-white border border-[#E2E6EC] rounded-lg text-xs font-semibold text-[#101014] focus:outline-none focus:border-[#101014]"
            >
              <option value="TODOS">Todos los meses</option>
              {especialMonthOptions.map((ym) => (
                <option key={ym} value={ym}>
                  {formatPeriodLabel(ym)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Quick Form for New Especial */}
          <form
            onSubmit={handleSaveEspecial}
            className="p-5 bg-[#F8F6F4] border border-[#E2E6EC] rounded-xl space-y-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#101014]">
                Cargar nuevo Especial
              </h3>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-[#101014] text-white text-[11px] font-semibold rounded-md font-mono tabular-nums">
                <Calendar className="w-3 h-3 text-[#E52421]" />
                Duración: {formatDurationBadge(liveEspecialDays)}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
              <div className="md:col-span-6">
                <label className="block text-xs font-semibold text-neutral-700 mb-1">
                  Nombre del Especial *
                </label>
                <input
                  type="text"
                  required
                  value={espNombre}
                  onChange={(e) => {
                    setEspNombre(e.target.value);
                    if (espError) setEspError('');
                  }}
                  placeholder="Ej: Especial Gastronomía y Heladería, Especial Gimnasios, Especial Finde Largo"
                  className="w-full px-3 py-2 bg-white border border-[#E2E6EC] rounded-lg text-xs text-[#101014] focus:outline-none focus:border-[#101014]"
                />
              </div>

              <div className="md:col-span-3">
                <label className="block text-xs font-semibold text-neutral-700 mb-1">
                  Fecha de Inicio
                </label>
                <input
                  type="date"
                  value={espFechaInicio}
                  onChange={(e) => handleEspFechaInicioChange(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-[#E2E6EC] rounded-lg text-xs font-mono tabular-nums text-[#101014] focus:outline-none focus:border-[#101014]"
                />
              </div>

              <div className="md:col-span-3">
                <label className="block text-xs font-semibold text-neutral-700 mb-1">
                  Fecha de Finalización
                </label>
                <input
                  type="date"
                  min={espFechaInicio}
                  value={espFechaFin}
                  onChange={(e) => handleEspFechaFinChange(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-[#E2E6EC] rounded-lg text-xs font-mono tabular-nums text-[#101014] focus:outline-none focus:border-[#101014]"
                />
              </div>
            </div>

            {/* 14 Rubros Multi-Select Chips */}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="text-xs font-semibold text-neutral-700">
                  Rubros que abarcó{' '}
                  <span className="font-mono text-[11px] font-bold text-[#E52421]">
                    ({espRubros.length} {espRubros.length === 1 ? 'seleccionado' : 'seleccionados'})
                  </span>
                </label>
                {espRubros.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setEspRubros([])}
                    className="text-[11px] font-semibold text-neutral-500 hover:text-[#E52421] transition-colors"
                  >
                    Limpiar selección
                  </button>
                )}
              </div>

              <div className="flex flex-wrap gap-1.5">
                {MARKETING_ESPECIAL_RUBROS.map((rubro) => {
                  const selected = espRubros.includes(rubro);
                  return (
                    <button
                      key={rubro}
                      type="button"
                      onClick={() => toggleEspRubro(rubro)}
                      className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors flex items-center gap-1.5 ${
                        selected
                          ? 'bg-[#101014] text-white border-[#101014]'
                          : 'bg-white text-neutral-700 border-[#E2E6EC] hover:border-[#101014]'
                      }`}
                    >
                      {selected && <Check className="w-3 h-3 text-[#E52421]" />}
                      <span>{rubro}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Optional Protocol Checkboxes + Observations */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 pt-1 items-end">
              <div className="lg:col-span-5 space-y-1.5">
                <span className="block text-xs font-semibold text-neutral-700">
                  Estado del protocolo (opcional)
                </span>
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      {
                        label: 'Video 3 días antes',
                        checked: espVideo3Dias,
                        toggle: () => setEspVideo3Dias((v) => !v),
                      },
                      {
                        label: 'Placa 1 día antes',
                        checked: espPlaca1Dia,
                        toggle: () => setEspPlaca1Dia((v) => !v),
                      },
                      {
                        label: 'Historias del día',
                        checked: espHistoriasDia,
                        toggle: () => setEspHistoriasDia((v) => !v),
                      },
                    ] as const
                  ).map((step) => (
                    <label
                      key={step.label}
                      className={`inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-xs cursor-pointer select-none transition-colors ${
                        step.checked
                          ? 'bg-emerald-50 border-emerald-300 text-emerald-900 font-semibold'
                          : 'bg-white border-[#E2E6EC] text-neutral-700 hover:border-neutral-400'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={step.checked}
                        onChange={step.toggle}
                        className="accent-[#101014] rounded"
                      />
                      <span>{step.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="lg:col-span-5">
                <label className="block text-xs font-semibold text-neutral-700 mb-1">
                  Observaciones breves
                </label>
                <input
                  type="text"
                  value={espObservaciones}
                  onChange={(e) => setEspObservaciones(e.target.value)}
                  placeholder="Ej: Promo Duplica con fuerte tracción en Yerba Buena..."
                  className="w-full px-3 py-2 bg-white border border-[#E2E6EC] rounded-lg text-xs text-[#101014] focus:outline-none focus:border-[#101014]"
                />
              </div>

              <div className="lg:col-span-2 flex justify-end">
                <button
                  type="submit"
                  className="w-full px-4 py-2 bg-[#E52421] hover:bg-[#C91D1A] text-white text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Guardar Especial</span>
                </button>
              </div>
            </div>

            {espError && (
              <div className="text-xs font-medium text-[#DC2626]">{espError}</div>
            )}
          </form>

          {/* Especiales Cards Grid */}
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs text-neutral-500">
              <span className="font-semibold text-[#101014]">
                Especiales registrados ({filteredEspeciales.length})
              </span>
              <span>
                Tildá o destildá los pasos del protocolo directamente en cada tarjeta
              </span>
            </div>

            {filteredEspeciales.length === 0 ? (
              <div className="bg-white border border-dashed border-[#E2E6EC] rounded-xl p-8 text-center text-xs text-neutral-500">
                No hay Especiales registrados para el filtro seleccionado.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {filteredEspeciales.map((esp) => {
                  const durationDays = calcInclusiveDays(esp.fechaInicio, esp.fechaFin);
                  const dateRangeLabel =
                    esp.fechaInicio === esp.fechaFin
                      ? formatDateAR(esp.fechaInicio)
                      : `${formatDateAR(esp.fechaInicio)} al ${formatDateAR(esp.fechaFin)}`;
                  const protocolDoneCount = [
                    esp.video3DiasAntes,
                    esp.placa1DiaAntes,
                    esp.historiasDelDia,
                  ].filter(Boolean).length;

                  return (
                    <article
                      key={esp.id}
                      className="bg-white border border-[#E2E6EC] rounded-xl p-4 flex flex-col justify-between gap-3.5 shadow-[0_1px_2px_rgba(16,16,20,0.03)]"
                    >
                      <div className="space-y-3">
                        {/* Card Top Row */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5 mb-1">
                              <span className="px-2 py-0.5 bg-[#E52421] text-white text-[10px] font-bold rounded font-mono tabular-nums">
                                {formatDurationBadge(durationDays)}
                              </span>
                              <span className="text-[11px] font-mono text-neutral-500 tabular-nums">
                                {dateRangeLabel}
                              </span>
                            </div>
                            <h4 className="text-sm font-bold text-[#101014] leading-snug">
                              {esp.nombre}
                            </h4>
                          </div>

                          <button
                            type="button"
                            onClick={() => onDeleteMarketingEspecial(esp.id)}
                            aria-label={`Eliminar especial ${esp.nombre}`}
                            className="p-1.5 text-neutral-400 hover:text-[#DC2626] rounded transition-colors shrink-0"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        {/* Rubros Chips */}
                        {esp.rubros && esp.rubros.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {esp.rubros.map((rubro) => (
                              <span
                                key={rubro}
                                className="px-2 py-0.5 bg-[#F8F6F4] border border-[#E2E6EC] text-[11px] font-medium text-[#101014] rounded-md"
                              >
                                {rubro}
                              </span>
                            ))}
                          </div>
                        )}

                        {esp.observaciones && (
                          <p className="text-xs text-neutral-600 leading-relaxed">
                            {esp.observaciones}
                          </p>
                        )}
                      </div>

                      {/* Interactive 3 Protocol Steps */}
                      <div className="pt-3 border-t border-[#E2E6EC] space-y-2">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="font-semibold text-neutral-600">
                            Protocolo de difusión
                          </span>
                          <span
                            className={`font-mono font-bold tabular-nums ${
                              protocolDoneCount === 3 ? 'text-[#16A34A]' : 'text-neutral-500'
                            }`}
                          >
                            {protocolDoneCount}/3
                          </span>
                        </div>

                        <div className="grid grid-cols-1 gap-1.5">
                          {(
                            [
                              { key: 'video3DiasAntes', label: 'Video 3 días antes' },
                              { key: 'placa1DiaAntes', label: 'Placa 1 día antes' },
                              { key: 'historiasDelDia', label: 'Historias del día' },
                            ] as const
                          ).map((step) => {
                            const checked = Boolean(esp[step.key]);
                            return (
                              <button
                                key={step.key}
                                type="button"
                                onClick={() => handleToggleEspecialProtocol(esp, step.key)}
                                className={`w-full text-left px-2.5 py-1.5 rounded-lg border text-xs flex items-center gap-2 transition-colors ${
                                  checked
                                    ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900 font-medium'
                                    : 'bg-[#F8F6F4]/70 border-[#E2E6EC] text-neutral-700 hover:border-[#101014]'
                                }`}
                              >
                                <span
                                  className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                                    checked
                                      ? 'bg-[#101014] border-[#101014] text-white'
                                      : 'bg-white border-neutral-300'
                                  }`}
                                >
                                  {checked && <Check className="w-3 h-3" />}
                                </span>
                                <span>{step.label}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* 4. BITÁCORA SEMANAL RÁPIDA (5 COLS) + REGISTRO DE REELS Y SORTEOS (7 COLS) */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* A. Bitácora Semanal Rápida (5 cols left) */}
        <div className="lg:col-span-5 bg-[#F5F6F8] border border-[#E2E6EC] shadow-[0_1px_2px_rgba(16,16,20,0.04)] rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-[#E2E6EC] bg-[#ECEFF3] flex items-center justify-between gap-2">
            <div>
              <div className="text-[11px] font-medium text-neutral-500">
                {currentChecklist.semana}
              </div>
              <h2 className="text-base font-bold text-[#101014]">
                Bitácora Semanal Rápida (2 minutos)
              </h2>
            </div>
            <span className="text-xs font-mono font-bold text-[#101014] bg-white border border-[#E2E6EC] px-2.5 py-1 rounded-md tabular-nums shrink-0">
              {checklistCompletedCount}/4 completos
            </span>
          </div>

          <div className="p-5 space-y-2.5">
            {(
              [
                {
                  key: 'grillaDiaria',
                  title: 'Grilla diaria 8–12 historias de comercios',
                  desc: 'Publicación sostenida de beneficios activos sin carga manual historia por historia.',
                },
                {
                  key: 'colaboraciones',
                  title: 'Colaboraciones Lun USPT / Mié Psicólogos / Vie Abogados / Dom TP',
                  desc: 'Publicaciones cruzadas con instituciones y convenios estratégicos.',
                },
                {
                  key: 'magoyaVideos',
                  title: 'Magoya y Videos emocionales Mar / Jue / Sáb',
                  desc: 'Contenido orgánico de alto alcance y recordación de marca en Tucumán.',
                },
                {
                  key: 'promoDuplica',
                  title: 'Especial Mensual Promo Duplica',
                  desc: 'Campaña destacada de beneficios duplicados y tráfico hacia la web.',
                },
              ] as const
            ).map((item) => {
              const checked = Boolean(currentChecklist[item.key]);
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => toggleChecklistField(item.key)}
                  className={`w-full text-left p-3.5 rounded-lg border transition-colors flex items-start gap-3 ${
                    checked
                      ? 'bg-[#ECEFF3] border-[#101014]'
                      : 'bg-white border-[#E2E6EC] hover:border-neutral-400'
                  }`}
                >
                  <div
                    className={`w-5 h-5 rounded border flex items-center justify-center shrink-0 mt-0.5 ${
                      checked
                        ? 'bg-[#101014] border-[#101014] text-white'
                        : 'border-neutral-300 bg-white'
                    }`}
                  >
                    {checked && <Check className="w-3.5 h-3.5" />}
                  </div>
                  <div className="min-w-0">
                    <div
                      className={`text-sm font-semibold leading-snug ${
                        checked ? 'text-[#101014]' : 'text-neutral-800'
                      }`}
                    >
                      {item.title}
                    </div>
                    <div className="text-xs text-neutral-500 mt-0.5 leading-relaxed">
                      {item.desc}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* B. Registro de Reels Armados y Sorteos Realizados (7 cols right) */}
        <div className="lg:col-span-7 bg-[#F5F6F8] border border-[#E2E6EC] shadow-[0_1px_2px_rgba(16,16,20,0.04)] rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-[#E2E6EC] bg-[#ECEFF3] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-[#101014]">
                Reels Armados y Sorteos Realizados ({filteredReelsSorteos.length})
              </h2>
              <p className="text-xs text-neutral-500">
                Bitácora de piezas producidas y sorteos con enlaces a Instagram o Drive
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Filtrar reels y sorteos por mes"
                value={reelMonthFilter}
                onChange={(e) => setReelMonthFilter(e.target.value)}
                className="px-2.5 py-1.5 bg-white border border-[#E2E6EC] rounded-lg text-xs font-medium text-[#101014] focus:outline-none focus:border-[#101014]"
              >
                <option value="TODOS">Todos los meses</option>
                {reelMonthOptions.map((ym) => (
                  <option key={ym} value={ym}>
                    {formatPeriodLabel(ym)}
                  </option>
                ))}
              </select>

              <select
                aria-label="Filtrar reels y sorteos por categoría"
                value={reelCategoryFilter}
                onChange={(e) =>
                  setReelCategoryFilter(e.target.value as 'TODAS' | MarketingReelCategoria)
                }
                className="px-2.5 py-1.5 bg-white border border-[#E2E6EC] rounded-lg text-xs font-medium text-[#101014] max-w-[210px] focus:outline-none focus:border-[#101014]"
              >
                <option value="TODAS">Todas las categorías</option>
                {MARKETING_REEL_CATEGORIAS.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="p-5 space-y-5">
            {/* Quick Form */}
            <form
              onSubmit={handleSaveReelSorteo}
              className="p-4 bg-[#F8F6F4] border border-[#E2E6EC] rounded-xl space-y-3"
            >
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                <div className="sm:col-span-8">
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">
                    Categoría
                  </label>
                  <select
                    value={reelCategoria}
                    onChange={(e) => setReelCategoria(e.target.value as MarketingReelCategoria)}
                    className="w-full px-3 py-2 bg-white border border-[#E2E6EC] rounded-lg text-xs font-medium text-[#101014] focus:outline-none focus:border-[#101014]"
                  >
                    {MARKETING_REEL_CATEGORIAS.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="sm:col-span-4">
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">
                    Fecha
                  </label>
                  <input
                    type="date"
                    value={reelFecha}
                    onChange={(e) => setReelFecha(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-[#E2E6EC] rounded-lg text-xs font-mono tabular-nums text-[#101014] focus:outline-none focus:border-[#101014]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">
                  Título / Descripción *
                </label>
                <input
                  type="text"
                  required
                  value={reelTitulo}
                  onChange={(e) => {
                    setReelTitulo(e.target.value);
                    if (reelError) setReelError('');
                  }}
                  placeholder="Ej: Reel cobertura Colegio de Abogados, Reel Feria de Empleo UNSTA, Sorteo Día de la Madre"
                  className="w-full px-3 py-2 bg-white border border-[#E2E6EC] rounded-lg text-xs text-[#101014] focus:outline-none focus:border-[#101014]"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                <div className="sm:col-span-5">
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">
                    Empresa / Comunidad vinculada
                  </label>
                  <select
                    value={reelEmpresaId}
                    onChange={(e) => setReelEmpresaId(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-[#E2E6EC] rounded-lg text-xs text-[#101014] focus:outline-none focus:border-[#101014]"
                  >
                    <option value="">Ninguna / Comunidad general</option>
                    {sortedCompanies.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nombre}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="sm:col-span-5">
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">
                    Enlace directo (Instagram / Drive)
                  </label>
                  <div className="relative">
                    <LinkIcon className="w-3.5 h-3.5 text-neutral-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={reelEnlace}
                      onChange={(e) => {
                        setReelEnlace(e.target.value);
                        if (reelError) setReelError('');
                      }}
                      placeholder="instagram.com/... o drive.google.com/..."
                      className="w-full pl-8 pr-3 py-2 bg-white border border-[#E2E6EC] rounded-lg text-xs text-[#101014] focus:outline-none focus:border-[#101014]"
                    />
                  </div>
                </div>

                <div className="sm:col-span-2">
                  <button
                    type="submit"
                    className="w-full px-3 py-2 bg-[#E52421] hover:bg-[#C91D1A] text-white text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-1 whitespace-nowrap"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Registrar</span>
                  </button>
                </div>
              </div>

              {reelError && (
                <div className="text-xs font-medium text-[#DC2626]">{reelError}</div>
              )}
            </form>

            {/* Scrollable Visual Cards Log */}
            <div className="space-y-2.5 max-h-[380px] overflow-y-auto pr-1">
              {filteredReelsSorteos.length === 0 ? (
                <div className="bg-white border border-dashed border-[#E2E6EC] rounded-xl p-6 text-center text-xs text-neutral-500">
                  No hay reels ni sorteos cargados para los filtros actuales.
                </div>
              ) : (
                filteredReelsSorteos.map((item) => {
                  const visual =
                    REEL_CATEGORY_VISUALS[item.categoria] ??
                    REEL_CATEGORY_VISUALS['Reel Comunidad (Abogados / Psicólogos / USPT / TP)'];
                  const Icon = visual.isGift ? Gift : Film;
                  const safeUrlCheck = item.enlace
                    ? normalizeAndValidateHttpUrl(item.enlace)
                    : { valid: false, normalized: '' };

                  return (
                    <div
                      key={item.id}
                      className={`p-3.5 bg-white border border-[#E2E6EC] border-l-4 ${visual.borderClass} rounded-lg flex items-start justify-between gap-3`}
                    >
                      <div className="flex items-start gap-3 min-w-0">
                        <div
                          className={`w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 mt-0.5 ${visual.iconBgClass} ${visual.iconTextClass}`}
                        >
                          <Icon className="w-4 h-4" />
                        </div>

                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                            <span className={`font-bold ${visual.badgeTextClass}`}>
                              {item.categoria}
                            </span>
                            <span aria-hidden="true" className="text-neutral-300">
                              ·
                            </span>
                            <span className="font-mono text-neutral-500 tabular-nums">
                              {formatDateAR(item.fecha)}
                            </span>
                          </div>

                          <div className="text-sm font-semibold text-[#101014] leading-snug">
                            {item.titulo}
                          </div>

                          <div className="flex flex-wrap items-center gap-3 pt-0.5">
                            {item.empresaNombre && (
                              <span className="text-[11px] font-medium text-neutral-600">
                                Empresa / Comunidad:{' '}
                                <strong className="text-[#101014]">{item.empresaNombre}</strong>
                              </span>
                            )}

                            {safeUrlCheck.valid && safeUrlCheck.normalized && (
                              <a
                                href={safeUrlCheck.normalized}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#E52421] hover:underline"
                              >
                                <span>{getSafeExternalLinkLabel(safeUrlCheck.normalized)}</span>
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            )}
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => onDeleteMarketingReelSorteo(item.id)}
                        className="p-1.5 text-neutral-400 hover:text-[#DC2626] rounded transition-colors shrink-0"
                        aria-label={`Eliminar ${item.titulo}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </section>

      <QuickTaskModal
        open={taskModalOpen}
        defaultSector="Marketing"
        companies={companies}
        onClose={() => setTaskModalOpen(false)}
        onCreateTask={(task) => {
          onAddPlanTask(task);
          showConfirmBanner('Tarea de Marketing agregada a Planificación Semanal.');
        }}
      />
    </div>
  );
};
