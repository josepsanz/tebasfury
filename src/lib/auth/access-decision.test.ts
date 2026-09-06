import { describe, expect, it } from "vitest";
import { decideAccess } from "./access-decision";

const sessioDe = (role: string) => ({ user: { id: "u1", role } });

describe("decideAccess", () => {
  it("envia a /login quan no hi ha sessió", () => {
    expect(decideAccess(null, { sync: ["trigger"] })).toEqual({
      kind: "redirect",
      to: "/login",
    });
  });

  it("envia a l'arrel quan el rol no té el permís", () => {
    expect(decideAccess(sessioDe("user"), { sync: ["trigger"] })).toEqual({
      kind: "redirect",
      to: "/",
    });
  });

  it("deixa passar el colaborator que té el permís", () => {
    expect(decideAccess(sessioDe("colaborator"), { sync: ["trigger"] })).toEqual({
      kind: "allow",
    });
  });

  it("deixa passar l'admin", () => {
    expect(decideAccess(sessioDe("admin"), { user: ["set-role"] })).toEqual({
      kind: "allow",
    });
  });

  it("envia a l'arrel quan el rol és desconegut", () => {
    expect(decideAccess(sessioDe("intrus"), { fairplay: ["read"] })).toEqual({
      kind: "redirect",
      to: "/",
    });
  });

  it("envia a l'arrel quan el rol és 'constructor' i no es cola per prototip", () => {
    expect(decideAccess(sessioDe("constructor"), { fairplay: ["read"] })).toEqual({
      kind: "redirect",
      to: "/",
    });
  });

  it("envia a l'arrel quan el rol és 'toString' i no es cola per prototip", () => {
    expect(decideAccess(sessioDe("toString"), { fairplay: ["read"] })).toEqual({
      kind: "redirect",
      to: "/",
    });
  });
});
