import {
  clearFlowShapes,
  getFlowShapeSides,
  registerFlowShape,
} from "@excalidraw/common";

describe("@excalidraw/common/flowShapes", () => {
  describe("getFlowShapeSides()", () => {
    afterEach(() => {
      clearFlowShapes();
    });

    it("offset === 0: connects the vertices in order for any simple polygon, convex or not", () => {
      // A concave "L" shape — offset 0 never runs the miter, so concavity
      // shouldn't matter here.
      registerFlowShape("test-l", () => ({
        points: [
          [0, 0],
          [10, 0],
          [10, 5],
          [5, 5],
          [5, 10],
          [0, 10],
        ],
      }));
      const element = {
        x: 100,
        y: 200,
        width: 10,
        height: 10,
        customData: { flowShape: { kind: "test-l", p: {} } },
      };

      const sides = getFlowShapeSides(element);

      expect(sides).not.toBeNull();
      expect(sides).toHaveLength(6);
      // First side connects the first two (absolute) vertices directly.
      expect(sides![0][0]).toEqual([100, 200]);
      expect(sides![0][1]).toEqual([110, 200]);
      // Last side closes the loop back to the first vertex.
      expect(sides![5][1]).toEqual([100, 200]);
    });

    it("offset > 0 on a convex outline: miters the offset edges outward", () => {
      // A right triangle, convex by construction.
      registerFlowShape("test-triangle", () => ({
        points: [
          [0, 0],
          [10, 0],
          [0, 10],
        ],
      }));
      const element = {
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        customData: { flowShape: { kind: "test-triangle", p: {} } },
      };

      const sides = getFlowShapeSides(element, 1);

      expect(sides).not.toBeNull();
      expect(sides).toHaveLength(3);
      // A 1px outward offset moves every vertex measurably away from the
      // triangle's centroid (~(3.33, 3.33)) compared to the unoffset case.
      const unoffset = getFlowShapeSides(element)!;
      const centroid = [10 / 3, 10 / 3];
      const distFromCentroid = (p: readonly [number, number]) =>
        Math.hypot(p[0] - centroid[0], p[1] - centroid[1]);

      for (let i = 0; i < sides!.length; i++) {
        expect(distFromCentroid(sides![i][0] as [number, number])).toBeGreaterThan(
          distFromCentroid(unoffset[i][0] as [number, number]),
        );
      }
    });

    it("offset > 0 on a concave outline: falls through to null rather than emitting a self-intersecting miter", () => {
      // A 5-point star — the classic concave case: the miter at each of the
      // 5 inner (reflex) vertices would fold back over itself.
      const outerRadius = 10;
      const innerRadius = 4;
      const starPoints: [number, number][] = [];
      for (let i = 0; i < 10; i++) {
        const radius = i % 2 === 0 ? outerRadius : innerRadius;
        const angle = (Math.PI / 5) * i - Math.PI / 2;
        starPoints.push([
          outerRadius + radius * Math.cos(angle),
          outerRadius + radius * Math.sin(angle),
        ]);
      }
      registerFlowShape("test-star", () => ({ points: starPoints }));
      const element = {
        x: 0,
        y: 0,
        width: 20,
        height: 20,
        customData: { flowShape: { kind: "test-star", p: {} } },
      };

      // Sanity check: offset 0 still returns the plain outline (not gated).
      expect(getFlowShapeSides(element)).not.toBeNull();

      // Offset > 0 is where the miter — and the gate — applies. A caller
      // (intersectRectanguloidWithLineSegment) sees null here exactly like an
      // unregistered kind, and falls back to its existing box behaviour
      // rather than a self-intersecting outline.
      expect(getFlowShapeSides(element, 1)).toBeNull();
    });
  });
});
