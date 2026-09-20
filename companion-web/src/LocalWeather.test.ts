import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalWeather, parseWeather } from './LocalWeather';
const data = (code: number, day = 1) => ({ current: { weather_code: code, temperature_2m: 21.4, is_day: day } });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('local weather', () => {
  it('maps real weather codes and nighttime precipitation', () => {
    expect(parseWeather(data(0)).kind).toBe('sunny');
    expect(parseWeather(data(3)).kind).toBe('cloudy');
    expect(parseWeather(data(0, 0)).kind).toBe('night');
    expect(parseWeather(data(95, 0)).kind).toBe('rain');
    expect(parseWeather(data(85)).kind).toBe('snow');
    expect(() => parseWeather({ current: {} })).toThrow();
  });
  it('rounds location and throttles repeated GPS updates', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => data(61) });
    vi.stubGlobal('fetch', fetchMock);
    const render = vi.fn();
    const weather = new LocalWeather(render);
    const fix = { latitude: 42.36123, longitude: -71.09123, accuracy: 5, timestamp: Date.now() };
    await weather.update(fix); await weather.update(fix);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(url.searchParams.get('latitude')).toBe('42.36');
    expect(url.searchParams.get('longitude')).toBe('-71.09');
    expect(render).toHaveBeenCalledWith({ kind: 'rain', label: 'Rain nearby · 21°C' });
  });
  it('reports unavailable weather without pretending it is sunny', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const render = vi.fn();
    await new LocalWeather(render).update({ latitude: 0, longitude: 0, accuracy: 5, timestamp: Date.now() });
    expect(render).toHaveBeenCalledWith({ kind: 'unknown', label: 'Weather unavailable · cozy default' });
  });
});
