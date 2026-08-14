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
