/**
 * Rune Physics Library - AEP Module
 * 
 * Contains logic for:
 * - Air density calculation (ISA atmosphere model)
 * - Log law wind shear (roughness-based vertical profile)
 * - Power curve generation (simplified Cp model)
 * - AEP Calculation (Sector-wise & Annual)
 * - Turbine-by-Turbine AEP Summation with wake effects
 * 
 * References:
 * - IEC 61400-12-1: Power performance measurements
 * - ISO 2533:1975: Standard Atmosphere
 * 
 * Supported Wake Models (via wake_models.ts):
 * - Jensen (Top-Hat): N.O. Jensen (1983), Risø National Laboratory
 * - Bastankhah-Gaussian: Bastankhah & Porté-Agel (2014)
 * - GCH (Gauss-Curl Hybrid): FLORIS v4 / NREL
 */

import { TurbineCoord, TurbineWithGeo } from './layout';
import { calculateWakeEffects, WakeModelType, SiteType } from './wake_models';
import { calculateTerrainSpeedUp, ElevationPoint } from './terrain';

// ============================================================================
// PHYSICAL CONSTANTS (ISA Standard Atmosphere)
// ============================================================================

/** Specific gas constant for dry air [J/(kg·K)] - ISO 2533 */
const R_SPECIFIC = 287.05;

/** Sea level standard temperature [K] - ISA: 15°C = 288.15K */
const T0 = 288.15;

/** Temperature lapse rate [K/m] - ISA troposphere: 6.5°C per 1000m */
const L = 0.0065;

/** Sea level standard pressure [Pa] - ISA: 101325 Pa */
const P0 = 101325;

// ============================================================================
// POWER CURVE MODEL CONSTANTS
// ============================================================================

/**
 * Optimal tip-speed ratio (λ) for maximum power extraction.
 * Typical range: 7-9 for modern 3-blade turbines.
 * @see calculateCp for the empirical Cp model
 */
const OPTIMAL_TIP_SPEED_RATIO = 8.1;

/**
 * Optimal blade pitch angle [degrees] for maximum Cp.
 * Zero pitch = blades at optimal angle for power extraction.
 */
const OPTIMAL_PITCH = 0;

/**
 * Pitch control gain [degrees per m/s above rated wind speed].
 * This is a simplified linear approximation of pitch controller behavior.
 * Real turbines use PI/PID controllers with more complex dynamics.
 */
const PITCH_CONTROL_GAIN = 2.5;

/**
 * Maximum wind speed for power curve calculation [m/s].
 * Standard IEC range is 0-25 m/s, extended to 30 m/s for safety margin.
 */
const MAX_WIND_SPEED = 30;

/**
 * Wind speed resolution for power curve [m/s].
 * 0.5 m/s is industry standard per IEC 61400-12-1.
 */
const WIND_SPEED_STEP = 0.5;

// ============================================================================
// TIME CONSTANTS
// ============================================================================

/** Hours per year (365 × 24) */
const HOURS_PER_YEAR = 8760;

/** Average hours per month (8760 / 12 = 730) */
const HOURS_PER_MONTH = HOURS_PER_YEAR / 12;

// ============================================================================
// SEASONALITY
// ============================================================================

/** Month names for seasonal charts */
export const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Seasonality weights for monthly production estimation.
 * These represent typical Northern Hemisphere wind patterns:
 * - Higher values in winter (stronger winds)
 * - Lower values in summer (weaker winds)
 * 
 * Values are normalized such that their average ≈ 1.0
 * Sum = 12.0, ensuring annual total is preserved.
 */
export const SEASONALITY_WEIGHTS = [
    1.25, // Jan - Winter peak
    1.15, // Feb
    1.10, // Mar
    0.95, // Apr - Spring transition
    0.85, // May
    0.75, // Jun - Summer low
    0.70, // Jul - Summer minimum
    0.75, // Aug
    0.90, // Sep - Autumn transition
    1.05, // Oct
    1.20, // Nov
    1.35  // Dec - Winter peak
];

export function resolveSeasonalityWeights(latitude?: number | null): number[] {
    if (!Number.isFinite(latitude ?? NaN)) {
        return SEASONALITY_WEIGHTS;
    }
    // Southern hemisphere seasons are approximately shifted by 6 months.
    if ((latitude as number) < 0) {
        const shift = 6;
        return SEASONALITY_WEIGHTS.map((_, idx) => SEASONALITY_WEIGHTS[(idx + shift) % SEASONALITY_WEIGHTS.length]);
    }
    return SEASONALITY_WEIGHTS;
}

// --- Air Density ---

export function calculateAirDensity(tempC: number, altitude: number): number {
    const tempK = tempC + 273.15;
    const pressure = P0 * Math.pow(1 - (L * altitude) / T0, 5.25577);
    return pressure / (R_SPECIFIC * tempK);
}

// --- Weibull Distribution ---

export function weibullPDF(v: number, k: number, A: number): number {
    if (v < 0 || A <= 0 || k <= 0) return 0;
    return (k / A) * Math.pow(v / A, k - 1) * Math.exp(-Math.pow(v / A, k));
}

