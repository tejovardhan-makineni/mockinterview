import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Field } from "../components/ui";
describe("form control labels", () => {
  it("associates only the concise field name with a select", () => {
    document.body.innerHTML = renderToStaticMarkup(
      <Field label="Time available">
        <select>
          <option value="8">8 minutes</option>
        </select>
      </Field>,
    );
    const label = document.querySelector("label")!;
    expect(label.textContent).toBe("Time available");
    expect(label.control).toBe(document.querySelector("select"));
  });
});
