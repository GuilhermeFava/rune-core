/**
 * AeroTerra Physics Library - Layout Module
 * 
 * Contains logic for:
 * - Turbine coordinate interfaces
 * - Layout generation (Grid, Line, Staggered)
 * - Coordinate transformations (LatLng <-> Meters)
 * - Polygon constraints
 */

export interface TurbineCoord {
    id: number;
    x: number;
    y: number;
    wakeLoss?: number;
    name?: string;
    z0?: number;        // Local roughness length
    localSpeed?: number; // Local wind speed including roughness correction
}

export interface TurbineWithGeo extends TurbineCoord {
    lat: number;
    lng: number;
}

interface ProjectedPoint {
    x: number;
    y: number;
}

// --- Polygon Geometry Helpers ---

// Point in polygon algorithm (Ray casting)
function isPointInPolygon(point: { x: number, y: number }, vs: { x: number, y: number }[]): boolean {
    let x = point.x, y = point.y;
    let inside = false;
    for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
        let xi = vs[i].x, yi = vs[i].y;
        let xj = vs[j].x, yj = vs[j].y;
        let intersect = ((yi > y) !== (yj > y))
            && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

// Convert LatLng to Meters (Local approximation around center)
function latLngToMeters(lat: number, lng: number, centerLat: number, centerLng: number): { x: number, y: number } {
    const R = 6378137; // Earth Radius
    const dLat = (lat - centerLat) * Math.PI / 180;
    const dLng = (lng - centerLng) * Math.PI / 180;
    const x = dLng * Math.cos(centerLat * Math.PI / 180) * R;
    const y = dLat * R;
    return { x, y };
}

// Convert Meters back to LatLng
function metersToLatLng(x: number, y: number, centerLat: number, centerLng: number): { lat: number, lng: number } {
    const R = 6378137;
    const dLat = y / R;
    const dLng = x / (R * Math.cos(centerLat * Math.PI / 180));
    return {
        lat: centerLat + (dLat * 180 / Math.PI),
        lng: centerLng + (dLng * 180 / Math.PI)
    };
}

function projectGeoPolygonToMeters(polygonLatLngs: { lat: number; lng: number }[]): ProjectedPoint[] {
    if (polygonLatLngs.length === 0) return [];
    const centerLat = polygonLatLngs.reduce((sum, p) => sum + p.lat, 0) / polygonLatLngs.length;
    const centerLng = polygonLatLngs.reduce((sum, p) => sum + p.lng, 0) / polygonLatLngs.length;
    return polygonLatLngs.map(point => latLngToMeters(point.lat, point.lng, centerLat, centerLng));
}

function calculatePlanarPolygonArea(points: ProjectedPoint[]): number {
    if (points.length < 3) return 0;
    let area = 0;
    for (let i = 0; i < points.length; i += 1) {
        const j = (i + 1) % points.length;
        area += points[i].x * points[j].y;
        area -= points[j].x * points[i].y;
    }
    return Math.abs(area / 2);
}

function projectLayoutToMeters(
    layout: Array<TurbineCoord & { lat?: number; lng?: number }>
): ProjectedPoint[] {
    if (layout.every(turbine => Number.isFinite(turbine.x) && Number.isFinite(turbine.y))) {
        return layout.map(turbine => ({ x: turbine.x, y: turbine.y }));
    }
    if (!layout.every(turbine => Number.isFinite(turbine.lat) && Number.isFinite(turbine.lng))) {
        return [];
    }
    const avgLat = layout.reduce((sum, turbine) => sum + (turbine.lat ?? 0), 0) / layout.length;
    const avgLng = layout.reduce((sum, turbine) => sum + (turbine.lng ?? 0), 0) / layout.length;
    return layout.map(turbine => latLngToMeters(
        turbine.lat as number,
        turbine.lng as number,
        avgLat,
        avgLng
    ));
}

// Rotate a point around origin
function rotatePoint(x: number, y: number, angleRad: number): { x: number, y: number } {
    return {
        x: x * Math.cos(angleRad) - y * Math.sin(angleRad),
        y: x * Math.sin(angleRad) + y * Math.cos(angleRad)
    };
}

function distancePointToSegment(
    point: { x: number; y: number },
    a: { x: number; y: number },
    b: { x: number; y: number }
): number {
    const abX = b.x - a.x;
    const abY = b.y - a.y;
    const apX = point.x - a.x;
    const apY = point.y - a.y;
    const abLenSq = abX * abX + abY * abY;
    if (abLenSq === 0) {
        const dx = point.x - a.x;
        const dy = point.y - a.y;
        return Math.sqrt(dx * dx + dy * dy);
    }
    const t = Math.max(0, Math.min(1, (apX * abX + apY * abY) / abLenSq));
    const closestX = a.x + abX * t;
    const closestY = a.y + abY * t;
    const dx = point.x - closestX;
    const dy = point.y - closestY;
    return Math.sqrt(dx * dx + dy * dy);
}

function minDistanceToPolygonEdges(
    point: { x: number; y: number },
    polygon: { x: number; y: number }[]
): number {
    if (polygon.length < 2) return 0;
    let minDist = Infinity;
    for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i];
        const b = polygon[(i + 1) % polygon.length];
        const dist = distancePointToSegment(point, a, b);
        if (dist < minDist) minDist = dist;
    }
    return minDist;
}