// Gamma function (for mean wind speed calculation)
function gamma(z: number): number {
    const g = 7;
    const C = [
        0.99999999999980993, 676.5203681218851, -1259.1392167224028,
        771.32342877765313, -176.61502916214059, 12.507343278686905,
        -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7
    ];
    if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
    z -= 1;
    let x = C[0];
    for (let i = 1; i < g + 2; i++) x += C[i] / (z + i);
    const t = z + g + 0.5;
    return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
}

export function calculateMeanWindSpeed(A: number, k: number): number {
    return A * gamma(1 + 1 / k);
}

export function calculateAFromMean(mean: number, k: number): number {
    return mean / gamma(1 + 1 / k);
}

// --- Wind Shear (Log Law) ---

export function calculateLogLaw(vRef: number, hRef: number, hHub: number, z0: number): number {
    if (z0 <= 0 || hRef <= 0 || hHub <= 0) return 0;
    return vRef * (Math.log(hHub / z0) / Math.log(hRef / z0));
}

export function scaleWeibullAForHubHeight(
    weibullARef: number,
    referenceHeight: number,
    hubHeight: number,
    roughnessLength: number
): number {
    if (!Number.isFinite(weibullARef) || weibullARef <= 0) {
        return 0;
    }
    if (!Number.isFinite(referenceHeight) || referenceHeight <= 0 || !Number.isFinite(hubHeight) || hubHeight <= 0) {
        return weibullARef;
    }
    if (!Number.isFinite(roughnessLength) || roughnessLength <= 0 || Math.abs(referenceHeight - hubHeight) < 1e-9) {
        return weibullARef;
    }

    const adjusted = calculateLogLaw(weibullARef, referenceHeight, hubHeight, roughnessLength);
    return Number.isFinite(adjusted) && adjusted > 0 ? adjusted : weibullARef;
}

// ============================================================================
// POWER COEFFICIENT (Cp) MODEL
// ============================================================================

/**
 * Simplified Power Coefficient (Cp) Model
 * 
 * This is an EMPIRICAL curve-fit model, NOT derived from Blade Element Momentum (BEM) theory.
 * It approximates the behavior of a generic 3-blade horizontal axis wind turbine.
 * 
 * Model characteristics:
 * - Peak Cp ≈ 0.48 at λ=8.1, β=0° (below Betz limit of 0.593)
 * - Smooth degradation with pitch angle increase
 * - Valid range: λ ∈ [2, 15], β ∈ [0°, 25°]
 * 
 * The model uses a sinusoidal base with pitch-dependent corrections:
 * - Base amplitude: 0.5 (decreases with pitch)
 * - Period scaling: 18.5 (decreases with pitch)
 * - Cross-term: accounts for λ-β interaction
 * 
 * For bankable assessments, replace with manufacturer-provided Cp-λ-β surfaces.
 * 
 * @param lambda - Tip-speed ratio: λ = (ω × R) / V
 * @param beta - Blade pitch angle [degrees]
 * @returns Power coefficient Cp ∈ [0, ~0.5]
 */
export function calculateCp(lambda: number, beta: number): number {
    // Empirical coefficients (curve-fit derived)
    const BASE_AMPLITUDE = 0.5;
    const AMPLITUDE_PITCH_COEFF = 0.00167;
    const PERIOD_BASE = 18.5;
    const PERIOD_PITCH_COEFF = 0.3;
    const LAMBDA_OFFSET = 0.1;
    const CROSS_TERM_COEFF = 0.00184;
    const PITCH_REFERENCE = 2; // Reference pitch for model centering
    const LAMBDA_REFERENCE = 3; // Reference lambda for cross-term

    const pitchDelta = beta - PITCH_REFERENCE;
    const term1 = BASE_AMPLITUDE - AMPLITUDE_PITCH_COEFF * pitchDelta;

    const denominator = PERIOD_BASE - PERIOD_PITCH_COEFF * pitchDelta;
    if (denominator === 0) return 0;

    const sinArg = (Math.PI * (lambda + LAMBDA_OFFSET)) / denominator;
    const term2 = -CROSS_TERM_COEFF * (lambda - LAMBDA_REFERENCE) * pitchDelta;

    const cp = term1 * Math.sin(sinArg) + term2;
    return Math.max(0, cp);
}

// ============================================================================
// CP MODEL CONFIGURATION (Turbine-Specific Support)
// ============================================================================

/**
 * Cp model calculation modes:
 * - 'empirical': Use built-in equation (generic, fast)
 * - 'library': Derive from turbine library power curve (turbine-specific)
 * - 'custom': User-uploaded Cp-λ-β table (bankable assessments)
 */
export type CpModelMode = 'empirical' | 'library' | 'custom';

export interface CpTableEntry {
    lambda: number;
    beta: number;
    cp: number;
}

export interface DerivedCpPoint {
    windSpeed: number;
    cp: number;
}

export interface TabulatedCurvePoint {
    windSpeed: number;
    value: number;
}

