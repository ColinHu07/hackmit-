import type { LocationFix } from './LocationDiscovery';
export type WeatherKind = 'sunny' | 'cloudy' | 'rain' | 'snow' | 'night' | 'unknown';
export interface Weather { kind: WeatherKind; label: string }
export function parseWeather(data: unknown): Weather {
  const current = (data as { current?: { weather_code?: number; temperature_2m?: number; is_day?: number } })?.current;
  const code = current?.weather_code;
  if (typeof code !== 'number' || !Number.isFinite(current?.temperature_2m)
    || ![0, 1].includes(current?.is_day ?? -1)) throw new Error('Weather unavailable');
  const snow = [71, 73, 75, 77, 85, 86].includes(code);
  const rain = [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99].includes(code);
  const kind: WeatherKind = snow ? 'snow' : rain ? 'rain' : current!.is_day === 0 ? 'night' : code <= 1 ? 'sunny' : 'cloudy';
  const label = { sunny: 'Sunshine', cloudy: 'Cloudy skies', rain: 'Rain nearby', snow: 'Snow nearby', night: 'Night sky', unknown: '' }[kind];
  return { kind, label: `${label} · ${Math.round(current!.temperature_2m!)}°C` };
}
/** Rounded coordinates only; no location or weather history is persisted. */
export class LocalWeather {
  private lastAttempt = -Infinity;
  private controller?: AbortController;
  constructor(private readonly render: (weather: Weather) => void) {}
  async update(fix: LocationFix): Promise<void> {
    if (Date.now() - this.lastAttempt < 600_000) return;
    this.lastAttempt = Date.now();
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const url = new URL('https://api.open-meteo.com/v1/forecast');
      url.search = new URLSearchParams({ latitude: fix.latitude.toFixed(2), longitude: fix.longitude.toFixed(2), current: 'temperature_2m,weather_code,is_day', timezone: 'auto' }).toString();
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error('Weather unavailable');
      this.render(parseWeather(await response.json()));
    } catch {
      this.render({ kind: 'unknown', label: 'Weather unavailable · cozy default' });
      this.lastAttempt = Date.now() - 540_000; // Retry on a fresh fix in one minute.
    } finally { clearTimeout(timeout); }
  }
}
