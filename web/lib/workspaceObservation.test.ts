import { describe, expect, it } from "vitest";
import { describeDiagram, describeWorkspace } from "./workspaceObservation";

describe("workspace observations", () => {
  it("preserves unlabeled geometry, containment, groups, and bound and unbound paths", () => {
    const elements = [
      {
        id: "boundary",
        type: "rectangle",
        x: 0,
        y: 0,
        width: 300,
        height: 200,
        angle: 0,
      },
      {
        id: "cache",
        type: "rectangle",
        x: 20,
        y: 30,
        width: 90,
        height: 50,
        groupIds: ["tier"],
      },
      {
        id: "caption",
        type: "text",
        x: 30,
        y: 40,
        width: 60,
        height: 20,
        text: "Cache",
        containerId: "cache",
      },
      {
        id: "request",
        type: "arrow",
        x: -50,
        y: 55,
        points: [
          [0, 0],
          [70, 0],
        ],
        endBinding: { elementId: "cache" },
        endArrowhead: "arrow",
      },
      {
        id: "unbound",
        type: "arrow",
        x: 150,
        y: 150,
        points: [
          [0, 0],
          [80, -20],
        ],
        endArrowhead: "arrow",
      },
      { id: "removed", type: "ellipse", isDeleted: true },
    ];
    const observation = describeDiagram(elements);
    const records = observation
      .split("\n")
      .slice(1)
      .map((line) => JSON.parse(line));
    expect(records).toHaveLength(5);
    expect(records[1]).toMatchObject({
      id: "cache",
      x: 20,
      y: 30,
      width: 90,
      height: 50,
      groups: ["tier"],
      bounds_inside: ["boundary"],
    });
    expect(records[2]).toMatchObject({ text: "Cache", container: "cache" });
    expect(records[3]).toMatchObject({
      end_binding: "cache",
      relative_points: [
        [0, 0],
        [70, 0],
      ],
      end_arrowhead: "arrow",
    });
    expect(records[4]).toMatchObject({
      x: 150,
      y: 150,
      relative_points: [
        [0, 0],
        [80, -20],
      ],
    });
    expect(observation).not.toContain("removed");
    expect(
      describeDiagram(
        elements.map((element) =>
          element.id === "cache" ? { ...element, x: 25 } : element,
        ),
      ),
    ).not.toBe(observation);
  });

  it("uses current raw scene data, excludes files, and marks a cleared canvas", () => {
    const observation = describeWorkspace({
      kind: "canvas",
      revision: 1,
      content: "stale labels",
      data: {
        elements: [
          {
            id: "image",
            type: "image",
            x: 20,
            y: 40,
            width: 100,
            height: 100,
            fileId: "secret-file",
          },
        ],
        files: { "secret-file": { dataURL: "base64-private-image" } },
      },
    });
    expect(observation).toContain("Workspace kind: canvas");
    expect(observation).toContain('"image_contents":"not observed"');
    expect(observation).not.toContain("stale labels");
    expect(observation).not.toContain("base64");
    expect(observation).not.toContain("secret-file");
    expect(
      describeWorkspace({
        kind: "canvas",
        revision: 2,
        content: "old",
        data: { elements: [] },
      }),
    ).toContain("Canvas is empty (all elements removed)");
  });

  it("includes source language and treats code as text without executing it", () => {
    const code = 'throw new Error("never run source");';
    const snapshot = {
      kind: "code",
      revision: 1,
      content: code,
      data: { language: "typescript" },
    };
    expect(describeWorkspace(snapshot)).toContain(
      "Workspace kind: code; language: typescript",
    );
    expect(describeWorkspace(snapshot)).toContain(code);
    expect(describeWorkspace({ ...snapshot, content: "" })).toContain(
      "Workspace is empty",
    );
    expect(
      describeWorkspace({
        kind: "canvas",
        revision: 1,
        content: "Text architecture",
      }),
    ).toContain("Text architecture");
  });

  it("retains complete long source files and marks over-limit source as incomplete", () => {
    const code = describeWorkspace({
      kind: "code",
      revision: 1,
      content: "start\n" + "界".repeat(95_990) + "\nend",
      data: { language: "python" },
    });
    expect(new TextEncoder().encode(code).length).toBeLessThanOrEqual(400_000);
    expect(code).toContain("start\n");
    expect(code).not.toContain("WORKSPACE INCOMPLETE:");
    expect(code).toContain("界".repeat(95_990));
    expect(code).toMatch(/end$/);
    const partial = describeWorkspace({
      kind: "code",
      revision: 1,
      content: "x".repeat(96_001),
    });
    expect(partial).toContain(
      "WORKSPACE INCOMPLETE: 1 source characters omitted",
    );
    expect(partial).toContain("Do not infer missing definitions or defects");
  });

  it("bounds large scenes and text without silently claiming a complete view", () => {
    const realistic = describeWorkspace({
      kind: "canvas",
      revision: 1,
      content: "",
      data: {
        elements: Array.from({ length: 50 }, (_, i) => [
          {
            id: `node-${i}`,
            type: "rectangle",
            x: i * 100,
            y: 0,
            width: 50,
            height: 50,
            text: `Service ${i}: requests, processing, and storage`,
          },
          {
            id: `arrow-${i}`,
            type: "arrow",
            x: i * 100,
            y: 25,
            width: 100,
            height: 0,
            points: [
              [0, 0],
              [100, 0],
            ],
            startBinding: { elementId: `node-${i}` },
            endBinding: { elementId: `node-${(i + 1) % 50}` },
            endArrowhead: "arrow",
          },
        ]).flat(),
      },
    });
    expect(new TextEncoder().encode(realistic).length).toBeGreaterThan(11_000);
    expect(realistic).not.toContain("WORKSPACE INCOMPLETE:");
    expect(realistic).toContain('"id":"arrow-49"');
    const scene = describeWorkspace({
      kind: "canvas",
      revision: 1,
      content: "",
      data: {
        elements: Array.from({ length: 500 }, (_, i) => ({
          id: `node-${i}`,
          type: "rectangle",
          x: i * 100,
          y: 0,
          width: 50,
          height: 50,
          text: "界".repeat(250),
        })),
      },
    });
    expect(new TextEncoder().encode(scene).length).toBeLessThanOrEqual(96_000);
    expect(scene).toContain("500 elements");
    expect(scene).toContain("further elements omitted");
    expect(scene).toContain("WORKSPACE INCOMPLETE:");
    // Every included scene element remains a parseable, complete record.
    for (const line of scene.split("\n").filter((line) => line.startsWith("{")))
      expect(() => JSON.parse(line)).not.toThrow();
    const written = describeWorkspace({
      kind: "written",
      revision: 1,
      content: "界".repeat(40_000),
    });
    expect(new TextEncoder().encode(written).length).toBeLessThanOrEqual(
      96_000,
    );
    expect(written).toContain("WORKSPACE INCOMPLETE:");
  });
});
