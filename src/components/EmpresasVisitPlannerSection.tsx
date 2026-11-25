import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  APIProvider,
  AdvancedMarker,
  InfoWindow,
  Map as GoogleMap,
  Pin,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import {
  AlertTriangle,
  Check,
  Clock,
  ExternalLink,
  Flag,
  Loader2,
  MapPin,
  Navigation,
  Plus,
  RefreshCw,
  Route as RouteIcon,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import type { Company, CompanyStatus } from '../types';

interface EmpresasVisitPlannerSectionProps {
  companies: Company[];
  onViewCompanyProfile: (companyId: string) => void;
}

interface LatLngPoint {
  lat: number;
  lng: number;
}

interface ResolvedCompanyGeo {
  key: string;
  point: LatLngPoint | null;
  formattedAddress?: string;
  error?: string;
}

interface StartOrigin {
  address: string;
  point: LatLngPoint;
}

interface OptimizedStopLeg {
  company: Company;
  point: LatLngPoint;
  stopNumber: number;
  legDistanceMeters: number;
  legDurationSeconds: number;
}

interface RoutePlanResult {
  origin: StartOrigin;
  stops: OptimizedStopLeg[];
  totalDistanceMeters: number;
  totalDurationSeconds: number;
  isEstimatedFallback: boolean;
  signature: string;
}

interface PolylineHandle {
  setMap: (map: unknown) => void;
  setOptions?: (options: Record<string, unknown>) => void;
}

const TUCUMAN_CENTER: LatLngPoint = { lat: -26.8241, lng: -65.2226 };
const ATTRIBUTION_IDS = ['gmp_mcp_codeassist_v1_aistudio'];

const PANEL_CATEGORY_OPTIONS: Array<{ value: CompanyStatus; label: string }> = [
  { value: 'Activa', label: 'Clientes activos' },
  { value: 'Prospecto', label: 'Empresas prospecto con propuesta' },
  { value: 'Prospecto rechazada', label: 'Empresas prospecto rechazadas' },
  { value: 'Dado de baja', label: 'Clientes dados de baja' },
  { value: 'Otros', label: 'Otros' },
];

function getPanelCategoryLabel(status: CompanyStatus): string {
  return PANEL_CATEGORY_OPTIONS.find((opt) => opt.value === status)?.label ?? status;
}

function getStatusPinColors(status: CompanyStatus): {
  background: string;
  borderColor: string;
  glyphColor: string;
  dotClass: string;
  textClass: string;
} {
  switch (status) {
    case 'Activa':
      return {
        background: '#16A34A',
        borderColor: '#14532D',
        glyphColor: '#FFFFFF',
        dotClass: 'bg-[#16A34A]',
        textClass: 'text-[#16A34A]',
      };
    case 'Prospecto':
      return {
        background: '#D97706',
        borderColor: '#92400E',
        glyphColor: '#FFFFFF',
        dotClass: 'bg-[#D97706]',
        textClass: 'text-[#D97706]',
      };
    case 'Prospecto rechazada':
      return {
        background: '#DC2626',
        borderColor: '#991B1B',
        glyphColor: '#FFFFFF',
        dotClass: 'bg-[#DC2626]',
        textClass: 'text-[#DC2626]',
      };
    case 'Dado de baja':
      return {
        background: '#6B7280',
        borderColor: '#374151',
        glyphColor: '#FFFFFF',
        dotClass: 'bg-neutral-500',
        textClass: 'text-neutral-500',
      };
    case 'Otros':
      return {
        background: '#7C3AED',
        borderColor: '#5B21B6',
        glyphColor: '#FFFFFF',
        dotClass: 'bg-[#7C3AED]',
        textClass: 'text-[#7C3AED]',
      };
    default:
      return {
        background: '#101014',
        borderColor: '#000000',
        glyphColor: '#FFFFFF',
        dotClass: 'bg-[#101014]',
        textClass: 'text-[#101014]',
      };
  }
}

function buildCompanyGeoKey(company: Company): string {
  return `${company.id}::${(company.direccion || '').trim().toLowerCase()}::${(company.localidad || '').trim().toLowerCase()}`;
}

function hasValidFallbackCoords(company: Company): boolean {
  return (
    Number.isFinite(company.lat) &&
    Number.isFinite(company.lng) &&
    Math.abs(company.lat) > 0.01 &&
    Math.abs(company.lng) > 0.01
  );
}

function haversineMeters(a: LatLngPoint, b: LatLngPoint): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/**
 * Computes an efficient open-path visiting order starting at `origin`
 * using Nearest-Neighbor followed by 2-opt refinement (no return to origin).
 */
function computeOpenPathOrder<T extends { point: LatLngPoint }>(
  origin: LatLngPoint,
  items: T[]
): T[] {
  if (items.length <= 1) return [...items];

  const remaining = [...items];
  const ordered: T[] = [];
  let cursor = origin;

  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = haversineMeters(cursor, remaining[i].point);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    const [next] = remaining.splice(bestIdx, 1);
    ordered.push(next);
    cursor = next.point;
  }

  // Open-path 2-opt improvement (origin is fixed before ordered[0], end is free)
  const totalDist = (arr: T[]): number => {
    let sum = haversineMeters(origin, arr[0].point);
    for (let i = 0; i < arr.length - 1; i++) {
      sum += haversineMeters(arr[i].point, arr[i + 1].point);
    }
    return sum;
  };

  let improved = true;
  let guard = 0;
  while (improved && guard < 120) {
    improved = false;
    guard++;
    let currentBest = totalDist(ordered);
    for (let i = 0; i < ordered.length - 1; i++) {
      for (let j = i + 1; j < ordered.length; j++) {
        const candidate = [
          ...ordered.slice(0, i),
          ...ordered.slice(i, j + 1).reverse(),
          ...ordered.slice(j + 1),
        ];
        const candidateDist = totalDist(candidate);
        if (candidateDist + 1 < currentBest) {
          ordered.splice(0, ordered.length, ...candidate);
          currentBest = candidateDist;
          improved = true;
        }
      }
    }
  }

  return ordered;
}

function buildEstimatedFallbackPlan(
  origin: StartOrigin,
  locatedItems: Array<{ company: Company; point: LatLngPoint }>,
  signature: string
): RoutePlanResult {
  const ordered = computeOpenPathOrder(origin.point, locatedItems);
  let cursor = origin.point;
  let totalDistanceMeters = 0;
  let totalDurationSeconds = 0;

  const stops: OptimizedStopLeg[] = ordered.map((item, idx) => {
    const straightMeters = haversineMeters(cursor, item.point);
    const roadMeters = Math.max(150, Math.round(straightMeters * 1.32));
    // Urban Tucumán average speed ~30 km/h (8.33 m/s) + 1.5 min buffer
    const durationSeconds = Math.max(120, Math.round(roadMeters / 8.33 + 60));
    totalDistanceMeters += roadMeters;
    totalDurationSeconds += durationSeconds;
    cursor = item.point;

    return {
      company: item.company,
      point: item.point,
      stopNumber: idx + 1,
      legDistanceMeters: roadMeters,
      legDurationSeconds: durationSeconds,
    };
  });

  return {
    origin,
    stops,
    totalDistanceMeters,
    totalDurationSeconds,
    isEstimatedFallback: true,
    signature,
  };
}

function formatDistanceKm(meters: number): string {
  const km = meters / 1000;
  if (km < 1) {
    return `${Math.round(meters)} m`;
  }
  return `${km.toFixed(1).replace('.', ',')} km`;
}

function formatDurationEs(seconds: number): string {
  const totalMin = Math.max(1, Math.round(seconds / 60));
  if (totalMin < 60) {
    return `${totalMin} min`;
  }
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  return mins > 0 ? `${hours} h ${mins} min` : `${hours} h`;
}

function formatGoogleMapsAddress(company: Company, point: LatLngPoint): string {
  const dir = company.direccion?.trim();
  const loc = company.localidad?.trim();
  if (dir && loc) return `${dir}, ${loc}, Tucumán, Argentina`;
  if (dir) return `${dir}, Tucumán, Argentina`;
  return `${point.lat},${point.lng}`;
}

function buildGoogleMapsDirectionsUrl(plan: RoutePlanResult): string {
  if (plan.stops.length === 0) return 'https://www.google.com/maps';

  const originParam = encodeURIComponent(
    plan.origin.address.trim() || `${plan.origin.point.lat},${plan.origin.point.lng}`
  );
  const lastStop = plan.stops[plan.stops.length - 1];
  const destinationParam = encodeURIComponent(
    formatGoogleMapsAddress(lastStop.company, lastStop.point)
  );
  const intermediateStops = plan.stops.slice(0, -1);

  let url = `https://www.google.com/maps/dir/?api=1&origin=${originParam}&destination=${destinationParam}&travelmode=driving`;
  if (intermediateStops.length > 0) {
    const waypoints = intermediateStops
      .map((stop) => encodeURIComponent(formatGoogleMapsAddress(stop.company, stop.point)))
      .join('|');
    url += `&waypoints=${waypoints}`;
  }
  return url;
}

