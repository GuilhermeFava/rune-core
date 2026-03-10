import {
  calculateAirDensity,
  calculateAnnualAEP,
  calculateWakeEffects,
  generateLayout,
  generatePowerCurve,
  type WindSector
} from '../src/index';

describe('rune-core package boundary', () => {
  it('generates a deterministic layout and wake result without frontend imports', () => {
    const layout = generateLayout(4, 150, 6, 4, 'GRID', 0);
    expect(layout).toHaveLength(4);

    const wake = calculateWakeEffects(layout, 270, 150, 'bastankhah', 'onshore');
    expect(wake.coords).toHaveLength(4);
    expect(wake.avgWakeLoss).toBeGreaterThanOrEqual(0);
  });

  it('computes annual AEP from local package modules only', () => {
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

    expect(result.grossAepMWh).toBeGreaterThan(0);
    expect(result.netAepMWh).toBeGreaterThan(0);
    expect(result.grossAepMWh).toBeGreaterThanOrEqual(result.netAepMWh);
    expect(result.sectorResults).toHaveLength(4);
  });
});