export interface CpModelConfig {
    mode: CpModelMode;
    /** For 'library' mode - derived Cp-V curve from power curve */
    derivedCpCurve?: DerivedCpPoint[];
    /** For 'custom' mode - user-uploaded Cp-λ-β table */
    customTable?: CpTableEntry[];
    /** Peak Cp value (for display) */
    peakCp?: number;
    /** Wind speed at peak Cp (for display) */
    peakCpWindSpeed?: number;
}

/**
 * Derive Cp from a turbine's power curve.
 * 
 * Uses the fundamental power equation:
 *   P = 0.5 × ρ × A × V³ × Cp
 * 
 * Rearranging:
 *   Cp = P / (0.5 × ρ × A × V³)
 * 
 * This gives us a wind-speed dependent Cp curve that automatically
 * matches the selected turbine's actual performance.
 * 
 * @param powerCurve - Array of [windSpeed, powerKW] from turbine library
 * @param rotorDiameter - Rotor diameter [m]
 * @param airDensity - Air density [kg/m³] (default: ISA standard 1.225)
 * @returns Array of {windSpeed, cp} points
 */
export function deriveCpFromPowerCurve(
    powerCurve: [number, number][],
    rotorDiameter: number,
    airDensity: number = 1.225
): DerivedCpPoint[] {
    const radius = rotorDiameter / 2;
    const sweptArea = Math.PI * radius * radius;

    return powerCurve.map(([v, powerKW]) => {
        if (v <= 0 || powerKW <= 0) {
            return { windSpeed: v, cp: 0 };
        }

        const pWind = 0.5 * airDensity * sweptArea * Math.pow(v, 3);

        if (pWind <= 0) {
            return { windSpeed: v, cp: 0 };
        }

        // Convert kW to W for calculation
        const powerW = powerKW * 1000;
        let cp = powerW / pWind;

        // Cap at Betz limit (0.593) - values above indicate rated power region
        // where pitch control limits power, not aerodynamic efficiency
        cp = Math.min(cp, 0.593);

        return { windSpeed: v, cp };
    });
}

function interpolateTabulatedCurve(
    curve: TabulatedCurvePoint[],
    windSpeed: number
): number | undefined {
    if (curve.length === 0) return undefined;
    if (windSpeed <= curve[0].windSpeed) return curve[0].value;
    if (windSpeed >= curve[curve.length - 1].windSpeed) {
        return curve[curve.length - 1].value;
    }

    for (let i = 1; i < curve.length; i += 1) {
        const p0 = curve[i - 1];
        const p1 = curve[i];
        if (windSpeed <= p1.windSpeed) {
            const span = p1.windSpeed - p0.windSpeed;
            if (span <= 0) return p0.value;
            const alpha = (windSpeed - p0.windSpeed) / span;
            return p0.value + alpha * (p1.value - p0.value);
        }
    }

    return curve[curve.length - 1].value;
}

export interface TabulatedPowerCurveInput {
    powerCurve: [number, number][];
    rotorDiameter: number;
    airDensity?: number;
    cpCurve?: [number, number][];
    ctCurve?: [number, number][];
}

/**
 * Build physics-ready power-curve points from tabulated manufacturer/library data.
 * If Cp/Ct are provided, use them directly; otherwise derive Cp from power and
 * estimate Ct as a last-resort fallback.
 */
export function buildPowerCurveFromTabularData({
    powerCurve,
    rotorDiameter,
    airDensity = 1.225,
    cpCurve,
    ctCurve
}: TabulatedPowerCurveInput): PowerCurvePoint[] {
    const derivedCpByWindSpeed = new Map(
        deriveCpFromPowerCurve(powerCurve, rotorDiameter, airDensity)
            .map(point => [point.windSpeed, point.cp])
    );
    const cpPoints = (cpCurve ?? []).map(([windSpeed, value]) => ({ windSpeed, value }));
    const ctPoints = (ctCurve ?? []).map(([windSpeed, value]) => ({ windSpeed, value }));

    return powerCurve.map(([windSpeed, power]) => {
        const cpFromCurve = interpolateTabulatedCurve(cpPoints, windSpeed);
        const cp = Math.max(
            0,
            Math.min(
                0.593,
                cpFromCurve ?? derivedCpByWindSpeed.get(windSpeed) ?? 0
            )
        );
        const ctFromCurve = interpolateTabulatedCurve(ctPoints, windSpeed);
        const ct = Number.isFinite(ctFromCurve ?? NaN)
            ? Math.max(0, Math.min(0.95, ctFromCurve as number))
            : estimateCtFromCp(cp);

        return {
            windSpeed,
            power,
            cp,
            pitch: 0,
            prob: 0,
            ct
        };
    });
}

/**
 * Create CpModelConfig from a turbine library entry.
 * Automatically derives Cp curve from power curve.
 */
export function createCpConfigFromTurbine(
    powerCurve: [number, number][],
    rotorDiameter: number,
    airDensity: number = 1.225
): CpModelConfig {
    const derivedCurve = deriveCpFromPowerCurve(powerCurve, rotorDiameter, airDensity);

    // Find peak Cp
    let peakCp = 0;
    let peakCpWindSpeed = 0;

    for (const point of derivedCurve) {
        if (point.cp > peakCp) {
            peakCp = point.cp;
            peakCpWindSpeed = point.windSpeed;
        }
    }

    return {
        mode: 'library',
        derivedCpCurve: derivedCurve,
        peakCp,
        peakCpWindSpeed
    };
}

