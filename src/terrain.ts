/**
 * Terrain Physics Module
 * Handles orographic corrections for wind speed (Speed-up Effects)
 * Based on simplified linear flow models (WAsP BZ-model approximation)
 */

export interface TerrainEffect {
    speedUpFactor: number;  // Multiplier for wind speed (e.g. 1.05 = +5% speed)
    turbulenceIntensity: number; // Modified TI
    slope: number; // Slope in degrees
}

export interface ElevationPoint {
    lat: number;
    lon: number;
    elevation: number;
}

/**
 * Calculates the speed-up factor due to terrain orography.
 * Uses a simplified method considering local slope in the upwind direction.
 * 
 * @param location Target location (turbine)
 * @param elevationGrid Grid of elevation points around the location
 * @param windDirection Wind direction in degrees (0 = North, 90 = East)
 * @param hubHeight Turbine hub height in meters
 * @returns TerrainEffect object
 */
export function calculateTerrainSpeedUp(
    location: { lat: number, lon: number },
    elevationGrid: ElevationPoint[],
    windDirection: number,
    hubHeight: number
): TerrainEffect {
    if (!elevationGrid || elevationGrid.length < 2) {
        return { speedUpFactor: 1.0, turbulenceIntensity: 0.1, slope: 0 };
    }

    // 1. Find upwind and downwind points to calculate slope
    // We need points roughly aligned with the wind direction vector
    const rEarth = 6371000; // Earth radius meters

    // Convert direction to math angle (0 deg N -> 90 deg arithmetic)
    const theta = (90 - windDirection) * Math.PI / 180;

    // Search radius for slope calculation (approx 200m - typical scale for local speed-up)
    // In a real WAsP implementation this would integrate multiple scales
    const SEARCH_RADIUS_M = 200;

    // Find nearest neighbors in grid
    // For simplicity V1, we just take the center point and fit a plane or find gradient
    // Here we implement a simple gradient check in the wind direction

    const center = elevationGrid.reduce((prev, curr) => {
        const dPrev = getDist(location, prev);
        const dCurr = getDist(location, curr);
        return dPrev < dCurr ? prev : curr;
    });

    // Find the point strictly upwind (approx)
    const upwindLat = location.lat - (SEARCH_RADIUS_M / rEarth) * (180 / Math.PI) * Math.sin(theta);
    const upwindLon = location.lon - (SEARCH_RADIUS_M / rEarth) * (180 / Math.PI) * Math.cos(theta) / Math.cos(location.lat * Math.PI / 180);

    const upwindPoint = findNearest(upwindLat, upwindLon, elevationGrid);

    // Calculate slope
    const dist = getDist(location, upwindPoint);
    if (dist < 10) return { speedUpFactor: 1.0, turbulenceIntensity: 0.1, slope: 0 }; // Too close to same point

    const heightDiff = center.elevation - upwindPoint.elevation;
    const slope = heightDiff / dist; // Rise over run
    const slopeDegrees = Math.atan(slope) * 180 / Math.PI;

    // 2. Calculate Speed-up Factor (Simplified delta-S)
    // Standard approx: fractional speed-up ~ 2 * slope (for 2D ridge)
    // Damped by height: exp(-z/L) where L is hill half-width (approx SEARCH_RADIUS for now)

    const L = SEARCH_RADIUS_M; // Characteristic hill length scale
    const decay = Math.exp(-hubHeight / L); // Height decay

    // Tuning constant K depends on hill shape (2 for 2D ridge, 1.something for 3D hill)
    // We use conservative 1.5
    const K = 1.5;

    let fractionalSpeedUp = K * slope * decay;

    // Limit extreme values (simple linear theory breaks down for steep slopes > 0.3)
    if (fractionalSpeedUp > 0.4) fractionalSpeedUp = 0.4;
    if (fractionalSpeedUp < -0.3) fractionalSpeedUp = -0.3;

    const speedUpFactor = 1.0 + fractionalSpeedUp;

    // 3. Turbulence adjustment
    // Turbulence increases on steep slopes and wake regions (negative speedup)
    let addedTI = 0;
    if (slope > 0.1) addedTI = 0.05 * slope; // Increased TI on up-slope
    if (fractionalSpeedUp < 0) addedTI = 0.1 * Math.abs(slope); // Higher TI in wake/separation zone

    // Base TI approx 0.1 (10%)
    const finalTI = 0.1 + addedTI;

    return {
        speedUpFactor,
        turbulenceIntensity: finalTI,
        slope: slopeDegrees
    };
}

// Minimal haversine distance
function getDist(p1: { lat: number, lon: number }, p2: { lat: number, lon: number }) {
    const R = 6371e3; // metres
    const φ1 = p1.lat * Math.PI / 180;
    const φ2 = p2.lat * Math.PI / 180;
    const Δφ = (p2.lat - p1.lat) * Math.PI / 180;
    const Δλ = (p2.lon - p1.lon) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) *
        Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
}

function findNearest(lat: number, lon: number, grid: ElevationPoint[]): ElevationPoint {
    let best = grid[0];
    let minD = Infinity;

    for (const p of grid) {
        const d = (p.lat - lat) ** 2 + (p.lon - lon) ** 2; // Euclidian enough for check
        if (d < minD) {
            minD = d;
            best = p;
        }
    }
    return best;
}

// --- ROUGHNESS MODULE (Restored) ---

export const ESA_WORLD_COVER_CLASSES = {
    TREE_COVER: { id: 10, name: 'Tree cover', z0: 0.5, color: '#006400' },
    SHRUBLAND: { id: 20, name: 'Shrubland', z0: 0.05, color: '#ffbb22' },
    GRASSLAND: { id: 30, name: 'Grassland', z0: 0.03, color: '#ffff4c' },
    CROPLAND: { id: 40, name: 'Cropland', z0: 0.1, color: '#f096ff' },
    BUILT_UP: { id: 50, name: 'Built-up', z0: 0.8, color: '#fa0000' },
    BARE_SPARSE: { id: 60, name: 'Bare / sparse', z0: 0.005, color: '#b4b4b4' },
    PERMANENT_WATER: { id: 80, name: 'Water', z0: 0.0002, color: '#000080' },
    HERBACEOUS_WETLAND: { id: 90, name: 'Herbaceous wetland', z0: 0.1, color: '#0096a0' },
    MANGROVES: { id: 95, name: 'Mangroves', z0: 0.5, color: '#00cf75' },
    MOSS_LICHEN: { id: 100, name: 'Moss / lichen', z0: 0.01, color: '#fae6a0' }
};

export function getRoughnessFromClass(val: number): number {
    const found = Object.values(ESA_WORLD_COVER_CLASSES).find(c => c.id === val);
    return found?.z0 || 0.03;
}

export function calculateRoughnessCorrection(currentZ0: number, referenceZ0: number = 0.03, z: number = 100): number {
    if (z <= 0) return 1.0;
    // Log law correction factor for different roughness
    // U2 = U1 * (ln(z/z0_2) / ln(z/z0_1))
    if (z <= 0) return 1.0;
    return Math.log(z / currentZ0) / Math.log(z / referenceZ0);
}

/**
 * Placeholder for raster-backed dominant land-cover analysis.
 *
 * The hosted Rune product wires this capability to GIS tooling and raster stats
 * libraries. The open-core preview keeps the roughness mapping constants but does
 * not ship the raster-processing wrapper yet.
 */
export async function getDominantClass(_geoRaster: unknown, _polygonPoints?: { lat: number, lng: number }[]): Promise<{ className: string; z0: number } | null> {
    return null;
}