export function calculatePolygonAreaSqMeters(polygonLatLngs: { lat: number; lng: number }[]): number {
    return calculatePlanarPolygonArea(projectGeoPolygonToMeters(polygonLatLngs));
}

export function estimateCollectionLengthKm(
    layout: Array<TurbineCoord & { lat?: number; lng?: number }>
): number {
    if (layout.length <= 1) return 0;

    const points = projectLayoutToMeters(layout);
    if (points.length !== layout.length) return 0;

    const visited = new Array(points.length).fill(false);
    const bestDistance = new Array(points.length).fill(Number.POSITIVE_INFINITY);
    bestDistance[0] = 0;

    let totalMeters = 0;
    for (let step = 0; step < points.length; step += 1) {
        let nextIndex = -1;
        let nextDistance = Number.POSITIVE_INFINITY;

        for (let i = 0; i < points.length; i += 1) {
            if (!visited[i] && bestDistance[i] < nextDistance) {
                nextIndex = i;
                nextDistance = bestDistance[i];
            }
        }

        if (nextIndex === -1) {
            return totalMeters / 1000;
        }

        visited[nextIndex] = true;
        totalMeters += nextDistance;

        for (let i = 0; i < points.length; i += 1) {
            if (visited[i]) continue;
            const dx = points[nextIndex].x - points[i].x;
            const dy = points[nextIndex].y - points[i].y;
            const distance = Math.sqrt((dx * dx) + (dy * dy));
            if (distance < bestDistance[i]) {
                bestDistance[i] = distance;
            }
        }
    }

    return totalMeters / 1000;
}

export function generateLayout(
    numberOfTurbines: number,
    rotorDiameter: number,
    rowSpacing: number,
    colSpacing: number,
    layoutMode: 'LINE' | 'GRID' | 'STAGGERED',
    farmOrientation: number
): TurbineCoord[] {
    const coords: TurbineCoord[] = [];
    const n = numberOfTurbines;
    const rd = rotorDiameter;
    const rowDist = rowSpacing * rd;
    const colDist = colSpacing * rd;

    if (layoutMode === 'LINE') {
        const totalLen = (n - 1) * rowDist;
        const startX = -totalLen / 2;
        for (let i = 0; i < n; i++) {
            coords.push({ id: i, x: startX + i * rowDist, y: 0, wakeLoss: 0 });
        }
    } else if (layoutMode === 'GRID' || layoutMode === 'STAGGERED') {
        const cols = Math.ceil(Math.sqrt(n));
        const rows = Math.ceil(n / cols);
        const offsetX = ((cols - 1) * colDist) / 2;
        const offsetY = ((rows - 1) * rowDist) / 2;

        let count = 0;
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                if (count >= n) break;
                let cx = c * colDist - offsetX;
                let cy = r * rowDist - offsetY;

                if (layoutMode === 'STAGGERED' && r % 2 !== 0) {
                    cx += colDist / 2;
                }

                coords.push({ id: count, x: cx, y: cy, wakeLoss: 0 });
                count++;
            }
        }
    }

    // Rotate based on farm orientation
    const rad = (farmOrientation * Math.PI) / 180;
    return coords.map(t => ({
        ...t,
        x: t.x * Math.cos(rad) - t.y * Math.sin(rad),
        y: t.x * Math.sin(rad) + t.y * Math.cos(rad)
    }));
}

/**
 * Generate turbine layout constrained to a polygon boundary.
 * Returns turbines positioned inside the polygon with proper spacing.
 */
