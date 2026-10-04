import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Footer } from "../components/AppShell";
import { PROJECT } from "./project";
vi.mock("./desktop", () => ({ IS_DESKTOP: true }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
describe("desktop community navigation", () => {
  it("keeps all community links visible without a hosted beta promotion", () => {
    const html = renderToStaticMarkup(<Footer />);
    for (const url of Object.values(PROJECT))
      expect(html).toContain(`href="${url}"`);
    expect(html).not.toContain('href="/beta"');
    expect(html).toContain('href="/docs"');
    expect(html).toContain('href="/privacy"');
  });
});
