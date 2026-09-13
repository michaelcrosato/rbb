import { z } from 'zod';
import { clamp, random } from './math';

export const WEATHER_IDS = ['clear', 'cloudy', 'fog', 'rain', 'storm', 'snow'] as const;
export type WeatherKind = (typeof WEATHER_IDS)[number];
export const WEATHER = {
  clear: { cloud: 0.12, fog: 0, rain: 0, snow: 0, wind: 0.2 },
  cloudy: { cloud: 0.75, fog: 0.15, rain: 0, snow: 0, wind: 0.45 },
  fog: { cloud: 0.55, fog: 1, rain: 0, snow: 0, wind: 0.06 },
  rain: { cloud: 0.9, fog: 0.4, rain: 0.7, snow: 0, wind: 0.6 },
  storm: { cloud: 1, fog: 0.55, rain: 1, snow: 0, wind: 1 },
  snow: { cloud: 0.8, fog: 0.5, rain: 0, snow: 1, wind: 0.3 },
} satisfies Record<WeatherKind, WeatherValues>;
export interface WeatherValues {
  cloud: number;
  fog: number;
  rain: number;
  snow: number;
  wind: number;
}
const range = (min: number, max: number) => z.number().finite().min(min).max(max);
export const tuningSchema = z
  .object({
    daySeconds: range(60, 7200),
    timeScale: range(0, 120),
    latitude: range(-65, 65),
    season: range(0, 1),
    moonSize: range(0.25, 4),
    moonBrightness: range(0, 4),
    moonPhase: range(0, 1),
    moonCycleDays: range(1, 60),
    starBrightness: range(0, 3),
    weatherAutomatic: z.boolean(),
    weatherPeriod: range(30, 3600),
    weatherTransition: range(0, 120),
    windStrength: range(0, 3),
    windDirection: range(0, 360),
    precipitation: range(0, 2),
    fogDensity: range(0.25, 3),
    waveHeight: range(0, 2),
    movementSpeed: range(0.25, 4),
    jumpHeight: range(0.25, 3),
    gravity: range(0.25, 3),
    needsRate: range(0, 10),
    damage: range(0, 5),
    gatherYield: range(1, 10).int(),
    resourceRespawn: range(0.01, 10),
    wildlifeSpeed: range(0, 4),
    wildlifeAggression: range(0, 3),
    wildlifeRespawn: range(10, 3600),
  })
  .strict();
export type Tuning = z.infer<typeof tuningSchema>;
export const DEFAULT_TUNING: Tuning = {
  daySeconds: 1200,
  timeScale: 1,
  latitude: 35,
  season: 0.25,
  moonSize: 1,
  moonBrightness: 1,
  moonPhase: 0.5,
  moonCycleDays: 28,
  starBrightness: 1,
  weatherAutomatic: true,
  weatherPeriod: 240,
  weatherTransition: 20,
  windStrength: 1,
  windDirection: 110,
  precipitation: 1,
  fogDensity: 1,
  waveHeight: 0.6,
  movementSpeed: 1,
  jumpHeight: 1,
  gravity: 1,
  needsRate: 1,
  damage: 1,
  gatherYield: 1,
  resourceRespawn: 1,
  wildlifeSpeed: 1,
  wildlifeAggression: 1,
  wildlifeRespawn: 360,
};
export const weatherValuesSchema = z
  .object({
    cloud: range(0, 1),
    fog: range(0, 1),
    rain: range(0, 1),
    snow: range(0, 1),
    wind: range(0, 1),
  })
  .strict();
export const environmentSchema = z
  .object({
    hours: range(0, 1e10),
    weather: z.enum(WEATHER_IDS),
    from: weatherValuesSchema,
    transition: range(0, 120),
    duration: range(0, 120),
    weatherAge: range(0, 3600),
    weatherSequence: range(0, 1e10).int(),
    wetness: range(0, 1),
    snowCover: range(0, 1),
  })
  .strict();