/**
 * Bilinear interpolation for custom Cp-λ-β table lookup.
 * 
 * @param table - Array of {lambda, beta, cp} entries
 * @param lambda - Tip-speed ratio to look up
 * @param beta - Pitch angle to look up [degrees]
 * @returns Interpolated Cp value
 */
export function interpolateCpFromTable(
    table: CpTableEntry[],
    lambda: number,
    beta: number
): number {
    if (!table || table.length === 0) return 0;

    // Extract unique lambda and beta values
    const lambdaValues = Array.from(new Set(table.map(e => e.lambda))).sort((a, b) => a - b);
    const betaValues = Array.from(new Set(table.map(e => e.beta))).sort((a, b) => a - b);

    // Clamp to table bounds
    const lambdaClamped = Math.max(lambdaValues[0], Math.min(lambda, lambdaValues[lambdaValues.length - 1]));
    const betaClamped = Math.max(betaValues[0], Math.min(beta, betaValues[betaValues.length - 1]));

    // Find surrounding grid points
    let l0 = lambdaValues[0], l1 = lambdaValues[0];
    for (let i = 0; i < lambdaValues.length - 1; i++) {
        if (lambdaClamped >= lambdaValues[i] && lambdaClamped <= lambdaValues[i + 1]) {
            l0 = lambdaValues[i];
            l1 = lambdaValues[i + 1];
            break;
        }
    }

    let b0 = betaValues[0], b1 = betaValues[0];
    for (let i = 0; i < betaValues.length - 1; i++) {
        if (betaClamped >= betaValues[i] && betaClamped <= betaValues[i + 1]) {
            b0 = betaValues[i];
            b1 = betaValues[i + 1];
            break;
        }
    }

    // Lookup helper
    const getCp = (l: number, b: number): number => {
        const entry = table.find(e => e.lambda === l && e.beta === b);
        return entry ? entry.cp : 0;
    };

    // Get corner values
    const cp00 = getCp(l0, b0);
    const cp01 = getCp(l0, b1);
    const cp10 = getCp(l1, b0);
    const cp11 = getCp(l1, b1);

    // Bilinear interpolation
    const tLambda = l1 !== l0 ? (lambdaClamped - l0) / (l1 - l0) : 0;
    const tBeta = b1 !== b0 ? (betaClamped - b0) / (b1 - b0) : 0;

    const cpTop = cp00 * (1 - tLambda) + cp10 * tLambda;
    const cpBottom = cp01 * (1 - tLambda) + cp11 * tLambda;

    return cpTop * (1 - tBeta) + cpBottom * tBeta;
}

/**
 * Get Cp value based on model configuration.
 * Unified interface for all Cp model modes.
 */
export function getCpValue(
    config: CpModelConfig,
    windSpeed: number,
    lambda: number,
    beta: number
): number {
    switch (config.mode) {
        case 'library':
            // Interpolate from derived Cp-V curve
            if (config.derivedCpCurve && config.derivedCpCurve.length > 0) {
                const curve = config.derivedCpCurve;

                // Find surrounding points for interpolation
                for (let i = 0; i < curve.length - 1; i++) {
                    if (windSpeed >= curve[i].windSpeed && windSpeed <= curve[i + 1].windSpeed) {
                        const t = (windSpeed - curve[i].windSpeed) /
                            (curve[i + 1].windSpeed - curve[i].windSpeed);
                        return curve[i].cp * (1 - t) + curve[i + 1].cp * t;
                    }
                }

                // Out of range - return nearest endpoint
                if (windSpeed < curve[0].windSpeed) return curve[0].cp;
                return curve[curve.length - 1].cp;
            }
            return calculateCp(lambda, beta); // Fallback

        case 'custom':
            if (config.customTable && config.customTable.length > 0) {
                return interpolateCpFromTable(config.customTable, lambda, beta);
            }
            return calculateCp(lambda, beta); // Fallback

        case 'empirical':
        default:
            return calculateCp(lambda, beta);
    }
}

// --- Power Curve Generation ---

export interface PowerCurvePoint {
    windSpeed: number;
    power: number;
    cp: number;
    pitch: number;
    prob: number;
    ct?: number;
}

function estimateCtFromCp(cp: number): number {
    if (!Number.isFinite(cp) || cp <= 0) return 0;
    const betzCp = 16 / 27;
    const cpTarget = Math.min(cp, betzCp * 0.999);
    let low = 0;
    let high = 1 / 3;

    for (let i = 0; i < 40; i += 1) {
        const mid = (low + high) / 2;
        const cpMid = 4 * mid * Math.pow(1 - mid, 2);
        if (cpMid < cpTarget) low = mid;
        else high = mid;
    }
    const induction = (low + high) / 2;
    const ct = 4 * induction * (1 - induction);
    return Math.max(0, Math.min(0.95, ct));
}

