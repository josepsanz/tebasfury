import { describe, expect, it } from "vitest";
import { decideAccess, decidePariahTeamAccess, isPariah } from "./access-decision";

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

describe("isPariah", () => {
  it("is true for the pariah role only", () => {
    expect(isPariah(sessionFor("pariah"))).toBe(true);
    expect(isPariah(sessionFor("user"))).toBe(false);
    expect(isPariah(sessionFor("admin"))).toBe(false);
    expect(isPariah(null)).toBe(false);
  });
});

describe("decidePariahTeamAccess", () => {
  it("lets a pariah see their own team", () => {
    expect(decidePariahTeamAccess(sessionFor("pariah"), "t1", "t1")).toEqual({ kind: "allow" });
  });

  it("sends a pariah looking at a rival to /pariah", () => {
    expect(decidePariahTeamAccess(sessionFor("pariah"), "t2", "t1")).toEqual({
      kind: "redirect",
      to: "/pariah",
    });
  });

  it("sends a pariah with no team of their own to /pariah", () => {
    expect(decidePariahTeamAccess(sessionFor("pariah"), "t2", null)).toEqual({
      kind: "redirect",
      to: "/pariah",
    });
  });

  it("lets anybody else see any team", () => {
    expect(decidePariahTeamAccess(sessionFor("user"), "t2", "t1")).toEqual({ kind: "allow" });
  });
});
