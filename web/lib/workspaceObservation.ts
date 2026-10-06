import type { WorkspaceSnapshot } from "./features/interview";

// Fit realistic whiteboards while bounding transport and observation work.
const MAX_BYTES = 96_000;
const MAX_SOURCE_CHARACTERS = 96_000;
const encoder = new TextEncoder();

function bytes(value: string): number {
  return encoder.encode(value).length;
}

function prefix(value: string, budget: number): string {
  let result = "";
  let size = 0;
  for (const character of value) {
    size += bytes(character);
    if (size > budget) break;
    result += character;
  }
  return result;
}

function boundedText(value: string, budget: number): string {
  if (bytes(value) <= budget) return value;
  const notice = "\n[WORKSPACE INCOMPLETE: middle content omitted.]\n";
  const half = Math.floor((budget - bytes(notice)) / 2);
  const tail = Array.from(prefix(Array.from(value).reverse().join(""), half))
    .reverse()
    .join("");
  return prefix(value, half) + notice + tail;
}

type Element = Record<string, unknown>;
function record(value: unknown): Element | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Element)
    : undefined;
}
function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(value * 10) / 10
    : undefined;
}
function label(value: unknown, maxBytes = 800): string | undefined {
  return typeof value === "string" ? boundedText(value, maxBytes) : undefined;
}
function binding(value: unknown): string | undefined {
  return label(record(value)?.elementId, 120);
}
function bounds(element: Element) {
  const { x, y, width, height } = element;
  if (
    [x, y, width, height].some(
      (value) => typeof value !== "number" || !Number.isFinite(value),
    )
  )
    return undefined;
  return {
    x: x as number,
    y: y as number,
    right: (x as number) + (width as number),
    bottom: (y as number) + (height as number),
  };
}

/** Textual scene data only: no image contents, files, or screen capture. */
export function describeDiagram(elements: readonly unknown[]): string {
  const live = elements
    .map(record)
    .filter((element): element is Element => !!element && !element.isDeleted);
  if (!live.length) return "Canvas is empty (all elements removed).";
  // Bound work as well as output for imported or unusually large scenes.
  const visible = live.slice(0, 200);
  const header =
    `Canvas scene: ${live.length} elements in drawing order. ` +
    "Coordinates and path points are canvas units; bounds_inside indicates geometric enclosure, not an inferred relationship.\n";
  const lines: string[] = [];
  let used = bytes(header);
  for (const element of visible) {
    const box = bounds(element);
    const inside = box
      ? visible
          .filter((container) => {
            if (
              container === element ||
              !["rectangle", "frame", "magicframe"].includes(
                String(container.type),
              ) ||
              Number(container.angle ?? 0) !== 0 ||
              Number(element.angle ?? 0) !== 0
            )
              return false;
            const outer = bounds(container);
            return (
              outer &&
              outer.x <= box.x &&
              outer.y <= box.y &&
              outer.right >= box.right &&
              outer.bottom >= box.bottom &&
              (outer.x < box.x ||
                outer.y < box.y ||
                outer.right > box.right ||
                outer.bottom > box.bottom)
            );
          })
          .map((container) => label(container.id, 120))
          .filter(Boolean)
          .slice(0, 12)
      : [];
    const points = Array.isArray(element.points) ? element.points : [];
    const sampled =
      points.length > 20
        ? Array.from(
            { length: 20 },
            (_, i) => points[Math.round((i * (points.length - 1)) / 19)],
          )
        : points;
    const line = JSON.stringify({
      id: label(element.id, 120),
      type: label(element.type, 80),
      x: number(element.x),
      y: number(element.y),
      width: number(element.width),
      height: number(element.height),
      angle:
        typeof element.angle === "number" && Number.isFinite(element.angle)
          ? Math.round(element.angle * 1000) / 1000
          : undefined,
      text: label(element.text),
      container: label(element.containerId, 120),
      frame: label(element.frameId, 120),
      groups: Array.isArray(element.groupIds)
        ? element.groupIds.slice(0, 12).map((id) => label(id, 120))
        : undefined,
      bounds_inside: inside.length ? inside : undefined,
      start_binding: binding(element.startBinding),
      end_binding: binding(element.endBinding),
      start_arrowhead: label(element.startArrowhead, 80),
      end_arrowhead: label(element.endArrowhead, 80),
      // Relative points plus the element origin preserve unbound arrows too.
      relative_points: sampled.length
        ? sampled.map((point) =>
            Array.isArray(point) ? point.slice(0, 2).map(number) : null,
          )
        : undefined,
      path_point_count: points.length || undefined,
      sampled_path: points.length > 20 || undefined,
      image_contents: element.type === "image" ? "not observed" : undefined,
    });
    // Keep complete element records and explicitly declare any omitted tail.
    if (used + bytes(line) + 100 > MAX_BYTES - 300) break;
    lines.push(line);
    used += bytes(line) + 1;
  }
  const omitted = live.length - lines.length;
  return (
    header +
    lines.join("\n") +
    (omitted
      ? `\n[WORKSPACE INCOMPLETE: ${omitted} further elements omitted from this bounded observation.]`
      : "")
  );
}

/** Latest replacement snapshot, with explicit empty states and source language. */
export function describeWorkspace(snapshot: WorkspaceSnapshot): string {
  const kind = label(snapshot.kind, 80) ?? "note";
  const language =
    snapshot.kind === "code" ? label(snapshot.data?.language, 80) : undefined;
  const header = `Workspace kind: ${kind}${language ? `; language: ${language}` : ""}. Latest snapshot replaces earlier work.\n`;
  const content =
    snapshot.kind === "canvas" && Array.isArray(snapshot.data?.elements)
      ? describeDiagram(snapshot.data.elements)
      : snapshot.content || "Workspace is empty (all content removed).";
  if (snapshot.kind === "code") {
    const characters = Array.from(content);
    if (characters.length <= MAX_SOURCE_CHARACTERS) return header + content;
    const half = MAX_SOURCE_CHARACTERS / 2;
    return (
      header +
      `[WORKSPACE INCOMPLETE: ${characters.length - MAX_SOURCE_CHARACTERS} source characters omitted from the middle. Do not infer missing definitions or defects from this partial view.]\n` +
      characters.slice(0, half).join("") +
      "\n[… omitted …]\n" +
      characters.slice(-half).join("")
    );
  }
  return header + boundedText(content, MAX_BYTES - bytes(header));
}