export function generatePowerCurve(
    ratedPower: number, // kW
    rotorDiameter: number,
    cutInSpeed: number,
    cutOutSpeed: number,
    airDensity: number,
    weibullA: number,
    weibullK: number,
    efficiency: number // Combined drivetrain efficiency (0-1)
): PowerCurvePoint[] {
    const rotorRadius = rotorDiameter / 2;
    const sweptArea = Math.PI * rotorRadius * rotorRadius;
    const ratedPowerWatts = ratedPower * 1000;
    const powerCurve: PowerCurvePoint[] = [];

    // Pre-calculate max Cp at optimal tip-speed ratio and pitch
    const maxCp = calculateCp(OPTIMAL_TIP_SPEED_RATIO, OPTIMAL_PITCH);

    for (let v = 0; v <= MAX_WIND_SPEED; v += WIND_SPEED_STEP) {
        let powerOutput = 0;
        let cp = 0;
        let beta = 0;

        if (v >= cutInSpeed && v <= cutOutSpeed) {
            const pWind = 0.5 * airDensity * sweptArea * Math.pow(v, 3);
            const targetElec = pWind * maxCp * efficiency;

            if (targetElec < ratedPowerWatts) {
                powerOutput = targetElec;
                cp = maxCp;
            } else {
                powerOutput = ratedPowerWatts;
                // Avoid division by zero
                if (pWind * efficiency > 0) {
                    cp = ratedPowerWatts / (pWind * efficiency);
                } else {
                    cp = 0;
                }

                // Simplified pitch control: linear pitch increase above rated wind speed
                // Real turbines use PI/PID controllers; this is a first-order approximation
                const powerCoeff = 0.5 * airDensity * sweptArea * maxCp * efficiency;
                if (powerCoeff > 0) {
                    const vRated = Math.pow(ratedPowerWatts / powerCoeff, 1 / 3);
                    beta = Math.max(0, (v - vRated) * PITCH_CONTROL_GAIN);
                }
            }
        }

        const prob = weibullPDF(v, weibullK, weibullA);
        powerCurve.push({
            windSpeed: v,
            power: powerOutput / 1000,
            cp,
            pitch: beta,
            prob,
            ct: estimateCtFromCp(cp)
        });
    }

    return powerCurve;
}

// --- AEP Calculation ---

export interface WindSector {
    angle: number;  // 0, 30, 60...
    freq: number;   // 0-100%
    A: number;      // Weibull scale
    k: number;      // Weibull shape
}

/**
 * Calculates Energy for a Single Turbine/Scneario given a specific sector Weibull
 */
export function calculateSectorEnergyForTurbine(
    powerCurve: PowerCurvePoint[],
    sector: WindSector,
    hours: number
): number {
    let sectorEnergyWh = 0;
    const { A, k } = sector;

    // Use sorted curve for integration
    const sortedCurve = [...powerCurve].sort((a, b) => a.windSpeed - b.windSpeed);

    for (let i = 0; i < sortedCurve.length; i++) {
        const point = sortedCurve[i];
        if (point.power <= 0) continue;

        // Calculate bin width dynamically
        let binWidth = 1.0;
        if (i > 0 && i < sortedCurve.length - 1) {
            const lower = point.windSpeed - sortedCurve[i - 1].windSpeed;
            const upper = sortedCurve[i + 1].windSpeed - point.windSpeed;
            binWidth = (lower + upper) / 2;
        } else if (i === 0 && sortedCurve.length > 1) {
            binWidth = sortedCurve[i + 1].windSpeed - point.windSpeed;
        } else if (i === sortedCurve.length - 1 && sortedCurve.length > 1) {
            binWidth = point.windSpeed - sortedCurve[i - 1].windSpeed;
        }

        // Recalculate prob for THIS turbine's local effective wind speed distribution
        const prob = weibullPDF(point.windSpeed, k, A);

        sectorEnergyWh += point.power * 1000 * hours * prob * binWidth;
    }

    // Return MWh directly
    return sectorEnergyWh / 1e6;
}

function getCurveBinWidth(sortedCurve: PowerCurvePoint[], idx: number): number {
    if (idx > 0 && idx < sortedCurve.length - 1) {
        const lower = sortedCurve[idx].windSpeed - sortedCurve[idx - 1].windSpeed;
        const upper = sortedCurve[idx + 1].windSpeed - sortedCurve[idx].windSpeed;
        return (lower + upper) / 2;
    }
    if (idx === 0 && sortedCurve.length > 1) {
        return sortedCurve[idx + 1].windSpeed - sortedCurve[idx].windSpeed;
    }
    if (idx === sortedCurve.length - 1 && sortedCurve.length > 1) {
        return sortedCurve[idx].windSpeed - sortedCurve[idx - 1].windSpeed;
    }
    return 1.0;
}

