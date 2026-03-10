import {
  calculateAirDensity,
  calculateAnnualAEP,
  generateLayout,
  generatePowerCurve,
  type WindSector
} from '../src/index';

const airDensity = calculateAirDensity(15, 120);
const powerCurve = generatePowerCurve(6000, 170, 3, 25, airDensity, 9.5, 2.1, 0.92);
const layout = generateLayout(6, 170, 6, 4, 'GRID', 15);

const sectors: WindSector[] = [
  { angle: 0, freq: 25, A: 9.3, k: 2.1 },
  { angle: 90, freq: 25, A: 8.8, k: 2.0 },
  { angle: 180, freq: 25, A: 9.0, k: 2.2 },
  { angle: 270, freq: 25, A: 9.6, k: 2.1 }
];

const result = calculateAnnualAEP(powerCurve, sectors, layout, 170, 'gch');

console.log({
  grossAepMWh: result.grossAepMWh.toFixed(1),
  netAepMWh: result.netAepMWh.toFixed(1),
  wakeLossPct: result.wakeLossPct.toFixed(2)
});