function extractPoint(loc: unknown): LatLngPoint | null {
  if (!loc || typeof loc !== 'object') return null;
  const candidate = loc as {
    lat?: number | (() => number);
    lng?: number | (() => number);
  };
  const lat = typeof candidate.lat === 'function' ? candidate.lat() : candidate.lat;
  const lng = typeof candidate.lng === 'function' ? candidate.lng() : candidate.lng;
  if (typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng)) {
    return { lat, lng };
  }
  return null;
}

// ============================================================================
// Inner Google Maps Helpers (must be rendered inside <APIProvider>)
// ============================================================================

interface CompanyAddressResolverProps {
  selectedCompanies: Company[];
  geoCache: Record<string, ResolvedCompanyGeo>;
  onResolved: (companyId: string, result: ResolvedCompanyGeo) => void;
  onResolvingChange: (isResolving: boolean) => void;
}

const CompanyAddressResolver: React.FC<CompanyAddressResolverProps> = ({
  selectedCompanies,
  geoCache,
  onResolved,
  onResolvingChange,
}) => {
  const placesLib = useMapsLibrary('places');
  const inFlightKeysRef = useRef<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;

    const pending = selectedCompanies.filter((company) => {
      const key = buildCompanyGeoKey(company);
      const cached = geoCache[company.id];
      if (cached && cached.key === key) return false;
      if (inFlightKeysRef.current[key]) return false;
      return true;
    });

    if (pending.length === 0) {
      onResolvingChange(false);
      return;
    }

    // Immediately handle companies without an address (doesn't require Places lib)
    const withAddress: Company[] = [];
    for (const company of pending) {
      const key = buildCompanyGeoKey(company);
      if (!company.direccion || !company.direccion.trim()) {
        onResolved(company.id, {
          key,
          point: null,
          error: 'Sin dirección cargada en la ficha',
        });
      } else {
        withAddress.push(company);
      }
    }

    if (withAddress.length === 0) {
      onResolvingChange(false);
      return;
    }

    if (!placesLib) return;

    const PlaceClass = (placesLib as unknown as {
      Place?: {
        searchByText?: (req: Record<string, unknown>) => Promise<{
          places?: Array<{ location?: unknown; formattedAddress?: string }>;
        }>;
      };
    }).Place;

    if (!PlaceClass?.searchByText) {
      // Fallback gracefully to valid stored coordinates if searchByText isn't available
      for (const company of withAddress) {
        const key = buildCompanyGeoKey(company);
        if (hasValidFallbackCoords(company)) {
          onResolved(company.id, {
            key,
            point: { lat: company.lat, lng: company.lng },
            formattedAddress: `${company.direccion}, ${company.localidad}`,
          });
        } else {
          onResolved(company.id, {
            key,
            point: null,
            error: 'No se pudo verificar la dirección en Google Maps',
          });
        }
      }
      onResolvingChange(false);
      return;
    }

    const resolveBatch = async () => {
      onResolvingChange(true);

      for (const company of withAddress) {
        if (cancelled) break;
        const key = buildCompanyGeoKey(company);
        if (inFlightKeysRef.current[key]) continue;
        inFlightKeysRef.current[key] = true;

        const localidad = company.localidad?.trim() || 'San Miguel de Tucumán';
        const query = `${company.direccion.trim()}, ${localidad}, Tucumán, Argentina`;

        try {
          const response = await PlaceClass.searchByText!({
            textQuery: query,
            fields: ['location', 'formattedAddress'],
            language: 'es',
            region: 'ar',
            maxResultCount: 1,
            locationBias: {
              center: TUCUMAN_CENTER,
              radius: 50000,
            },
          });

          if (cancelled) break;

          const firstPlace = response?.places?.[0];
          const point = extractPoint(firstPlace?.location);

          if (point) {
            onResolved(company.id, {
              key,
              point,
              formattedAddress: firstPlace?.formattedAddress || query,
            });
          } else {
            onResolved(company.id, {
              key,
              point: null,
              error: 'Google Maps no pudo ubicar la dirección registrada',
            });
          }
        } catch {
          if (cancelled) break;
          // If Places API failed due to network/quota, gracefully fall back to stored coords when available
          if (hasValidFallbackCoords(company)) {
            onResolved(company.id, {
              key,
              point: { lat: company.lat, lng: company.lng },
              formattedAddress: `${company.direccion}, ${localidad}`,
            });
          } else {
            onResolved(company.id, {
              key,
              point: null,
              error: 'No se pudo geocodificar la dirección',
            });
          }
        } finally {
          delete inFlightKeysRef.current[key];
        }
      }

      if (!cancelled) {
        onResolvingChange(false);
      }
    };

    void resolveBatch();

    return () => {
      cancelled = true;
    };
  }, [placesLib, selectedCompanies, geoCache, onResolved, onResolvingChange]);

  return null;
};

interface MapBoundsControllerProps {
  points: LatLngPoint[];
  fitTrigger: number;
}

const MapBoundsController: React.FC<MapBoundsControllerProps> = ({ points, fitTrigger }) => {
  const map = useMap();
  const coreLib = useMapsLibrary('core');

  useEffect(() => {
    if (!map) return;

    if (points.length === 0) {
      map.panTo(TUCUMAN_CENTER);
      map.setZoom(12);
      return;
    }

    if (points.length === 1) {
      map.panTo(points[0]);
      map.setZoom(15);
      return;
    }

    if (!coreLib) return;
    const bounds = new coreLib.LatLngBounds();
    points.forEach((pt) => bounds.extend(pt));
    map.fitBounds(bounds, { top: 64, right: 64, bottom: 64, left: 64 });
  }, [map, coreLib, points, fitTrigger]);

  return null;
};

interface RouteComputationRequest {
  requestId: number;
  origin: StartOrigin;
  locatedItems: Array<{ company: Company; point: LatLngPoint }>;
  signature: string;
}

interface RouteOverlayControllerProps {
  request: RouteComputationRequest | null;
  clearRouteSignal: number;
  onRouteComputed: (plan: RoutePlanResult) => void;
  onRouteError: (message: string) => void;
  onComputingChange: (computing: boolean) => void;
}

