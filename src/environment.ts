/**
 * Rune Physics Library - Environment Module
 * 
 * Ported from `windpowerlib` (Python) for robust environmental physics.
 * Implements IEC 61400-12-1 standards for density correction.
 * 
 * Sources:
 * - https://github.com/wind-python/windpowerlib
 * - IEC 61400-12-1
 */

import { PowerCurvePoint } from './aep';

// --- Physical Constants (ISA Standard Atmosphere) ---
export const R_SPECIFIC = 287.058;  // J/(kg·K) - Specific gas constant for dry air
export const P_0 = 101325;          // Pa - Standard sea level pressure
export const T_0 = 288.15;          // K - Standard sea level temperature (15°C)
export const RHO_0 = 1.225;         // kg/m³ - Standard air density
export const LAPSE_RATE = 0.0065;   // K/m - Temperature lapse rate

/**
 * Calculates air temperature at hub height using a linear gradient.
 * 
 * @param tempMeas - Measured temperature (Kelvin or Celsius - input must be consistent with output exp)
 *                   NOTE: This function assumes the input is the base value to be extrapolated.
 *                   If strictly following windpowerlib, inputs should be Kelvin.
 * @param hMeas - Height of temperature measurement (m)
 * @param hHub - Target hub height (m)
 * @returns Temperature at hub height (same unit as input)
 */
export function linearGradientTemperature(tempMeas: number, hMeas: number, hHub: number): number {
    // T_hub = T_meas - L * (h_hub - h_meas)
    return tempMeas - LAPSE_RATE * (hHub - hMeas);
}

/**
 * Calculates air density at hub height using the Barometric formula (Ideal Gas Law).
 * 
 * @param tempHub - Temperature at hub height (Kelvin)
 * @param hHub - Hub height (m)
 * @returns Air density at hub height (kg/m³)
 */
export function barometricDensity(tempHub: number, hHub: number): number {
    // Pressure at height h: P(h) = P_0 * (1 - L*h / T_0) ^ (g*M / R*L) roughly approx as
    // P = P0 * exp(-g*h / R*T) for isothermal, or the polytropic form:
    // P = P0 * (1 - 0.0065 * h / 288.15) ^ 5.255

    // windpowerlib implementation uses:
    // p_hub = P_0 * (1 - 0.0065 * h_hub / T_0) ** 5.25577
    const exponent = 5.25577;
    const pressHub = P_0 * Math.pow(1 - (LAPSE_RATE * hHub) / T_0, exponent);

    // Ideal Gas Law: rho = p / (R * T)
    return pressHub / (R_SPECIFIC * tempHub);
}

/**
 * Calculates the density exponent 'm'/ 'p' for IEC 61400-12-1 correction.
 * 
 * Formula:
 * m = 1/3                           if v_std <= 7.5 m/s
 * m = 1/15 * v_std - 1/6            if 7.5 < v_std < 12.5 m/s
 * m = 2/3                           if v_std >= 12.5 m/s
 * 
 * @param vStd - Standardized wind speed (m/s)
 */
export function calculateDensityExponent(vStd: number): number {
    if (vStd <= 7.5) {
        return 1.0 / 3.0;
    } else if (vStd >= 12.5) {
        return 2.0 / 3.0;
    } else {
        return (1.0 / 15.0) * vStd - (1.0 / 6.0);
    }
}

/**
 * Applies IEC 61400-12-1 density correction to a power curve.
 * 
 * The correction adjusts the wind speed axis of the power curve (v_site) 
 * rather than the power axis, using the formula:
 * v_site = v_std * (rho_0 / rho_site)^(m(v))
 * 
 * @param powerCurve - The standard power curve (defined at rho_0 = 1.225)
 * @param rhoHub - The site-specific air density at hub height (kg/m³)
 * @returns A new PowerCurvePoint array with corrected wind speeds (and re-sorted/interpolated if necessary)
 */
export function correctPowerCurveIEC(powerCurve: PowerCurvePoint[], rhoHub: number): PowerCurvePoint[] {
    if (rhoHub <= 0) return powerCurve; // Safety check

    // 1. Calculate corrected wind speeds for each point
    // Note: The power value P stays equivalent, but occurs at a different wind speed v_site
    const correctedCurve = powerCurve.map(pt => {
        const m = calculateDensityExponent(pt.windSpeed);
        const vSite = pt.windSpeed * Math.pow(RHO_0 / rhoHub, m);

        return {
            ...pt,
            windSpeed: vSite
        };
    });

    // 2. Since v_site shifts, the curve is still valid points (v_site, P), just shifted along X-axis.
    // However, AEP calculations usually expect integer/regular bins or interpolation.
    // For now, returning the shifted points is mathematically correct for interpolation functions.

    return correctedCurve.sort((a, b) => a.windSpeed - b.windSpeed);
}
