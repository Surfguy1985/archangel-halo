import { describe, expect, it } from "vitest";
import { pmLiveIdentity, type HaloIdentity } from "./enforcerCore";
import {
  filterBySnapshotScope,
  filterPropertiesByScope,
  snapshotContainsPropertyId,
  snapshotPropertyScope,
} from "./commandSnapshotCore";

const admin: HaloIdentity = {
  subject: "office",
  tenantId: "t",
  roles: ["admin"],
  source: "office_session",
};

const pmUnscoped: HaloIdentity = {
  subject: "pm",
  tenantId: "t",
  roles: ["property_manager"],
  source: "enforcer",
};

describe("Command snapshot property scope", () => {
  it("lets office admin and field/accounting see the tenant", () => {
    expect(snapshotPropertyScope(undefined)).toEqual({ mode: "tenant" });
    expect(snapshotPropertyScope(admin)).toEqual({ mode: "tenant" });
    expect(
      snapshotPropertyScope({ ...admin, roles: ["field_manager"] }),
    ).toEqual({ mode: "tenant" });
    expect(
      snapshotPropertyScope({ ...admin, roles: ["accounting"] }),
    ).toEqual({ mode: "tenant" });
  });

  it("fail-closes property_manager / vendor / crew without a property id", () => {
    expect(snapshotPropertyScope(pmUnscoped)).toEqual({ mode: "property", propertyIds: [] });
    expect(
      snapshotPropertyScope({ ...pmUnscoped, roles: ["vendor"] }),
    ).toEqual({ mode: "property", propertyIds: [] });
  });

  it("scopes PM live and property_manager to the bound property", () => {
    expect(snapshotPropertyScope(pmLiveIdentity("prop-a"))).toEqual({
      mode: "property",
      propertyIds: ["prop-a"],
    });
    expect(snapshotPropertyScope({ ...pmUnscoped, propertyId: "prop-a" })).toEqual({
      mode: "property",
      propertyIds: ["prop-a"],
    });
  });

  it("drops foreign rows in data, not via a prompt", () => {
    const scope = snapshotPropertyScope({ ...pmUnscoped, propertyId: "prop-a" });
    const jobs = [
      { id: "j1", propertyId: "prop-a" },
      { id: "j2", propertyId: "prop-b" },
    ];
    const props = [
      { id: "prop-a", name: "Oak" },
      { id: "prop-b", name: "Thornbury" },
    ];
    const scopedJobs = filterBySnapshotScope(jobs, scope);
    const scopedProps = filterPropertiesByScope(props, scope);
    expect(scopedJobs.map((j) => j.id)).toEqual(["j1"]);
    expect(scopedProps.map((p) => p.id)).toEqual(["prop-a"]);
    expect(snapshotContainsPropertyId({ jobs: scopedJobs, properties: scopedProps }, "prop-b")).toBe(
      false,
    );
  });

  it("empty property scope yields no rows", () => {
    const scope = snapshotPropertyScope(pmUnscoped);
    expect(filterBySnapshotScope([{ propertyId: "prop-a" }], scope)).toEqual([]);
    expect(filterPropertiesByScope([{ id: "prop-a" }], scope)).toEqual([]);
  });
});