export function generateLayoutInPolygon(
    polygonLatLngs: { lat: number, lng: number }[],
    rotorDiameter: number,
    rowSpacing: number,   // in rotor diameters (e.g., 5 = 5D)
    colSpacing: number,   // in rotor diameters
    farmOrientation: number = 0,  // degrees
    maxTurbines: number = 100,     // safety limit
    bufferDistanceMeters: number = 0
): TurbineWithGeo[] {
    if (polygonLatLngs.length < 3) return [];

    // 1. Calculate polygon centroid
    const centerLat = polygonLatLngs.reduce((sum, p) => sum + p.lat, 0) / polygonLatLngs.length;
    const centerLng = polygonLatLngs.reduce((sum, p) => sum + p.lng, 0) / polygonLatLngs.length;

    // 2. Project polygon to meters
    const polyMeters = polygonLatLngs.map(p => latLngToMeters(p.lat, p.lng, centerLat, centerLng));

    // 3. To create a professional grid aligned with 'farmOrientation':
    //    We rotate the polygon by -farmOrientation, create an axis-aligned grid,
    //    then rotate everything back by +farmOrientation.
    const gridAngleRad = (farmOrientation * Math.PI) / 180;

    // Rotate polygon points to align with grid axes
    const rotatedPoly = polyMeters.map(p => rotatePoint(p.x, p.y, -gridAngleRad));

    // 4. Calculate bounding box of the ROTATED polygon
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    rotatedPoly.forEach(p => {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
    });

    // 5. Layout parameters
    const rd = rotorDiameter;
    const rowDist = rowSpacing * rd;  // Y spacing (Frontal)
    const colDist = colSpacing * rd;  // X spacing (Lateral)

    // Calculate grid offsets to center the pattern roughly
    const gridWidth = maxX - minX;
    const gridHeight = maxY - minY;
    const offsetX = (gridWidth % colDist) / 2;
    const offsetY = (gridHeight % rowDist) / 2;

    const turbines: TurbineWithGeo[] = [];
    let id = 0;

    // 6. Generate axis-aligned grid on the rotated space
    for (let row = minY + offsetY; row <= maxY; row += rowDist) {
        for (let col = minX + offsetX; col <= maxX; col += colDist) {
            if (turbines.length >= maxTurbines) break;

            const point = { x: col, y: row };

            // Check if point is inside the rotated polygon
            if (isPointInPolygon(point, rotatedPoly)) {
                if (bufferDistanceMeters > 0) {
                    const distanceToEdge = minDistanceToPolygonEdges(point, rotatedPoly);
                    if (distanceToEdge < bufferDistanceMeters) {
                        continue;
                    }
                }

                // Convert back to original orientation (rotate by +gridAngleRad)
                const originalMeters = rotatePoint(point.x, point.y, gridAngleRad);

                // Convert back to lat/lng
                const geoPos = metersToLatLng(originalMeters.x, originalMeters.y, centerLat, centerLng);

                turbines.push({
                    id: id++,
                    x: originalMeters.x,
                    y: originalMeters.y,
                    wakeLoss: 0,
                    lat: geoPos.lat,
                    lng: geoPos.lng
                });
            }
        }
        if (turbines.length >= maxTurbines) break;
    }

    return turbines;
}

/**
 * Generate turbine layout distributed across multiple polygons (zones).
 * Distributes turbines proportionally by zone area.
 */
export function generateLayoutInPolygons(
    polygons: { lat: number, lng: number }[][],
    rotorDiameter: number,
    rowSpacing: number,
    colSpacing: number,
    farmOrientation: number = 0,
    maxTurbines: number = 100,
    bufferDistanceMeters: number = 0
): TurbineWithGeo[] {
    if (polygons.length === 0) return [];
    if (polygons.length === 1) {
        return generateLayoutInPolygon(
            polygons[0],
            rotorDiameter,
            rowSpacing,
            colSpacing,
            farmOrientation,
            maxTurbines,
            bufferDistanceMeters
        );
    }

    const zoneLayouts = polygons.map(polygon => (
        polygon.length < 3
            ? []
            : generateLayoutInPolygon(
                polygon,
                rotorDiameter,
                rowSpacing,
                colSpacing,
                farmOrientation,
                maxTurbines,
                bufferDistanceMeters
            )
    ));
    const capacities = zoneLayouts.map(layout => layout.length);
    const totalCapacity = capacities.reduce((sum, value) => sum + value, 0);
    if (totalCapacity === 0) return [];

    const targetTotal = Math.min(maxTurbines, totalCapacity);
    const rawAreas = polygons.map(polygon => calculatePolygonAreaSqMeters(polygon));
    const areaWeightSeed = rawAreas.some(area => area > 0) ? rawAreas : capacities.map(capacity => (capacity > 0 ? 1 : 0));
    const totalWeight = areaWeightSeed.reduce((sum, value) => sum + value, 0) || 1;

    const allocations = capacities.map(() => 0);
    const remainders: Array<{ index: number; remainder: number; weight: number }> = [];

    for (let i = 0; i < polygons.length; i += 1) {
        if (capacities[i] <= 0) continue;
        const ideal = (areaWeightSeed[i] / totalWeight) * targetTotal;
        const allocated = Math.min(capacities[i], Math.floor(ideal));
        allocations[i] = allocated;
        remainders.push({
            index: i,
            remainder: ideal - allocated,
            weight: areaWeightSeed[i]
        });
    }

    let assigned = allocations.reduce((sum, value) => sum + value, 0);
    remainders.sort((a, b) => {
        if (b.remainder !== a.remainder) return b.remainder - a.remainder;
        return b.weight - a.weight;
    });

    while (assigned < targetTotal) {
        let allocatedAny = false;
        for (const entry of remainders) {
            if (assigned >= targetTotal) break;
            if (allocations[entry.index] >= capacities[entry.index]) continue;
            allocations[entry.index] += 1;
            assigned += 1;
            allocatedAny = true;
        }
        if (!allocatedAny) break;
    }

    const allTurbines: TurbineWithGeo[] = [];
    let globalId = 0;
    for (let i = 0; i < zoneLayouts.length; i += 1) {
        const selected = zoneLayouts[i].slice(0, allocations[i]);
        selected.forEach(turbine => {
            allTurbines.push({
                ...turbine,
                id: globalId++
            });
        });
    }

    return allTurbines;
}
