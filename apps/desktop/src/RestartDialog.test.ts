import { assert, describe, it } from "@effect/vitest";

import * as RestartDialog from "./RestartDialog.ts";

describe("RestartDialog", () => {
  it("asks with Restart as the default button and Cancel as the cancel button", () => {
    assert.deepStrictEqual(RestartDialog.options("The board app will restart to install 1.2.0."), {
      type: "question",
      message: "The board app will restart to install 1.2.0.",
      buttons: ["Restart", "Cancel"],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
  });

  it("answers true for Restart", () => {
    assert.isTrue(RestartDialog.confirmed({ response: 0, checkboxChecked: false }));
  });

  it("answers false for Cancel, which closing the dialog also picks", () => {
    assert.isFalse(RestartDialog.confirmed({ response: 1, checkboxChecked: false }));
  });
});
