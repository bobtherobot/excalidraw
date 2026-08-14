/**
 * flow addition. A registry of flow-owned shape geometry, populated at runtime
 * by the flow app.
 *
 * A `rectangle` element carrying `customData.flowShape = { kind, p }` is drawn
 * and hit-tested as that shape instead of as a box. The geometry functions
 * themselves live in flow's own source so they can be iterated on without
 * rebuilding this package; this module is only the seam.
 *
 * Types are deliberately structural rather than importing flow's types — the
 * dependency only ever points from flow into the vendor, never back.
 */

import {
  line,
  lineSegment,
  linesIntersectAt,
  pointFrom,
  vectorFromPoint,
  vectorNormal,
  vectorNormalize,
  vectorScale,
  type GlobalPoint,
  type LineSegment,
} from "@excalidraw/math";

export interface FlowShapeGeometry {
  /** Closed outline in local coords. Hit area, and the render when `path` is absent. */
  points: readonly (readonly [number, number])[];
  /** Optional SVG path in local coords; may hold several subpaths. */
  path?: string;
}

type FlowGeometryFn = (
  width: number,
  height: number,
  params: Record<string, number>,
) => FlowShapeGeometry;

const registry = new Map<string, FlowGeometryFn>();

export const registerFlowShape = (kind: string, fn: FlowGeometryFn): void => {
  registry.set(kind, fn);
};

/** Test seam. */
export const clearFlowShapes = (): void => {
  registry.clear();
};

/**
 * Geometry for an element, or `null` when it is not a flow shape or its kind
 * was never registered. An unregistered kind falling back to `null` is what
 * makes a broken registration a plain box rather than a crash.
 */
export const getFlowShapeGeometry = (element: {
  width: number;
  height: number;
  customData?: Record<string, any> | null;
}): FlowShapeGeometry | null => {
  const flowShape = element.customData?.flowShape;
  if (!flowShape || typeof flowShape.kind !== "string") {
    return null;
  }
  const fn = registry.get(flowShape.kind);
  if (!fn) {
    return null;
  }
  const geom = fn(element.width, element.height, flowShape.p ?? {});
  return geom && geom.points.length >= 3 ? geom : null;
};

/**
 * The real outline of a flow shape's carrier rectangle, as **unrotated** line
 * segments in absolute (element.x/y-relative) coordinates — same convention
 * `deconstructRectanguloidElement`'s `sides` are returned in
 * (`packages/element/src/utils.ts`). The two hit-test call sites
 * (`distanceToRectanguloidElement` in distance.ts, and
 * `intersectRectanguloidWithLineSegment` in collision.ts) both already
 * inverse-rotate the incoming point/segment about the element's centre before
 * doing their geometry, so this deliberately does not rotate anything itself
 * — do that rotation, if any, on the caller's side, same as they already do
 * for the box case.
 *
 * Single shared site for both callers so they can't drift from each other —
 * lives here (not in `packages/element`) because both `element/src/distance.ts`
 * and `element/src/collision.ts` can import from `@excalidraw/common` without
 * inverting the package dependency the other direction.
 *
 * Returns `null` when `element` is not a flow shape (not a rectangle carrying
 * a registered `customData.flowShape`) — callers fall through to their
 * existing box behaviour in that case. NOTE: this function does not itself
 * check `element.type === "rectangle"` (the plain structural type here has no
 * `type` field) — callers must guard that themselves, same as
 * `getFlowShapeGeometry`'s existing callers already do.
 *
 * `offset` inflates the outline outward by that many px — used by arrow
 * binding (`intersectRectanguloidWithLineSegment` is also how an arrow finds
 * where to land on a shape) to test slightly past the true edge rather than
 * needing to land exactly on it, matching what `deconstructRectanguloidElement`
 * does for the box case via `curveOffsetPoints`.
 *
 * Implementation: push each edge outward along its normal by `offset`, then
 * miter consecutive offset edges by extending them to their new intersection
 * (`linesIntersectAt`, falling back to the un-mitered endpoint on the
 * degenerate parallel case). This is an exact outward offset for a **convex**
 * polygon. The only currently-registered shape (the triangle) is convex, so
 * this is exact today. A concave shape would get sharp inward spikes at its
 * reflex vertices instead of a properly rounded offset there — flagged, not
 * solved, since nothing concave exists yet to verify a fix against.
 */
export const getFlowShapeSides = (
  element: {
    x: number;
    y: number;
    width: number;
    height: number;
    customData?: Record<string, any> | null;
  },
  offset = 0,
): LineSegment<GlobalPoint>[] | null => {
  const geom = getFlowShapeGeometry(element);
  if (!geom) {
    return null;
  }

  const vertices = geom.points.map(([px, py]) =>
    pointFrom<GlobalPoint>(element.x + px, element.y + py),
  );

  if (offset === 0) {
    return vertices.map((a, i) =>
      lineSegment<GlobalPoint>(a, vertices[(i + 1) % vertices.length]),
    );
  }

  const cx = vertices.reduce((sum, v) => sum + v[0], 0) / vertices.length;
  const cy = vertices.reduce((sum, v) => sum + v[1], 0) / vertices.length;

  // Push each edge outward along its normal by `offset`.
  const offsetEdges = vertices.map((a, i) => {
    const b = vertices[(i + 1) % vertices.length];
    let n = vectorNormalize(vectorNormal(vectorFromPoint(b, a)));
    // `vectorNormal` picks one of the two perpendiculars arbitrarily; orient
    // it outward by checking that nudging the edge's midpoint along it moves
    // farther from the polygon's centroid, not closer.
    const midX = (a[0] + b[0]) / 2;
    const midY = (a[1] + b[1]) / 2;
    if (n[0] * (midX - cx) + n[1] * (midY - cy) < 0) {
      n = vectorScale(n, -1);
    }
    const shift = vectorScale(n, offset);
    return [
      pointFrom<GlobalPoint>(a[0] + shift[0], a[1] + shift[1]),
      pointFrom<GlobalPoint>(b[0] + shift[0], b[1] + shift[1]),
    ] as const;
  });

  // Miter consecutive offset edges by extending them to their new
  // intersection, so the offset outline stays a closed polygon rather than a
  // set of disjoint floating segments.
  return offsetEdges.map(([a, b], i) => {
    const [prevA, prevB] =
      offsetEdges[(i - 1 + offsetEdges.length) % offsetEdges.length];
    const [nextA, nextB] = offsetEdges[(i + 1) % offsetEdges.length];
    const start =
      linesIntersectAt(line<GlobalPoint>(prevA, prevB), line<GlobalPoint>(a, b)) ??
      a;
    const end =
      linesIntersectAt(line<GlobalPoint>(a, b), line<GlobalPoint>(nextA, nextB)) ??
      b;
    return lineSegment<GlobalPoint>(start, end);
  });
};