const RouteOverlayController: React.FC<RouteOverlayControllerProps> = ({
  request,
  clearRouteSignal,
  onRouteComputed,
  onRouteError,
  onComputingChange,
}) => {
  const map = useMap();
  const routesLib = useMapsLibrary('routes');
  const mapsLib = useMapsLibrary('maps');
  const polylinesRef = useRef<PolylineHandle[]>([]);

  const clearPolylines = useCallback(() => {
    polylinesRef.current.forEach((pl) => {
      try {
        pl.setMap(null);
      } catch {
        // ignore cleanup errors
      }
    });
    polylinesRef.current = [];
  }, []);

  useEffect(() => {
    clearPolylines();
  }, [clearRouteSignal, clearPolylines]);

  useEffect(() => {
    return () => {
      clearPolylines();
    };
  }, [clearPolylines]);

  useEffect(() => {
    if (!request) {
      clearPolylines();
      return;
    }

    let cancelled = false;

    const drawFallbackPolyline = (path: LatLngPoint[]) => {
      if (!map || !mapsLib) return;
      const PolylineCtor = (mapsLib as unknown as {
        Polyline?: new (opts: Record<string, unknown>) => PolylineHandle;
      }).Polyline;
      if (!PolylineCtor) return;
      const fallbackPolyline = new PolylineCtor({
        path,
        geodesic: true,
        strokeColor: '#E52421',
        strokeOpacity: 0.85,
        strokeWeight: 4,
        map,
      });
      polylinesRef.current = [fallbackPolyline];
    };

    const runCompute = async () => {
      onComputingChange(true);
      clearPolylines();

      const { origin, locatedItems, signature } = request;
      const preOrdered = computeOpenPathOrder(origin.point, locatedItems);

      const RouteClass = (routesLib as unknown as {
        Route?: {
          computeRoutes?: (req: Record<string, unknown>) => Promise<{
            routes?: Array<{
              distanceMeters?: number;
              durationMillis?: number;
              viewport?: unknown;
              optimizedIntermediateWaypointIndex?: number[];
              legs?: Array<{
                distanceMeters?: number;
                durationMillis?: number;
              }>;
              createPolylines?: (options?: Record<string, unknown>) => PolylineHandle[];
            }>;
          }>;
        };
      })?.Route;

      if (!RouteClass?.computeRoutes) {
        if (!cancelled) {
          const fallback = buildEstimatedFallbackPlan(origin, preOrdered, signature);
          drawFallbackPolyline([origin.point, ...fallback.stops.map((s) => s.point)]);
          onRouteComputed(fallback);
          onComputingChange(false);
        }
        return;
      }

      const lastItem = preOrdered[preOrdered.length - 1];
      const intermediates = preOrdered.slice(0, -1);

      const executeRoutesCall = async (withWaypointOpt: boolean) => {
        const payload: Record<string, unknown> = {
          origin: origin.point,
          destination: lastItem.point,
          travelMode: 'DRIVING',
          language: 'es',
          units: 'METRIC',
          fields: [
            'path',
            'distanceMeters',
            'durationMillis',
            'viewport',
            'legs',
            'optimizedIntermediateWaypointIndex',
          ],
        };

        if (intermediates.length > 0) {
          payload.intermediates = intermediates.map((item) => ({ location: item.point }));
          if (withWaypointOpt && intermediates.length >= 2) {
            payload.optimizeWaypointOrder = true;
          }
        }

        return RouteClass.computeRoutes!(payload);
      };

      try {
        let result;
        try {
          result = await executeRoutesCall(intermediates.length >= 2);
        } catch {
          // Retry cleanly without optimizeWaypointOrder if the wrapper rejects that option
          result = await executeRoutesCall(false);
        }

        if (cancelled) return;

        const primaryRoute = result?.routes?.[0];
        if (!primaryRoute) {
          throw new Error('No se encontró una ruta vehicular para las direcciones seleccionadas.');
        }

        // Reorder intermediate items if Google returned an optimized waypoint order
        let finalOrdered = preOrdered;
        const optIdx = primaryRoute.optimizedIntermediateWaypointIndex;
        if (
          Array.isArray(optIdx) &&
          optIdx.length === intermediates.length &&
          optIdx.every((idx) => typeof idx === 'number' && idx >= 0 && idx < intermediates.length)
        ) {
          finalOrdered = [...optIdx.map((idx) => intermediates[idx]), lastItem];
        }

        const legs = primaryRoute.legs ?? [];
        const stops: OptimizedStopLeg[] = finalOrdered.map((item, idx) => {
          const leg = legs[idx];
          const prevPoint = idx === 0 ? origin.point : finalOrdered[idx - 1].point;
          const fallbackDist = Math.round(haversineMeters(prevPoint, item.point) * 1.3);
          const legDistanceMeters =
            typeof leg?.distanceMeters === 'number' && leg.distanceMeters > 0
              ? leg.distanceMeters
              : fallbackDist;
          const legDurationSeconds =
            typeof leg?.durationMillis === 'number' && leg.durationMillis > 0
              ? Math.round(leg.durationMillis / 1000)
              : Math.max(120, Math.round(legDistanceMeters / 8.33));

          return {
            company: item.company,
            point: item.point,
            stopNumber: idx + 1,
            legDistanceMeters,
            legDurationSeconds,
          };
        });

        const totalDistanceMeters =
          typeof primaryRoute.distanceMeters === 'number' && primaryRoute.distanceMeters > 0
            ? primaryRoute.distanceMeters
            : stops.reduce((acc, s) => acc + s.legDistanceMeters, 0);

        const totalDurationSeconds =
          typeof primaryRoute.durationMillis === 'number' && primaryRoute.durationMillis > 0
            ? Math.round(primaryRoute.durationMillis / 1000)
            : stops.reduce((acc, s) => acc + s.legDurationSeconds, 0);

        if (map && typeof primaryRoute.createPolylines === 'function') {
          const created = primaryRoute.createPolylines({
            polylineOptions: {
              strokeColor: '#E52421',
              strokeOpacity: 0.92,
              strokeWeight: 5,
            },
          });
          created.forEach((pl) => {
            pl.setOptions?.({
              strokeColor: '#E52421',
              strokeOpacity: 0.92,
              strokeWeight: 5,
            });
            pl.setMap(map);
          });
          polylinesRef.current = created;

          if (primaryRoute.viewport) {
            map.fitBounds(primaryRoute.viewport as Parameters<typeof map.fitBounds>[0], {
              top: 64,
              right: 64,
              bottom: 64,
              left: 64,
            });
          }
        }

        onRouteComputed({
          origin,
          stops,
          totalDistanceMeters,
          totalDurationSeconds,
          isEstimatedFallback: false,
          signature,
        });
      } catch (err) {
        if (cancelled) return;
        // Graceful fallback so the planner always produces an actionable order
        const fallback = buildEstimatedFallbackPlan(origin, preOrdered, signature);
        drawFallbackPolyline([origin.point, ...fallback.stops.map((s) => s.point)]);
        onRouteComputed(fallback);
        onRouteError(
          err instanceof Error
            ? 'No se pudo consultar el trazado vial en tiempo real; se calculó un orden y tiempo estimado.'
            : 'Se calculó un recorrido estimado por distancia.'
        );
      } finally {
        if (!cancelled) {
          onComputingChange(false);
        }
      }
    };

    void runCompute();

    return () => {
      cancelled = true;
    };
  }, [request, routesLib, mapsLib, map, clearPolylines, onRouteComputed, onRouteError, onComputingChange]);

  return null;
};

// ============================================================================
// Modern Places API (New) Autocomplete Input for "Dirección de inicio"
// ============================================================================

interface StartAddressAutocompleteInputProps {
  value: string;
  onChangeText: (text: string) => void;
  onSelectOrigin: (origin: StartOrigin) => void;
  onResolveManualRef: React.MutableRefObject<((text: string) => Promise<StartOrigin | null>) | null>;
  disabled?: boolean;
}

interface SuggestionItem {
  id: string;
  mainText: string;
  secondaryText: string;
  fullText: string;
  prediction: {
    toPlace: () => {
      fetchFields: (opts: { fields: string[] }) => Promise<unknown>;
      formattedAddress?: string;
      displayName?: string;
      location?: unknown;
    };
  };
}