function interpolatePowerFromCurve(sortedCurve: PowerCurvePoint[], windSpeed: number): number {
    if (sortedCurve.length === 0) return 0;
    if (windSpeed <= sortedCurve[0].windSpeed) return Math.max(0, sortedCurve[0].power);
    if (windSpeed >= sortedCurve[sortedCurve.length - 1].windSpeed) {
        return Math.max(0, sortedCurve[sortedCurve.length - 1].power);
    }

    for (let i = 1; i < sortedCurve.length; i += 1) {
        const p0 = sortedCurve[i - 1];
        const p1 = sortedCurve[i];
        if (windSpeed <= p1.windSpeed) {
            const span = p1.windSpeed - p0.windSpeed;
            if (span <= 0) return Math.max(0, p0.power);
            const alpha = (windSpeed - p0.windSpeed) / span;
            return Math.max(0, p0.power + alpha * (p1.power - p0.power));
        }
    }
    return 0;
}

function interpolateCtFromCurve(sortedCurve: PowerCurvePoint[], windSpeed: number): number {
    if (sortedCurve.length === 0) return 0.8;
    const getCt = (point: PowerCurvePoint): number => {
        const ct = Number.isFinite(point.ct ?? NaN) ? (point.ct as number) : estimateCtFromCp(point.cp);
        return Math.max(0, Math.min(0.95, ct));
    };
    if (windSpeed <= sortedCurve[0].windSpeed) return getCt(sortedCurve[0]);
    if (windSpeed >= sortedCurve[sortedCurve.length - 1].windSpeed) return getCt(sortedCurve[sortedCurve.length - 1]);

    for (let i = 1; i < sortedCurve.length; i += 1) {
        const p0 = sortedCurve[i - 1];
        const p1 = sortedCurve[i];
        if (windSpeed <= p1.windSpeed) {
            const ct0 = getCt(p0);
            const ct1 = getCt(p1);
            const span = p1.windSpeed - p0.windSpeed;
            if (span <= 0) return ct0;
            const alpha = (windSpeed - p0.windSpeed) / span;
            return Math.max(0, Math.min(0.95, ct0 + alpha * (ct1 - ct0)));
        }
    }
    return 0.8;
}

/**
 * Legacy/Helper: Calculate Farm Totals by simple multiplication (used for Gross)
 */
export function calculateSectorAEP(
    powerCurve: PowerCurvePoint[],
    sector: WindSector,
    numberOfTurbines: number,
    hours: number = HOURS_PER_YEAR
): number {
    const oneTurbineMWh = calculateSectorEnergyForTurbine(powerCurve, sector, hours);
    return oneTurbineMWh * numberOfTurbines;
}

export function calculateAEP(
    powerCurve: PowerCurvePoint[],
    numberOfTurbines: number
): number {
    let totalEnergyWh = 0;
    const sortedCurve = [...powerCurve].sort((a, b) => a.windSpeed - b.windSpeed);

    for (let i = 0; i < sortedCurve.length; i++) {
        const point = sortedCurve[i];
        if (point.power <= 0 || point.prob <= 0) continue;

        let binWidth = 1.0;
        if (i > 0 && i < sortedCurve.length - 1) {
            const lower = point.windSpeed - sortedCurve[i - 1].windSpeed;
            const upper = sortedCurve[i + 1].windSpeed - point.windSpeed;
            binWidth = (lower + upper) / 2;
        } else if (i === 0 && sortedCurve.length > 1) {
            binWidth = sortedCurve[i + 1].windSpeed - point.windSpeed;
        } else if (i === sortedCurve.length - 1 && sortedCurve.length > 1) {
            binWidth = point.windSpeed - sortedCurve[i - 1].windSpeed;
        }

        totalEnergyWh += point.power * 1000 * HOURS_PER_YEAR * point.prob * binWidth;
    }

    return (totalEnergyWh * numberOfTurbines) / 1e6;
}

// --- Annual AEP Simulation (Rosen of Winds) ---

export interface SimulationResult {
    netAepMWh: number;
    grossAepMWh: number;
    wakeLossPct: number;
    sectorResults: { angle: number; netMWh: number; wakeLoss: number }[];
}

/**
 * IMPROVED AEP CALCULATION (Turbine-by-Turbine Summation)
 * 
 * Instead of averaging wake loss and applying to the farm,
 * we calculate the energy production of EACH turbine individually
 * based on its local wind speed (speed-up) and specific wake deficit.
 */
/**
 * Bilinear Interpolation for CFD Grid
 */