export type Environment = z.infer<typeof environmentSchema>;
export const createEnvironment = (hours = 9): Environment => ({
  hours,
  weather: 'clear',
  from: { ...WEATHER.clear },
  transition: 0,
  duration: 0,
  weatherAge: 0,
  weatherSequence: 0,
  wetness: 0,
  snowCover: 0,
});
export function weatherValues(e: Environment): WeatherValues {
  const t = e.duration ? clamp(e.transition / e.duration, 0, 1) : 1;
  const smooth = t * t * (3 - 2 * t);
  const target = WEATHER[e.weather];
  if (t === 1) return { ...target };
  return Object.fromEntries(
    Object.keys(target).map((k) => {
      const key = k as keyof WeatherValues;
      return [key, e.from[key] + (target[key] - e.from[key]) * smooth];
    }),
  ) as unknown as WeatherValues;
}
export function setWeather(e: Environment, kind: WeatherKind, duration: number): void {
  e.from = weatherValues(e);
  e.weather = kind;
  e.transition = 0;
  e.duration = duration;
  e.weatherAge = 0;
}
export function stepEnvironment(e: Environment, tuning: Tuning, hash: number, dt: number): void {
  e.hours += (dt * tuning.timeScale * 24) / tuning.daySeconds;
  e.transition = Math.min(e.duration, e.transition + dt);
  e.weatherAge = Math.min(3600, e.weatherAge + dt);
  if (tuning.weatherAutomatic && e.weatherAge >= tuning.weatherPeriod) {
    const rng = random(hash + ++e.weatherSequence * 7919);
    // Temperate island: clear and overcast dominate; snow occurs in winter only.
    const winter = Math.cos(tuning.season * Math.PI * 2) > 0.6;
    const choices: WeatherKind[] = [
      'clear',
      'clear',
      'cloudy',
      'cloudy',
      'fog',
      'rain',
      'rain',
      'storm',
      winter ? 'snow' : 'clear',
    ];
    setWeather(e, choices[Math.floor(rng() * choices.length)], tuning.weatherTransition);
  }
  const values = weatherValues(e);
  e.wetness = clamp(e.wetness + dt * (values.rain * 0.012 - (1 - values.rain) * 0.003), 0, 1);
  e.snowCover = clamp(e.snowCover + dt * (values.snow * 0.004 - (1 - values.snow) * 0.0008), 0, 1);
}

/** East is +X, south is +Z. Solar declination and latitude govern the daily arc.
 * Moon phase is the Sun–Moon elongation; full moon rises as the sun sets. */
export function celestial(e: Environment, tuning: Tuning) {
  const tau = Math.PI * 2,
    hour = e.hours % 24;
  const latitude = (tuning.latitude * Math.PI) / 180;
  const declination = (-Math.cos(tuning.season * tau) * 23.44 * Math.PI) / 180;
  const direction = (angle: number) => ({
    x: -Math.sin(angle) * Math.cos(declination),
    y:
      Math.cos(angle) * Math.cos(latitude) * Math.cos(declination) +
      Math.sin(latitude) * Math.sin(declination),
    z:
      Math.cos(angle) * Math.sin(latitude) * Math.cos(declination) -
      Math.cos(latitude) * Math.sin(declination),
  });
  const phase = (tuning.moonPhase + e.hours / 24 / tuning.moonCycleDays) % 1;
  const angle = ((hour - 12) * tau) / 24;
  const sun = direction(angle),
    moon = direction(angle - phase * tau);
  const illumination = (1 - Math.cos(phase * tau)) / 2;
  const weather = weatherValues(e);
  const daylight = clamp((sun.y + 0.12) / 0.5, 0, 1);
  const sunlight = Math.max(0, sun.y) ** 0.45 * 2.6 * (1 - weather.cloud * 0.8);
  const moonlight =
    Math.max(0, moon.y) ** 0.5 *
    illumination *
    tuning.moonSize ** 2 *
    tuning.moonBrightness *
    0.2 *
    (1 - weather.cloud * 0.9) *
    (1 - daylight);
  return {
    hour,
    phase,
    illumination,
    sun,
    moon,
    daylight,
    sunlight,
    moonlight,
    stars: (1 - daylight) * (1 - weather.cloud) * tuning.starBrightness,
    twilight: clamp(1 - Math.abs(sun.y + 0.025) / 0.22, 0, 1) * (1 - weather.cloud * 0.75),
    weather,
  };
}