const StartAddressAutocompleteInput: React.FC<StartAddressAutocompleteInputProps> = ({
  value,
  onChangeText,
  onSelectOrigin,
  onResolveManualRef,
  disabled,
}) => {
  const placesLib = useMapsLibrary('places');
  const [suggestions, setSuggestions] = useState<SuggestionItem[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const sessionTokenRef = useRef<unknown>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const resetSessionToken = useCallback(() => {
    const TokenClass = (placesLib as unknown as {
      AutocompleteSessionToken?: new () => unknown;
    })?.AutocompleteSessionToken;
    sessionTokenRef.current = TokenClass ? new TokenClass() : null;
  }, [placesLib]);

  // Expose manual address resolver for when user types an address and clicks "Optimizar recorrido" directly
  useEffect(() => {
    onResolveManualRef.current = async (rawText: string): Promise<StartOrigin | null> => {
      const cleaned = rawText.trim();
      if (!cleaned) return null;

      const PlaceClass = (placesLib as unknown as {
        Place?: {
          searchByText?: (req: Record<string, unknown>) => Promise<{
            places?: Array<{ location?: unknown; formattedAddress?: string }>;
          }>;
        };
      })?.Place;

      if (!PlaceClass?.searchByText) return null;

      try {
        const query = cleaned.toLowerCase().includes('tucum') || cleaned.toLowerCase().includes('argentina')
          ? cleaned
          : `${cleaned}, Tucumán, Argentina`;

        const res = await PlaceClass.searchByText({
          textQuery: query,
          fields: ['location', 'formattedAddress'],
          language: 'es',
          region: 'ar',
          maxResultCount: 1,
          locationBias: {
            center: TUCUMAN_CENTER,
            radius: 50000,
          },
        });

        const first = res?.places?.[0];
        const point = extractPoint(first?.location);
        if (!point) return null;

        return {
          address: first?.formattedAddress || cleaned,
          point,
        };
      } catch {
        return null;
      }
    };
  }, [placesLib, onResolveManualRef]);

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Fetch modern Places Autocomplete suggestions
  useEffect(() => {
    const trimmed = value.trim();
    if (!placesLib || trimmed.length < 3 || !isOpen) {
      setSuggestions([]);
      setIsSearching(false);
      return;
    }

    const AutocompleteSuggestionClass = (placesLib as unknown as {
      AutocompleteSuggestion?: {
        fetchAutocompleteSuggestions?: (req: Record<string, unknown>) => Promise<{
          suggestions?: Array<{
            placePrediction?: {
              placeId?: string;
              text?: { text?: string };
              mainText?: { text?: string };
              secondaryText?: { text?: string };
              toPlace: () => {
                fetchFields: (opts: { fields: string[] }) => Promise<unknown>;
                formattedAddress?: string;
                displayName?: string;
                location?: unknown;
              };
            };
          }>;
        }>;
      };
    })?.AutocompleteSuggestion;

    if (!AutocompleteSuggestionClass?.fetchAutocompleteSuggestions) {
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      if (!sessionTokenRef.current) {
        resetSessionToken();
      }
      setIsSearching(true);
      try {
        const res = await AutocompleteSuggestionClass.fetchAutocompleteSuggestions!({
          input: trimmed,
          sessionToken: sessionTokenRef.current,
          includedRegionCodes: ['ar'],
          language: 'es',
          locationBias: {
            center: TUCUMAN_CENTER,
            radius: 45000,
          },
        });

        if (cancelled) return;

        const mapped: SuggestionItem[] = (res?.suggestions ?? [])
          .filter((s) => Boolean(s.placePrediction))
          .slice(0, 5)
          .map((s, idx) => {
            const pred = s.placePrediction!;
            const fullText = pred.text?.text ?? '';
            const mainText = pred.mainText?.text ?? fullText;
            const secondaryText = pred.secondaryText?.text ?? '';
            return {
              id: pred.placeId || `sug-${idx}`,
              mainText,
              secondaryText,
              fullText,
              prediction: pred,
            };
          });

        setSuggestions(mapped);
      } catch {
        if (!cancelled) {
          setSuggestions([]);
        }
      } finally {
        if (!cancelled) {
          setIsSearching(false);
        }
      }
    }, 240);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [value, placesLib, isOpen, resetSessionToken]);

  const handlePickSuggestion = async (item: SuggestionItem) => {
    setIsOpen(false);
    setSuggestions([]);
    onChangeText(item.fullText);

    try {
      const place = item.prediction.toPlace();
      await place.fetchFields({
        fields: ['formattedAddress', 'location', 'displayName'],
      });
      const point = extractPoint(place.location);
      const formatted = place.formattedAddress || item.fullText;
      if (point) {
        onChangeText(formatted);
        onSelectOrigin({ address: formatted, point });
      }
    } catch {
      // If fetchFields fails, manual resolution on submit will handle it
    } finally {
      resetSessionToken();
    }
  };

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="relative">
        <Search className="w-4 h-4 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          type="text"
          value={value}
          disabled={disabled}
          onFocus={() => {
            if (value.trim().length >= 3) setIsOpen(true);
          }}
          onChange={(e) => {
            onChangeText(e.target.value);
            setIsOpen(true);
          }}
          placeholder="Ej: 25 de Mayo 350, San Miguel de Tucumán"
          className="w-full pl-9 pr-9 py-2.5 bg-white border border-[#E2E6EC] rounded-lg text-sm text-[#101014] placeholder:text-neutral-400 focus:outline-none focus:border-[#101014] disabled:opacity-60"
        />
        {isSearching ? (
          <Loader2 className="w-4 h-4 text-neutral-400 animate-spin absolute right-3 top-1/2 -translate-y-1/2" />
        ) : (
          value && (
            <button
              type="button"
              onClick={() => {
                onChangeText('');
                setSuggestions([]);
                setIsOpen(false);
              }}
              aria-label="Limpiar dirección de inicio"
              className="p-1 text-neutral-400 hover:text-[#101014] absolute right-2 top-1/2 -translate-y-1/2"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )
        )}
      </div>

      {isOpen && suggestions.length > 0 && (
        <ul className="absolute z-30 left-0 right-0 mt-1 bg-white border border-[#E2E6EC] rounded-lg shadow-lg overflow-hidden divide-y divide-[#E2E6EC]/60">
          {suggestions.map((sug) => (
            <li key={sug.id}>
              <button
                type="button"
                onClick={() => handlePickSuggestion(sug)}
                className="w-full text-left px-3 py-2.5 hover:bg-[#F5F6F8] transition-colors flex items-start gap-2.5"
              >
                <MapPin className="w-3.5 h-3.5 text-[#E52421] shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-[#101014] truncate">{sug.mainText}</div>
                  {sug.secondaryText && (
                    <div className="text-[11px] text-neutral-500 truncate">{sug.secondaryText}</div>
                  )}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

// ============================================================================
// Main Exported Component
// ============================================================================

export const EmpresasVisitPlannerSection: React.FC<EmpresasVisitPlannerSectionProps> = ({
  companies,
  onViewCompanyProfile,
}) => {
  const apiKey = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined)?.trim() ?? '';
  const [mapsQuotaFallback, setMapsQuotaFallback] = useState(false);

  // Panel selection state (strictly independent from Empresas main filters & data)
  const [panelCategory, setPanelCategory] = useState<CompanyStatus>('Activa');
  const [selectedMapCompanyIds, setSelectedMapCompanyIds] = useState<string[]>([]);

  // Resolved locations cache for selected companies
  const [geoCache, setGeoCache] = useState<Record<string, ResolvedCompanyGeo>>({});
  const [isResolvingGeo, setIsResolvingGeo] = useState(false);

  // Active marker InfoWindow state
  const [activeInfoWindow, setActiveInfoWindow] = useState<
    | { type: 'company'; companyId: string }
    | { type: 'start' }
    | null
  >(null);
  const [fitTrigger, setFitTrigger] = useState(0);

  // Route planner state
  const [startAddressText, setStartAddressText] = useState('');
  const [resolvedStartOrigin, setResolvedStartOrigin] = useState<StartOrigin | null>(null);
  const [routeRequest, setRouteRequest] = useState<RouteComputationRequest | null>(null);
  const [clearRouteSignal, setClearRouteSignal] = useState(0);
  const [routePlan, setRoutePlan] = useState<RoutePlanResult | null>(null);
  const [isComputingRoute, setIsComputingRoute] = useState(false);
  const [plannerNotice, setPlannerNotice] = useState<{
    tone: 'error' | 'info';
    text: string;
  } | null>(null);

  const resolveManualOriginRef = useRef<((text: string) => Promise<StartOrigin | null>) | null>(
    null
  );
  const requestSeqRef = useRef(0);

  // Listen to global Tier 1 Google Maps quota / auth fallback event
  useEffect(() => {
    const handleQuotaExceeded = () => setMapsQuotaFallback(true);
    window.addEventListener('gmp-quota-exceeded', handleQuotaExceeded);
    return () => window.removeEventListener('gmp-quota-exceeded', handleQuotaExceeded);
  }, []);

  // Keep selectedMapCompanyIds clean if a company gets deleted in EmpresasView
  useEffect(() => {
    const validIds: Record<string, boolean> = {};
    companies.forEach((c) => {
      validIds[c.id] = true;
    });
    setSelectedMapCompanyIds((prev) => {
      const next = prev.filter((id) => validIds[id]);
      return next.length === prev.length ? prev : next;
    });
  }, [companies]);

  const companyById = useMemo(() => {
    const record: Record<string, Company> = {};
    companies.forEach((c) => {
      record[c.id] = c;
    });
    return record;
  }, [companies]);

  const selectedIdLookup = useMemo(() => {
    const lookup: Record<string, boolean> = {};
    selectedMapCompanyIds.forEach((id) => {
      lookup[id] = true;
    });
    return lookup;
  }, [selectedMapCompanyIds]);

  // Companies matching the current panel category dropdown
  const categoryCompanies = useMemo(() => {
    return companies
      .filter((c) => c.estado === panelCategory)
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }, [companies, panelCategory]);

  // Selected companies in selection order
  const selectedCompanies = useMemo(() => {
    return selectedMapCompanyIds
      .map((id) => companyById[id])
      .filter((c): c is Company => Boolean(c));
  }, [selectedMapCompanyIds, companyById]);

  // Separate located vs unlocated selected companies
  const { locatedSelected, unlocatedSelected } = useMemo(() => {
    const located: Array<{ company: Company; point: LatLngPoint; formattedAddress?: string }> = [];
    const unlocated: Array<{ company: Company; reason: string }> = [];

    for (const company of selectedCompanies) {
      const expectedKey = buildCompanyGeoKey(company);
      const cached = geoCache[company.id];

      if (!company.direccion || !company.direccion.trim()) {
        unlocated.push({ company, reason: 'Sin dirección cargada en la ficha' });
        continue;
      }

      if (cached && cached.key === expectedKey) {
        if (cached.point) {
          located.push({
            company,
            point: cached.point,
            formattedAddress: cached.formattedAddress,
          });
        } else {
          unlocated.push({
            company,
            reason: cached.error || 'No pudo ubicarse en Google Maps',
          });
        }
      } else if ((!apiKey || mapsQuotaFallback) && hasValidFallbackCoords(company)) {
        located.push({
          company,
          point: { lat: company.lat, lng: company.lng },
          formattedAddress: `${company.direccion}, ${company.localidad}`,
        });
      }
    }

    return { locatedSelected: located, unlocatedSelected: unlocated };
  }, [selectedCompanies, geoCache, apiKey, mapsQuotaFallback]);

  // Map companyId -> optimized stop number when routePlan matches current selection
  const currentSelectionSignature = useMemo(() => {
    const ids = [...locatedSelected.map((x) => x.company.id)].sort().join(',');
    const originKey = startAddressText.trim().toLowerCase();
    return `${originKey}::${ids}`;
  }, [locatedSelected, startAddressText]);

  const isRouteStale = Boolean(routePlan && routePlan.signature !== currentSelectionSignature);

  const stopOrderByCompanyId = useMemo(() => {
    const record: Record<string, number> = {};
    if (routePlan) {
      routePlan.stops.forEach((stop) => {
        record[stop.company.id] = stop.stopNumber;
      });
    }
    return record;
  }, [routePlan]);

  // Points used for automatic map bounds fitting
  const mapFitPoints = useMemo(() => {
    const pts: LatLngPoint[] = locatedSelected.map((x) => x.point);
    if (routePlan?.origin.point) {
      pts.push(routePlan.origin.point);
    } else if (resolvedStartOrigin?.point && pts.length > 0) {
      pts.push(resolvedStartOrigin.point);
    }
    return pts;
  }, [locatedSelected, routePlan, resolvedStartOrigin]);

  const handleGeoResolved = useCallback((companyId: string, result: ResolvedCompanyGeo) => {
    setGeoCache((prev) => {
      const existing = prev[companyId];
      if (
        existing &&
        existing.key === result.key &&
        existing.error === result.error &&
        existing.point?.lat === result.point?.lat &&
        existing.point?.lng === result.point?.lng
      ) {
        return prev;
      }
      return { ...prev, [companyId]: result };
    });
  }, []);

  // Selection mutations
  const addCompanyToMap = useCallback((companyId: string) => {
    setSelectedMapCompanyIds((prev) => (prev.includes(companyId) ? prev : [...prev, companyId]));
    setPlannerNotice(null);
  }, []);

  const removeCompanyFromMap = useCallback((companyId: string) => {
    setSelectedMapCompanyIds((prev) => prev.filter((id) => id !== companyId));
    setActiveInfoWindow((prev) =>
      prev?.type === 'company' && prev.companyId === companyId ? null : prev
    );
    setPlannerNotice(null);
  }, []);

  const addAllFromCurrentCategory = useCallback(() => {
    setSelectedMapCompanyIds((prev) => {
      const seen: Record<string, boolean> = {};
      const merged: string[] = [];
      prev.forEach((id) => {
        if (!seen[id]) {
          seen[id] = true;
          merged.push(id);
        }
      });
      categoryCompanies.forEach((c) => {
        if (!seen[c.id]) {
          seen[c.id] = true;
          merged.push(c.id);
        }
      });
      return merged;
    });
    setPlannerNotice(null);
  }, [categoryCompanies]);

  const clearAllSelected = useCallback(() => {
    setSelectedMapCompanyIds([]);
    setActiveInfoWindow(null);
    setRoutePlan(null);
    setRouteRequest(null);
    setClearRouteSignal((s) => s + 1);
    setPlannerNotice(null);
  }, []);

  // If selected companies drop to 0, clear any drawn route automatically
  useEffect(() => {
    if (selectedMapCompanyIds.length === 0 && (routePlan || routeRequest)) {
      setRoutePlan(null);
      setRouteRequest(null);
      setClearRouteSignal((s) => s + 1);
    }
  }, [selectedMapCompanyIds.length, routePlan, routeRequest]);

  // Optimize route handler
  const handleOptimizeRoute = async () => {
    setPlannerNotice(null);

    const trimmedStart = startAddressText.trim();
    if (!trimmedStart) {
      setPlannerNotice({
        tone: 'error',
        text: 'Ingresá una dirección de inicio para calcular el recorrido.',
      });
      return;
    }

    if (selectedCompanies.length === 0) {
      setPlannerNotice({
        tone: 'error',
        text: 'Seleccioná al menos una empresa en el panel superior para planificar el recorrido.',
      });
      return;
    }

    if (isResolvingGeo) {
      setPlannerNotice({
        tone: 'info',
        text: 'Aguardá un instante mientras terminamos de ubicar las direcciones seleccionadas.',
      });
      return;
    }

    if (locatedSelected.length === 0) {
      setPlannerNotice({
        tone: 'error',
        text: 'Ninguna de las empresas seleccionadas tiene una dirección ubicable en el mapa.',
      });
      return;
    }

    // Resolve start origin if not already selected from Autocomplete or if text changed
    let originToUse: StartOrigin | null =
      resolvedStartOrigin &&
      resolvedStartOrigin.address.trim().toLowerCase() === trimmedStart.toLowerCase()
        ? resolvedStartOrigin
        : null;

    if (!originToUse) {
      setIsComputingRoute(true);
      if (apiKey && !mapsQuotaFallback && resolveManualOriginRef.current) {
        originToUse = await resolveManualOriginRef.current(trimmedStart);
      } else {
        // Fallback origin when running without live Maps API
        originToUse = {
          address: trimmedStart,
          point: TUCUMAN_CENTER,
        };
      }

      if (!originToUse) {
        setIsComputingRoute(false);
        setPlannerNotice({
          tone: 'error',
          text: 'No pudimos ubicar la dirección de inicio. Probá agregando calle, altura y localidad (ej: 25 de Mayo 350, San Miguel de Tucumán).',
        });
        return;
      }

      setResolvedStartOrigin(originToUse);
      setStartAddressText(originToUse.address);
    }

    const signature = `${originToUse.address.trim().toLowerCase()}::${[
      ...locatedSelected.map((x) => x.company.id),
    ]
      .sort()
      .join(',')}`;

    if (!apiKey || mapsQuotaFallback) {
      const fallback = buildEstimatedFallbackPlan(originToUse, locatedSelected, signature);
      setRoutePlan(fallback);
      setIsComputingRoute(false);
      return;
    }

    requestSeqRef.current += 1;
    setRouteRequest({
      requestId: requestSeqRef.current,
      origin: originToUse,
      locatedItems: locatedSelected.map((item) => ({
        company: item.company,
        point: item.point,
      })),
      signature,
    });
  };

  const handleClearRouteOnly = () => {
    setRoutePlan(null);
    setRouteRequest(null);
    setClearRouteSignal((s) => s + 1);
    setPlannerNotice(null);
    setFitTrigger((t) => t + 1);
  };

  const handleRouteComputed = useCallback((plan: RoutePlanResult) => {
    setRoutePlan(plan);
    setActiveInfoWindow(null);
  }, []);

  const handleRouteError = useCallback((message: string) => {
    setPlannerNotice({ tone: 'info', text: message });
  }, []);

  const activeCompanyMarkerData = useMemo(() => {
    if (activeInfoWindow?.type !== 'company') return null;
    return locatedSelected.find((x) => x.company.id === activeInfoWindow.companyId) ?? null;
  }, [activeInfoWindow, locatedSelected]);

  const allCategoryAdded =
    categoryCompanies.length > 0 && categoryCompanies.every((c) => Boolean(selectedIdLookup[c.id]));

  const canRenderInteractiveMap = Boolean(apiKey) && !mapsQuotaFallback;

  const content = (
    <section
      aria-label="Mapa y planificación de visitas"
      className="mt-8 pt-8 border-t border-[#E2E6EC] space-y-6"
    >
      {/* Section Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-[#101014]">
            Mapa y planificación de visitas
          </h2>
          <p className="text-xs text-neutral-500 mt-1">
            Seleccioná empresas por categoría para ubicarlas en el mapa y organizar un recorrido de
            visitas optimizado.
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs text-neutral-500">
          <span className="font-mono tabular-nums font-semibold text-[#101014]">
            {selectedCompanies.length}
          </span>
          <span>
            {selectedCompanies.length === 1
              ? 'empresa seleccionada'
              : 'empresas seleccionadas'}
          </span>
          {locatedSelected.length > 0 && (
            <>
              <span aria-hidden="true" className="text-neutral-300">
                ·
              </span>
              <button
                type="button"
                onClick={() => setFitTrigger((t) => t + 1)}
                className="text-xs font-medium text-[#101014] hover:text-[#E52421] underline underline-offset-2 transition-colors"
              >
                Reencuadrar mapa
              </button>
            </>
          )}
        </div>
      </div>

      {/* BLOCK 1: Map (Left) + Company Selection Panel (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        {/* LEFT: Map Card (8 cols ~67%) */}
        <div className="lg:col-span-8 bg-[#F5F6F8] border border-[#E2E6EC] shadow-[0_1px_2px_rgba(16,16,20,0.04)] rounded-xl overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-[#E2E6EC] bg-[#ECEFF3] flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-[#E52421]" />
              <span className="text-xs font-semibold text-[#101014]">
                Mapa de empresas seleccionadas
              </span>
            </div>

            <div className="flex items-center gap-3 text-[11px] text-neutral-600">
              {isResolvingGeo && (
                <span className="inline-flex items-center gap-1.5 text-[#101014] font-medium">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[#E52421]" />
                  Ubicando direcciones...
                </span>
              )}
              {routePlan && (
                <span className="inline-flex items-center gap-1.5 font-semibold text-[#E52421]">
                  <RouteIcon className="w-3.5 h-3.5" />
                  Recorrido activo ({routePlan.stops.length}{' '}
                  {routePlan.stops.length === 1 ? 'parada' : 'paradas'})
                </span>
              )}
            </div>
          </div>

          {/* Discrete warning for unlocated companies */}
          {unlocatedSelected.length > 0 && (
            <div className="px-4 py-2.5 bg-amber-50 border-b border-amber-200/80 flex items-start gap-2.5 text-xs text-amber-900">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="min-w-0 leading-relaxed">
                <span className="font-semibold">
                  {unlocatedSelected.length === 1
                    ? '1 empresa seleccionada no pudo ubicarse en el mapa: '
                    : `${unlocatedSelected.length} empresas seleccionadas no pudieron ubicarse en el mapa: `}
                </span>
                {unlocatedSelected.map((item, idx) => (
                  <span key={item.company.id}>
                    <strong>{item.company.nombre}</strong> ({item.reason})
                    {idx < unlocatedSelected.length - 1 ? ' · ' : '.'}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Map Viewport */}
          <div className="relative flex-1 min-h-[500px] lg:min-h-[580px] bg-white">
            {canRenderInteractiveMap ? (
              <>
                <CompanyAddressResolver
                  selectedCompanies={selectedCompanies}
                  geoCache={geoCache}
                  onResolved={handleGeoResolved}
                  onResolvingChange={setIsResolvingGeo}
                />

                <GoogleMap
                  mapId="DEMO_MAP_ID"
                  defaultCenter={TUCUMAN_CENTER}
                  defaultZoom={12}
                  gestureHandling="greedy"
                  mapTypeControl={false}
                  streetViewControl={false}
                  fullscreenControl={true}
                  internalUsageAttributionIds={ATTRIBUTION_IDS}
                  className="w-full h-full min-h-[500px] lg:min-h-[580px]"
                  onClick={() => setActiveInfoWindow(null)}
                >
                  <MapBoundsController points={mapFitPoints} fitTrigger={fitTrigger} />

                  <RouteOverlayController
                    request={routeRequest}
                    clearRouteSignal={clearRouteSignal}
                    onRouteComputed={handleRouteComputed}
                    onRouteError={handleRouteError}
                    onComputingChange={setIsComputingRoute}
                  />

                  {/* Starting Point Marker when route or start origin is active */}
                  {(routePlan?.origin || resolvedStartOrigin) && (
                    <AdvancedMarker
                      position={(routePlan?.origin ?? resolvedStartOrigin)!.point}
                      title={`Punto de inicio: ${(routePlan?.origin ?? resolvedStartOrigin)!.address}`}
                      zIndex={1000}
                      onClick={() => setActiveInfoWindow({ type: 'start' })}
                    >
                      <Pin
                        background="#101014"
                        borderColor="#000000"
                        glyphColor="#FFFFFF"
                        glyph="I"
                        scale={1.15}
                      />
                    </AdvancedMarker>
                  )}

                  {/* Selected Company Markers */}
                  {locatedSelected.map(({ company, point }) => {
                    const orderNumber = stopOrderByCompanyId[company.id];
                    const hasOrder = typeof orderNumber === 'number';
                    const colors = getStatusPinColors(company.estado);

                    return (
                      <AdvancedMarker
                        key={company.id}
                        position={point}
                        title={
                          hasOrder ? `${orderNumber}. ${company.nombre}` : company.nombre
                        }
                        zIndex={hasOrder ? 500 + (100 - orderNumber) : 100}
                        onClick={() =>
                          setActiveInfoWindow({ type: 'company', companyId: company.id })
                        }
                      >
                        {hasOrder ? (
                          <Pin
                            background="#E52421"
                            borderColor="#991B1B"
                            glyphColor="#FFFFFF"
                            glyph={String(orderNumber)}
                            scale={1.12}
                          />
                        ) : (
                          <Pin
                            background={colors.background}
                            borderColor={colors.borderColor}
                            glyphColor={colors.glyphColor}
                            scale={1.0}
                          />
                        )}
                      </AdvancedMarker>
                    );
                  })}

                  {/* Start Origin InfoWindow */}
                  {activeInfoWindow?.type === 'start' &&
                    (routePlan?.origin || resolvedStartOrigin) && (
                      <InfoWindow
                        position={(routePlan?.origin ?? resolvedStartOrigin)!.point}
                        onCloseClick={() => setActiveInfoWindow(null)}
                        pixelOffset={[0, -34]}
                      >
                        <div className="p-1 max-w-[240px] space-y-1">
                          <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[#101014]">
                            <Flag className="w-3.5 h-3.5 text-[#E52421]" />
                            Punto de inicio
                          </div>
                          <div className="text-xs text-neutral-700 leading-snug">
                            {(routePlan?.origin ?? resolvedStartOrigin)!.address}
                          </div>
                        </div>
                      </InfoWindow>
                    )}

                  {/* Company Marker InfoWindow */}
                  {activeCompanyMarkerData && (
                    <InfoWindow
                      position={activeCompanyMarkerData.point}
                      onCloseClick={() => setActiveInfoWindow(null)}
                      pixelOffset={[0, -34]}
                    >
                      <div className="p-1 min-w-[220px] max-w-[270px] space-y-2 text-[#101014]">
                        <div className="space-y-0.5">
                          <div className="flex items-center justify-between gap-2">
                            <span
                              className={`text-[10px] font-bold uppercase tracking-wider ${getStatusPinColors(activeCompanyMarkerData.company.estado).textClass}`}
                            >
                              {getPanelCategoryLabel(activeCompanyMarkerData.company.estado)}
                            </span>
                            {stopOrderByCompanyId[activeCompanyMarkerData.company.id] && (
                              <span className="text-[10px] font-bold font-mono text-white bg-[#E52421] px-1.5 py-0.5 rounded">
                                Parada #{stopOrderByCompanyId[activeCompanyMarkerData.company.id]}
                              </span>
                            )}
                          </div>
                          <h3 className="text-sm font-bold text-[#101014] leading-snug">
                            {activeCompanyMarkerData.company.nombre}
                          </h3>
                        </div>

                        <div className="space-y-1 text-xs text-neutral-600 border-t border-neutral-200 pt-1.5">
                          <div>
                            <span className="font-semibold text-neutral-700">Dirección: </span>
                            {activeCompanyMarkerData.company.direccion || 'Sin dirección'}
                          </div>
                          <div>
                            <span className="font-semibold text-neutral-700">Localidad: </span>
                            {activeCompanyMarkerData.company.localidad || 'Sin localidad'}
                          </div>
                          {activeCompanyMarkerData.company.contactoPrincipal && (
                            <div>
                              <span className="font-semibold text-neutral-700">Contacto: </span>
                              {activeCompanyMarkerData.company.contactoPrincipal}
                            </div>
                          )}
                        </div>

                        <div className="pt-1">
                          <button
                            type="button"
                            onClick={() => {
                              setActiveInfoWindow(null);
                              onViewCompanyProfile(activeCompanyMarkerData.company.id);
                            }}
                            className="w-full px-3 py-1.5 bg-[#101014] hover:bg-neutral-800 text-white text-xs font-semibold rounded-md transition-colors"
                          >
                            Ver ficha de empresa
                          </button>
                        </div>
                      </div>
                    </InfoWindow>
                  )}
                </GoogleMap>

                {/* Subtle Empty State Overlay when no companies selected */}
                {selectedCompanies.length === 0 && (
                  <div className="pointer-events-none absolute inset-x-4 bottom-4 flex justify-center">
                    <div className="bg-white/95 backdrop-blur-sm border border-[#E2E6EC] shadow-sm rounded-lg px-4 py-2.5 text-xs text-neutral-600 flex items-center gap-2">
                      <MapPin className="w-4 h-4 text-[#E52421] shrink-0" />
                      <span>
                        Seleccioná empresas desde el panel derecho para visualizarlas en el mapa.
                      </span>
                    </div>
                  </div>
                )}
              </>
            ) : (
              /* Graceful Fallback if Maps API key is unavailable or quota exceeded */
              <div className="h-full min-h-[500px] lg:min-h-[580px] p-6 flex flex-col justify-between bg-[#FAFAFB]">
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3.5 flex items-start gap-2.5 text-xs text-amber-900">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-semibold">Vista simplificada del mapa</div>
                    <p className="text-amber-800 mt-0.5">
                      Google Maps no está disponible en este momento. Podés seguir seleccionando
                      empresas, armando el recorrido estimado y abriéndolo directamente en Google
                      Maps.
                    </p>
                  </div>
                </div>

                {locatedSelected.length > 0 ? (
                  <div className="my-4 flex-1 overflow-y-auto space-y-2">
                    {locatedSelected.map(({ company }) => {
                      const orderNumber = stopOrderByCompanyId[company.id];
                      return (
                        <div
                          key={company.id}
                          className="bg-white border border-[#E2E6EC] rounded-lg px-3.5 py-2.5 flex items-center justify-between gap-3"
                        >
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-[#101014] truncate">
                              {orderNumber ? `${orderNumber}. ` : ''}
                              {company.nombre}
                            </div>
                            <div className="text-[11px] text-neutral-500 truncate">
                              {company.direccion} · {company.localidad}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => onViewCompanyProfile(company.id)}
                            className="px-2.5 py-1 bg-[#101014] text-white text-[11px] font-medium rounded-md shrink-0"
                          >
                            Ver ficha
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex-1 flex items-center justify-center text-xs text-neutral-500">
                    Seleccioná empresas desde el panel derecho para comenzar.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: Company Selection Panel (4 cols ~33%) */}
        <div className="lg:col-span-4 bg-[#F5F6F8] border border-[#E2E6EC] shadow-[0_1px_2px_rgba(16,16,20,0.04)] rounded-xl overflow-hidden flex flex-col">
          {/* Panel Header */}
          <div className="px-4 py-3 border-b border-[#E2E6EC] bg-[#ECEFF3] flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-[#101014]">
              Selección de empresas
            </span>
            <span className="font-mono text-[11px] text-neutral-500 tabular-nums">
              {categoryCompanies.length} en categoría
            </span>
          </div>

          <div className="p-4 flex flex-col gap-4 flex-1">
            {/* Category Selector (NO "Todas las empresas") */}
            <div className="space-y-1.5">
              <label
                htmlFor="map-panel-category-select"
                className="block text-[11px] font-semibold uppercase tracking-wider text-neutral-500"
              >
                Categoría de empresa
              </label>
              <select
                id="map-panel-category-select"
                value={panelCategory}
                onChange={(e) => setPanelCategory(e.target.value as CompanyStatus)}
                className="w-full px-3 py-2 bg-white border border-[#E2E6EC] rounded-lg text-xs font-medium text-[#101014] focus:outline-none focus:border-[#101014]"
              >
                {PANEL_CATEGORY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Bulk Actions */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={addAllFromCurrentCategory}
                disabled={categoryCompanies.length === 0 || allCategoryAdded}
                className="px-2.5 py-2 bg-[#101014] hover:bg-neutral-800 disabled:opacity-45 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Agregar todas</span>
              </button>
              <button
                type="button"
                onClick={clearAllSelected}
                disabled={selectedCompanies.length === 0}
                className="px-2.5 py-2 bg-white hover:border-[#101014] disabled:opacity-45 disabled:cursor-not-allowed text-[#101014] border border-[#E2E6EC] text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Quitar todas</span>
              </button>
            </div>

            {/* Companies in Selected Category */}
            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                {getPanelCategoryLabel(panelCategory)}
              </div>

              <div className="bg-white border border-[#E2E6EC] rounded-lg overflow-hidden">
                {categoryCompanies.length === 0 ? (
                  <div className="px-3 py-6 text-center text-xs text-neutral-500">
                    No hay empresas en esta categoría.
                  </div>
                ) : (
                  <div className="divide-y divide-[#E2E6EC]/70 max-h-[240px] overflow-y-auto">
                    {categoryCompanies.map((company) => {
                      const isAdded = Boolean(selectedIdLookup[company.id]);
                      const hasAddress = Boolean(company.direccion?.trim());
                      return (
                        <div
                          key={company.id}
                          className={`px-3 py-2 flex items-center justify-between gap-2 transition-colors ${
                            isAdded ? 'bg-[#F5F6F8]/80' : 'hover:bg-[#FAFAFB]'
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-semibold text-[#101014] truncate">
                              {company.nombre}
                            </div>
                            <div className="text-[11px] text-neutral-500 truncate">
                              {hasAddress ? (
                                <>
                                  {company.direccion}
                                  {company.localidad ? ` · ${company.localidad}` : ''}
                                </>
                              ) : (
                                <span className="text-amber-700">Sin dirección cargada</span>
                              )}
                            </div>
                          </div>

                          {isAdded ? (
                            <button
                              type="button"
                              onClick={() => removeCompanyFromMap(company.id)}
                              title="Quitar del mapa"
                              className="shrink-0 inline-flex items-center gap-1 px-2 py-1 bg-emerald-50 hover:bg-red-50 text-emerald-700 hover:text-[#E52421] border border-emerald-200 hover:border-red-200 rounded-md text-[11px] font-semibold transition-colors"
                            >
                              <Check className="w-3 h-3" />
                              <span>Agregada</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => addCompanyToMap(company.id)}
                              title={`Agregar ${company.nombre} al mapa`}
                              className="shrink-0 w-7 h-7 inline-flex items-center justify-center bg-white hover:bg-[#101014] text-[#101014] hover:text-white border border-[#E2E6EC] hover:border-[#101014] rounded-md transition-colors"
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Selected Companies Summary Subsection */}
            <div className="pt-3 border-t border-[#E2E6EC] space-y-2 flex-1 flex flex-col">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-[#101014]">
                  Empresas seleccionadas ({selectedCompanies.length})
                </span>
                {selectedCompanies.length > 0 && (
                  <button
                    type="button"
                    onClick={clearAllSelected}
                    className="text-[11px] font-medium text-neutral-500 hover:text-[#E52421] transition-colors"
                  >
                    Quitar todas
                  </button>
                )}
              </div>

              {selectedCompanies.length === 0 ? (
                <div className="bg-white border border-dashed border-[#E2E6EC] rounded-lg px-3 py-5 text-center text-xs text-neutral-400">
                  Aún no agregaste empresas al mapa. Podés combinar empresas de distintas
                  categorías.
                </div>
              ) : (
                <div className="bg-white border border-[#E2E6EC] rounded-lg divide-y divide-[#E2E6EC]/70 max-h-[190px] overflow-y-auto">
                  {selectedCompanies.map((company) => {
                    const orderNum = stopOrderByCompanyId[company.id];
                    const pinStyle = getStatusPinColors(company.estado);
                    const cached = geoCache[company.id];
                    const isUnlocated =
                      !company.direccion?.trim() ||
                      (cached && cached.key === buildCompanyGeoKey(company) && !cached.point);

                    return (
                      <div
                        key={company.id}
                        className="px-3 py-2 flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0 flex items-center gap-2">
                          {orderNum ? (
                            <span className="w-5 h-5 rounded-full bg-[#E52421] text-white text-[10px] font-bold font-mono flex items-center justify-center shrink-0">
                              {orderNum}
                            </span>
                          ) : (
                            <span
                              className={`w-2 h-2 rounded-full shrink-0 ${pinStyle.dotClass}`}
                              aria-hidden="true"
                            />
                          )}
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-[#101014] truncate">
                              {company.nombre}
                            </div>
                            <div className="text-[10px] text-neutral-500 truncate flex items-center gap-1">
                              <span>{getPanelCategoryLabel(company.estado)}</span>
                              {isUnlocated && (
                                <span className="text-amber-700 font-medium">· Sin ubicar</span>
                              )}
                            </div>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => removeCompanyFromMap(company.id)}
                          aria-label={`Quitar ${company.nombre}`}
                          className="p-1 text-neutral-400 hover:text-[#E52421] rounded transition-colors shrink-0"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* BLOCK 2: Planificar recorrido (Full-width clearly separated below Block 1) */}
      <div className="bg-[#F5F6F8] border border-[#E2E6EC] shadow-[0_1px_2px_rgba(16,16,20,0.04)] rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#E2E6EC] bg-[#ECEFF3] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="flex items-center gap-2">
            <Navigation className="w-4 h-4 text-[#E52421]" />
            <div>
              <h3 className="text-sm font-bold text-[#101014]">Planificar recorrido</h3>
              <p className="text-[11px] text-neutral-500">
                Calculá el orden de visitas más eficiente partiendo desde la dirección que indiques,
                usando únicamente las empresas seleccionadas en el mapa.
              </p>
            </div>
          </div>

          {routePlan && (
            <button
              type="button"
              onClick={handleClearRouteOnly}
              className="text-xs font-medium text-neutral-600 hover:text-[#101014] underline underline-offset-2 self-start sm:self-auto"
            >
              Limpiar recorrido del mapa
            </button>
          )}
        </div>

        <div className="p-5 space-y-5">
          {/* Controls Row */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-end">
            <div className="lg:col-span-6 space-y-1.5">
              <label className="block text-xs font-semibold text-[#101014]">
                Dirección de inicio
              </label>
              {canRenderInteractiveMap ? (
                <StartAddressAutocompleteInput
                  value={startAddressText}
                  onChangeText={(nextText) => {
                    setStartAddressText(nextText);
                    if (
                      resolvedStartOrigin &&
                      resolvedStartOrigin.address.trim().toLowerCase() !==
                        nextText.trim().toLowerCase()
                    ) {
                      setResolvedStartOrigin(null);
                    }
                  }}
                  onSelectOrigin={(origin) => {
                    setResolvedStartOrigin(origin);
                    setPlannerNotice(null);
                  }}
                  onResolveManualRef={resolveManualOriginRef}
                  disabled={isComputingRoute}
                />
              ) : (
                <input
                  type="text"
                  value={startAddressText}
                  onChange={(e) => {
                    setStartAddressText(e.target.value);
                    setResolvedStartOrigin(null);
                  }}
                  placeholder="Ej: 25 de Mayo 350, San Miguel de Tucumán"
                  className="w-full px-3.5 py-2.5 bg-white border border-[#E2E6EC] rounded-lg text-sm text-[#101014] placeholder:text-neutral-400 focus:outline-none focus:border-[#101014]"
                />
              )}
            </div>

            <div className="lg:col-span-6 flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={handleOptimizeRoute}
                disabled={isComputingRoute || isResolvingGeo}
                className="px-4 py-2.5 bg-[#E52421] hover:bg-[#C91D1A] disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-lg transition-colors inline-flex items-center gap-2"
              >
                {isComputingRoute ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Calculando recorrido...</span>
                  </>
                ) : routePlan ? (
                  <>
                    <RefreshCw className="w-4 h-4" />
                    <span>Recalcular recorrido</span>
                  </>
                ) : (
                  <>
                    <RouteIcon className="w-4 h-4" />
                    <span>Optimizar recorrido</span>
                  </>
                )}
              </button>

              {routePlan && routePlan.stops.length > 0 && (
                <a
                  href={buildGoogleMapsDirectionsUrl(routePlan)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2.5 bg-[#101014] hover:bg-neutral-800 text-white text-xs font-semibold rounded-lg transition-colors inline-flex items-center gap-2"
                >
                  <span>Abrir recorrido en Google Maps</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
            </div>
          </div>

          {/* Feedback / Stale Warnings */}
          {plannerNotice && (
            <div
              className={`px-3.5 py-2.5 rounded-lg border text-xs flex items-start gap-2 ${
                plannerNotice.tone === 'error'
                  ? 'bg-red-50 border-red-200 text-red-800'
                  : 'bg-amber-50 border-amber-200 text-amber-900'
              }`}
            >
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{plannerNotice.text}</span>
            </div>
          )}

          {isRouteStale && !plannerNotice && (
            <div className="px-3.5 py-2.5 rounded-lg border border-amber-200 bg-amber-50 text-amber-900 text-xs flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                <span>
                  Modificaste las empresas seleccionadas o la dirección de inicio. Hacé clic en{' '}
                  <strong>Recalcular recorrido</strong> para actualizar el orden y las distancias.
                </span>
              </div>
            </div>
          )}

          {/* Suggested Route Result */}
          {routePlan && routePlan.stops.length > 0 && (
            <div className="bg-white border border-[#E2E6EC] rounded-xl overflow-hidden">
              {/* Summary Header */}
              <div className="px-4 py-3 border-b border-[#E2E6EC] bg-[#FAFAFB] flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-[#101014]">
                    Recorrido sugerido
                  </span>
                  {routePlan.isEstimatedFallback && (
                    <span className="text-[11px] text-amber-700 font-medium">
                      (estimado)
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-4 text-xs">
                  <div className="flex items-center gap-1.5 text-neutral-600">
                    <RouteIcon className="w-3.5 h-3.5 text-[#E52421]" />
                    <span>Distancia total:</span>
                    <strong className="font-mono tabular-nums text-[#101014]">
                      {formatDistanceKm(routePlan.totalDistanceMeters)}
                    </strong>
                  </div>
                  <div className="flex items-center gap-1.5 text-neutral-600">
                    <Clock className="w-3.5 h-3.5 text-[#E52421]" />
                    <span>Tiempo total estimado:</span>
                    <strong className="font-mono tabular-nums text-[#101014]">
                      {formatDurationEs(routePlan.totalDurationSeconds)}
                    </strong>
                  </div>
                  <div className="text-neutral-500 font-mono tabular-nums">
                    {routePlan.stops.length}{' '}
                    {routePlan.stops.length === 1 ? 'parada' : 'paradas'}
                  </div>
                </div>
              </div>

              {/* Ordered Itinerary List */}
              <div className="divide-y divide-[#E2E6EC]/70">
                {/* Origin Row */}
                <div className="px-4 py-3 flex items-start gap-3 bg-[#F5F6F8]/60">
                  <span className="w-6 h-6 rounded-full bg-[#101014] text-white text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                    I
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                      Inicio
                    </div>
                    <div className="text-xs font-semibold text-[#101014]">
                      {routePlan.origin.address}
                    </div>
                  </div>
                </div>

                {/* Numbered Company Stops */}
                {routePlan.stops.map((stop) => (
                  <div
                    key={stop.company.id}
                    className="px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 hover:bg-[#FAFAFB] transition-colors"
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      <span className="w-6 h-6 rounded-full bg-[#E52421] text-white text-xs font-bold font-mono flex items-center justify-center shrink-0 mt-0.5">
                        {stop.stopNumber}
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-bold text-[#101014]">
                            {stop.company.nombre}
                          </span>
                          <span
                            className={`text-[11px] font-semibold ${getStatusPinColors(stop.company.estado).textClass}`}
                          >
                            {getPanelCategoryLabel(stop.company.estado)}
                          </span>
                        </div>
                        <div className="text-xs text-neutral-600 mt-0.5">
                          {stop.company.direccion}
                          {stop.company.localidad ? ` · ${stop.company.localidad}` : ''}
                        </div>
                        {stop.company.contactoPrincipal && (
                          <div className="text-[11px] text-neutral-500 mt-0.5">
                            Contacto: {stop.company.contactoPrincipal}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-3 pl-9 sm:pl-0 shrink-0">
                      <div className="text-right">
                        <div className="text-[10px] uppercase tracking-wider text-neutral-400">
                          {stop.stopNumber === 1 ? 'Desde inicio' : `Desde parada ${stop.stopNumber - 1}`}
                        </div>
                        <div className="text-xs font-mono tabular-nums font-semibold text-[#101014]">
                          {formatDistanceKm(stop.legDistanceMeters)} ·{' '}
                          {formatDurationEs(stop.legDurationSeconds)}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => onViewCompanyProfile(stop.company.id)}
                        className="px-2.5 py-1.5 bg-white hover:border-[#101014] border border-[#E2E6EC] rounded-lg text-[11px] font-semibold text-[#101014] transition-colors"
                      >
                        Ver ficha
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );

  if (!canRenderInteractiveMap) {
    return content;
  }

  return (
    <APIProvider
      apiKey={apiKey}
      language="es"
      region="AR"
      libraries={['marker', 'places', 'routes']}
    >
      {content}
    </APIProvider>
  );
};
