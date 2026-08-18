import { describe, expect, it } from "vitest";

import { Redactor } from "../../src/security/redactor.js";

describe("Redactor", () => {
  it("removes configured secret literals from nested event payloads", () => {
    const redactor = new Redactor(["dev-secret-123", "postgres://user:pass@example.test/db"]);

    expect(redactor.redact({
      output: "token=dev-secret-123",
      nested: ["postgres://user:pass@example.test/db"]
    })).toEqual({
      output: "token=[REDACTED]",
      nested: ["[REDACTED]"]
    });
  });

  it("redacts common credential assignments even when their value was not preloaded", () => {
    const redactor = new Redactor([]);

    expect(redactor.redact("OPENAI_API_KEY=sk-development-value\npassword: sample-pass"))
      .toBe("OPENAI_API_KEY=[REDACTED]\npassword: [REDACTED]");
  });
});
