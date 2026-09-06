import { describe, expect, it } from "vitest";
import { decideAccess } from "./access-decision";

const sessionFor = (role: string) => ({ user: { id: "u1", role } });

describe("decideAccess", () => {
  it("sends you to /login when there is no session", () => {
    expect(decideAccess(null, { sync: ["trigger"] })).toEqual({
      kind: "redirect",
      to: "/login",
    });
  });

  it("sends you to the root when the role lacks the permission", () => {
    expect(decideAccess(sessionFor("user"), { sync: ["trigger"] })).toEqual({
      kind: "redirect",
      to: "/",
    });
  });

  it("lets a collaborator through when the role holds the permission", () => {
    expect(decideAccess(sessionFor("collaborator"), { sync: ["trigger"] })).toEqual({
      kind: "allow",
    });
  });

  it("lets an admin through", () => {
    expect(decideAccess(sessionFor("admin"), { user: ["set-role"] })).toEqual({
      kind: "allow",
    });
  });

  it("sends you to the root when the role is unknown", () => {
    expect(decideAccess(sessionFor("intruder"), { fairplay: ["read"] })).toEqual({
      kind: "redirect",
      to: "/",
    });
  });

  it("sends 'constructor' to the root instead of leaking through the prototype", () => {
    expect(decideAccess(sessionFor("constructor"), { fairplay: ["read"] })).toEqual({
      kind: "redirect",
      to: "/",
    });
  });

  it("sends 'toString' to the root instead of leaking through the prototype", () => {
    expect(decideAccess(sessionFor("toString"), { fairplay: ["read"] })).toEqual({
      kind: "redirect",
      to: "/",
    });
  });
});