function getSpeedUpFromGrid(
    lat: number,
    lng: number,
    grid: number[][],
    bounds: { north: number, south: number, east: number, west: number }
): number {
    if (!grid || grid.length === 0 || !bounds) return 1.0;

    const rows = grid.length;
    const cols = grid[0].length;

    // Normalize coordinates to grid index
    // Note: bounds are center-of-pixel aligned or edge aligned? 
    // Usually CFD grids are edge aligned. lets assume standard bounds.
    // Row 0 is North (Top), Row N is South (Bottom)
    // Col 0 is West (Left), Col N is East (Right)

    // Calculate percent position
    const latSpan = bounds.north - bounds.south;
    const lngSpan = bounds.east - bounds.west;

    // 0..1 from Top-Left (North-West)
    // lat is inverted (Higher lat = lower row index)
    const pctY = (bounds.north - lat) / latSpan;
    const pctX = (lng - bounds.west) / lngSpan;

    if (pctY < 0 || pctY >= 1 || pctX < 0 || pctX >= 1) {
        return 1.0; // Out of bounds
    }

    const rawRow = pctY * (rows - 1);
    const rawCol = pctX * (cols - 1);

    const r0 = Math.floor(rawRow);
    const r1 = Math.min(rows - 1, r0 + 1);
    const c0 = Math.floor(rawCol);
    const c1 = Math.min(cols - 1, c0 + 1);

    const dr = rawRow - r0;
    const dc = rawCol - c0;

    // Bilinear interpolation
    const v00 = grid[r0][c0];
    const v01 = grid[r0][c1];
    const v10 = grid[r1][c0];
    const v11 = grid[r1][c1];

    const top = v00 * (1 - dc) + v01 * dc;
    const bottom = v10 * (1 - dc) + v11 * dc;

    return top * (1 - dr) + bottom * dr;
}

export function calculateAnnualAEP(
    powerCurve: PowerCurvePoint[],
    sectors: WindSector[],
    layout: TurbineCoord[],
    rotorDiameter: number,
    wakeModel: WakeModelType = 'bastankhah',
    elevationGrid?: ElevationPoint[],
    hubHeight: number = 100,
    // NEW PARAMS
    cfdSpeedup?: number[][],
    cfdBounds?: { north: number, south: number, east: number, west: number },
    cfdSpeedupBySector?: Record<number, number[][]>,
    siteType: SiteType = 'onshore',
    referenceHeight: number = 100,
    roughnessLength: number = 0.03
): SimulationResult {
    let totalNetMWh = 0;
    let totalGrossMWh = 0;
    const sectorResults: { angle: number; netMWh: number; wakeLoss: number }[] = [];

    // Validate and normalize sector frequencies
    const totalFreq = sectors.reduce((sum, s) => sum + s.freq, 0);
    if (totalFreq <= 0) {
        console.warn('[aep.ts] calculateAnnualAEP: Total sector frequency is zero or negative. Check wind rose data.');
        return { netAepMWh: 0, grossAepMWh: 0, wakeLossPct: 0, sectorResults: [] };
    }
    const normalizedFreq = totalFreq;

    // Iterate Sectors
    sectors.forEach(sector => {
        const hours = HOURS_PER_YEAR * (sector.freq / normalizedFreq);
        const hubHeightAdjustedA = scaleWeibullAForHubHeight(
            sector.A,
            referenceHeight,
            hubHeight,
            roughnessLength
        );

        let sectorGrossMWh = 0;
        let sectorNetMWh = 0;

        const sectorGrid = cfdSpeedupBySector?.[sector.angle] ?? cfdSpeedup;
        const sortedCurve = [...powerCurve].sort((a, b) => a.windSpeed - b.windSpeed);

        // Integrate explicitly by speed-bin for all wake models so Ct(ws)
        // is reflected consistently in the wake deficit calculation.
        const wakeByBin: { idx: number; windSpeed: number; binWidth: number; awakened: TurbineCoord[] }[] = [];
        sortedCurve.forEach((point, idx) => {
            if (point.power <= 0) return;
            const ctWs = interpolateCtFromCurve(sortedCurve, point.windSpeed);
            const { coords } = calculateWakeEffects(
                layout,
                sector.angle,
                rotorDiameter,
                wakeModel,
                siteType,
                ctWs
            );
            wakeByBin.push({
                idx,
                windSpeed: point.windSpeed,
                binWidth: getCurveBinWidth(sortedCurve, idx),
                awakened: coords
            });
        });

        layout.forEach((layoutTurbine, turbineIndex) => {
            let grossA = hubHeightAdjustedA;

            if (sectorGrid && cfdBounds) {
                const lat = Number.isFinite((layoutTurbine as TurbineCoord & { lat?: number }).lat)
                    ? (layoutTurbine as TurbineCoord & { lat: number }).lat
                    : layoutTurbine.y;
                const lng = Number.isFinite((layoutTurbine as TurbineCoord & { lng?: number }).lng)
                    ? (layoutTurbine as TurbineCoord & { lng: number }).lng
                    : layoutTurbine.x;
                const speedUpFactor = getSpeedUpFromGrid(lat, lng, sectorGrid, cfdBounds);
                grossA = hubHeightAdjustedA * speedUpFactor;
            } else if (elevationGrid && elevationGrid.length > 0) {
                const { speedUpFactor } = calculateTerrainSpeedUp(
                    { lat: layoutTurbine.y, lon: layoutTurbine.x },
                    elevationGrid,
                    sector.angle,
                    hubHeight
                );
                grossA = hubHeightAdjustedA * speedUpFactor;
            }

            for (const bin of wakeByBin) {
                const point = sortedCurve[bin.idx];
                const ws = bin.windSpeed;
                const prob = weibullPDF(ws, sector.k, grossA);
                if (prob <= 0) continue;

                sectorGrossMWh += (point.power * hours * prob * bin.binWidth) / 1000;

                const wakeDeficit = bin.awakened[turbineIndex].wakeLoss / 100;
                const effectiveWs = ws * (1 - wakeDeficit);
                const effectivePowerKw = interpolatePowerFromCurve(sortedCurve, effectiveWs);
                sectorNetMWh += (effectivePowerKw * hours * prob * bin.binWidth) / 1000;
            }
        });

        totalGrossMWh += sectorGrossMWh;
        totalNetMWh += sectorNetMWh;

        const sectorWakeLossPct = sectorGrossMWh > 0
            ? ((sectorGrossMWh - sectorNetMWh) / sectorGrossMWh) * 100
            : 0;

        sectorResults.push({
            angle: sector.angle,
            netMWh: sectorNetMWh,
            wakeLoss: sectorWakeLossPct
        });
    });

    const totalWakeLossPct = totalGrossMWh > 0 ? ((totalGrossMWh - totalNetMWh) / totalGrossMWh) * 100 : 0;

    return {
        netAepMWh: totalNetMWh,
        grossAepMWh: totalGrossMWh,
        wakeLossPct: totalWakeLossPct,
        sectorResults
    };
}

