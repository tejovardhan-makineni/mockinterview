import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ProfileMenu } from "../components/ProfileMenu";

let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  document.body.innerHTML =
    '<div id="test-root"></div><button id="outside">Outside</button>';
  root = createRoot(document.querySelector("#test-root")!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
const trigger = () =>
  document.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!;
const menuItems = () =>
  Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
async function press(target: HTMLElement, key: string) {
  await act(async () =>
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    ),
  );
}

describe("Profile menu", () => {
  it("opens with a descriptive trigger, navigates by keyboard, and restores focus on Escape", async () => {
    await act(async () =>
      root.render(<ProfileMenu admin settingsActive onLogout={vi.fn()} />),
    );
    expect(trigger().textContent).toBe("Profile");
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    await press(trigger(), "ArrowDown");
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(
      document.querySelector('[role="menu"]')?.getAttribute("aria-labelledby"),
    ).toBe(trigger().id);
    expect(menuItems().map((item) => item.textContent)).toEqual([
      "Settings",
      "Resume review",
      "Admin portal",
      "Log out",
    ]);
    expect(menuItems()[0].getAttribute("aria-current")).toBe("page");
    expect(document.activeElement).toBe(menuItems()[0]);
    await press(menuItems()[0], "ArrowUp");
    expect(document.activeElement).toBe(menuItems()[3]);
    await press(menuItems()[3], "Home");
    expect(document.activeElement).toBe(menuItems()[0]);
    await press(menuItems()[0], "End");
    expect(document.activeElement).toBe(menuItems()[3]);
    await press(menuItems()[3], "Escape");
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("dismisses on outside interaction, focus leaving, and navigation; keeps local profiles free of account logout", async () => {
    await act(async () => root.render(<ProfileMenu />));
    await act(async () => trigger().click());
    expect(menuItems().map((item) => item.textContent)).toEqual([
      "Settings",
      "Resume review",
    ]);
    await act(async () =>
      document
        .querySelector("#outside")!
        .dispatchEvent(new Event("pointerdown", { bubbles: true })),
    );
    expect(menuItems()).toHaveLength(0);
    await act(async () => trigger().click());
    await act(async () =>
      document.querySelector<HTMLButtonElement>("#outside")!.focus(),
    );
    expect(menuItems()).toHaveLength(0);
    await act(async () => trigger().click());
    const settings = menuItems()[0];
    settings.addEventListener("click", (event) => event.preventDefault());
    expect(settings.getAttribute("href")).toBe("/settings");
    await act(async () => settings.click());
    expect(menuItems()).toHaveLength(0);
  });

  it("submits logout once and disables duplicate requests while pending", async () => {
    let resolve!: () => void;
    const logout = vi.fn(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    await act(async () => root.render(<ProfileMenu onLogout={logout} />));
    await press(trigger(), "ArrowUp");
    const logoutButton = menuItems().at(-1) as HTMLButtonElement;
    expect(document.activeElement).toBe(logoutButton);
    await act(async () => logoutButton.click());
    expect(logoutButton.disabled).toBe(true);
    expect(logoutButton.textContent).toBe("Logging out…");
    await act(async () => logoutButton.click());
    expect(logout).toHaveBeenCalledTimes(1);
    await act(async () => resolve());
    expect(menuItems()).toHaveLength(0);
  });
});