export function calculateAEPFromSectors(
    powerCurve: PowerCurvePoint[],
    sectors: WindSector[],
    numberOfTurbines: number
): number {
    let totalMWh = 0;
    const totalFreq = sectors.reduce((sum, s) => sum + s.freq, 0);

    sectors.forEach(sector => {
        const hours = HOURS_PER_YEAR * (sector.freq / (totalFreq || 100));
        const sectorMWh = calculateSectorAEP(powerCurve, sector, numberOfTurbines, hours);
        totalMWh += sectorMWh;
    });

    return totalMWh;
}

// --- Monthly Production ---

export interface MonthlyProduction {
    month: string;
    mwh: number;
    capacityFactor: number;
}

/**
 * Calculate monthly production distribution.
 * 
 * PRIORITY ORDER:
 * 1. If monthlyWindSpeeds provided (from /wind/monthly API) → derive weights from real data
 * 2. If not available → fall back to hemisphere-aware seasonal weights
 * 
 * The relationship between wind speed and energy is approximately cubic (P ∝ V³),
 * so monthly weights are derived as: weight[i] = (V[i] / V_mean)³
 * This captures the non-linear impact of wind speed variations on production.
 * 
 * @param netAep - Annual net energy production [MWh]
 * @param totalCapacityMW - Total installed capacity [MW]
 * @param monthlyWindSpeeds - Optional array of 12 monthly average wind speeds from API [m/s]
 * @param latitude - Optional site latitude for hemisphere-aware fallback seasonality
 */
export function calculateMonthlyProduction(
    netAep: number,
    totalCapacityMW: number,
    monthlyWindSpeeds?: number[],
    latitude?: number | null
): MonthlyProduction[] {
    let weights: number[];

    if (monthlyWindSpeeds && monthlyWindSpeeds.length === 12) {
        // Derive weights from real API data using cubic relationship (P ∝ V³)
        const meanSpeed = monthlyWindSpeeds.reduce((sum, v) => sum + v, 0) / 12;

        if (meanSpeed > 0) {
            // Raw cubic weights
            const rawWeights = monthlyWindSpeeds.map(v => Math.pow(v / meanSpeed, 3));

            // Normalize so sum = 12 (preserves annual total)
            const rawSum = rawWeights.reduce((sum, w) => sum + w, 0);
            weights = rawWeights.map(w => (w / rawSum) * 12);
        } else {
            // Edge case: all speeds are zero (shouldn't happen with real data)
            console.warn('[aep.ts] calculateMonthlyProduction: Monthly wind speeds are all zero. Using fallback.');
            weights = resolveSeasonalityWeights(latitude);
        }
    } else {
        // Fallback to hemisphere-aware seasonal weights
        weights = resolveSeasonalityWeights(latitude);
    }

    const avgMonthlyMWh = netAep / 12;

    return weights.map((weight, index) => {
        const monthlyMWh = avgMonthlyMWh * weight;
        // Capacity Factor = Actual Energy / Theoretical Maximum Energy
        // Theoretical Max = Capacity [MW] × Hours in month
        const theoreticalMaxMWh = totalCapacityMW * HOURS_PER_MONTH;
        return {
            month: MONTH_NAMES[index],
            mwh: monthlyMWh,
            capacityFactor: (monthlyMWh / theoreticalMaxMWh) * 100
        };
    });
}

/**
 * Get the dominant wind sector (highest frequency).
 * Returns the sector with maximum occurrence probability.
 */
export function getDominantSector(sectors: WindSector[]): WindSector | null {
    if (sectors.length === 0) return null;
    return sectors.reduce((max, s) => s.freq > max.freq ? s : max, sectors[0]);
}

/**
 * Get the dominant wind direction in degrees.
 * Convenience wrapper around getDominantSector.
 */
export function getDominantDirection(sectors: WindSector[]): number {
    const dominant = getDominantSector(sectors);
    return dominant ? dominant.angle : 0;
}
