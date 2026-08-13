import { describe, expect, it } from "vitest";
import {
  actionFromChatCapability,
  classifyMutation,
  decideFalkonPolicy,
  httpStatusForDecision,
  isConsequentialAction,
  parseFalkonMode,
  targetIdFromPath,
  actorChannelFromRequest,
  type FalkonDecisionInput,
} from "./falkonPolicyCore";

function input(over: Partial<FalkonDecisionInput> = {}): FalkonDecisionInput {
  return {
    mode: "ASSISTED",
    action: "send_invoice",
    actorChannel: "human",
    policy: {},
    ...over,
  };
}

describe("Falkon mode parsing", () => {
  it("parses known modes and fails closed on junk", () => {
    expect(parseFalkonMode("assisted")).toBe("ASSISTED");
    expect(parseFalkonMode("LIVE")).toBe("LIVE");
    expect(parseFalkonMode("nope")).toBe("UNKNOWN");
    expect(parseFalkonMode(undefined)).toBe("UNKNOWN");
  });
});

describe("LIVE remains disabled", () => {
  it("denies every mutation including safe-looking ones once classified consequential", () => {
    const d = decideFalkonPolicy(input({ mode: "LIVE", action: "job.create", actorChannel: "human" }));
    expect(d.code).toBe("DENY");
    expect(d.permitted).toBe(false);
    expect(d.reason).toBe("live_disabled");
  });

  it("denies ops.eod_briefing in LIVE", () => {
    const d = decideFalkonPolicy(input({ mode: "LIVE", action: "ops.eod_briefing", actorChannel: "worker" }));
    expect(d.code).toBe("DENY");
    expect(d.reason).toBe("live_disabled");
  });
});

describe("SHADOW — no AI/worker/S2S operational mutation", () => {
  it("lets a human operator mutate (Falkon observes)", () => {
    const d = decideFalkonPolicy(input({ mode: "SHADOW", actorChannel: "human", action: "job.create" }));
    expect(d.code).toBe("ALLOW_AUTOMATIC");
  });

  it("blocks AI auto-action bypass", () => {
    const d = decideFalkonPolicy(input({ mode: "SHADOW", actorChannel: "ai", action: "job.create" }));
    expect(d.code).toBe("SHADOW_ONLY");
    expect(d.permitted).toBe(false);
  });

  it("blocks background-worker bypass", () => {
    const d = decideFalkonPolicy(input({ mode: "SHADOW", actorChannel: "worker", action: "send_invoice" }));
    expect(d.code).toBe("SHADOW_ONLY");
    expect(d.permitted).toBe(false);
  });
});

describe("ASSISTED — direct API cannot skip approval", () => {
  it("requires approval for a direct send_invoice call", () => {
    const d = decideFalkonPolicy(input({ mode: "ASSISTED", actorChannel: "human", action: "send_invoice", amount: 5000 }));
    expect(d.code).toBe("REQUIRE_APPROVAL");
    expect(d.permitted).toBe(false);
  });

  it("allows only when an explicit policy threshold matches", () => {
    const d = decideFalkonPolicy(
      input({
        mode: "ASSISTED",
        action: "send_invoice",
        amount: 100,
        policy: { maxAutoInvoiceAmount: 250 },
      }),
    );
    expect(d.code).toBe("ALLOW_AUTOMATIC");
    expect(d.policyGranted).toBe(true);
  });

  it("does not invent auto-allow from a role name", () => {
    const d = decideFalkonPolicy(input({ role: "executive", action: "payment.release" }));
    expect(d.code).toBe("REQUIRE_APPROVAL");
  });

  it("blocks LLM execute of job.create without policy", () => {
    const d = decideFalkonPolicy(input({ actorChannel: "ai", action: "job.create" }));
    expect(d.code).toBe("REQUIRE_APPROVAL");
  });

  it("blocks autopilot/worker send_invoice", () => {
    const d = decideFalkonPolicy(input({ actorChannel: "worker", action: "send_invoice" }));
    expect(d.code).toBe("REQUIRE_APPROVAL");
  });

  it("consumes a prior approval exactly once (caller marks consumed)", () => {
    const d = decideFalkonPolicy(input({ approvalConsumed: true, action: "send_invoice" }));
    expect(d.code).toBe("ALLOW_AUTOMATIC");
    expect(d.reason).toBe("approval_consumed");
  });
});

describe("OFF allows HALO to operate but still classifies", () => {
  it("allows consequential mutations when Falkon is OFF", () => {
    const d = decideFalkonPolicy(input({ mode: "OFF", action: "job.create" }));
    expect(d.code).toBe("ALLOW_AUTOMATIC");
    expect(d.reason).toBe("mode_off");
  });
});

describe("direct API classification (bypass surface)", () => {
  it("maps invoice send and job create as consequential", () => {
    const inv = classifyMutation("POST", "/invoices/abc/send");
    expect("skip" in inv).toBe(false);
    if ("skip" in inv) return;
    expect(inv.action).toBe("send_invoice");
    expect(inv.consequential).toBe(true);
    const job = classifyMutation("POST", "/jobs");
    if ("skip" in job) throw new Error("jobs should be classified");
    expect(job.action).toBe("job.create");
  });

  it("maps chat execute capability to a Falkon action", () => {
    const classified = classifyMutation("POST", "/command/actions/execute", { capability: "invoice.send" });
    expect(classified).toMatchObject({ action: "send_invoice", consequential: true });
    expect(actionFromChatCapability("job.create")).toBe("job.create");
  });

  it("does not gate conversation asks or Base44 ingest", () => {
    expect(classifyMutation("POST", "/command/conversations/x/ask")).toEqual({ skip: true });
    expect(classifyMutation("POST", "/settings/sync-base44")).toEqual({ skip: true });
    expect(classifyMutation("GET", "/jobs")).toEqual({ skip: true });
  });

  it("does not treat weather.risk_scan as a schedule write", () => {
    expect(classifyMutation("POST", "/weather/scan")).toEqual({ skip: true });
    expect(actionFromChatCapability("weather.risk_scan")).toBe("weather.risk_scan");
    expect(isConsequentialAction("weather.risk_scan")).toBe(false);
  });

  it("keeps catalog lookup, estimate drafts, and schedule recommend as non-writes", () => {
    expect(classifyMutation("POST", "/catalog/lookup")).toEqual({ skip: true });
    expect(classifyMutation("POST", "/estimates/from-evidence")).toEqual({ skip: true });
    expect(classifyMutation("POST", "/weather/recommend")).toEqual({ skip: true });
    expect(actionFromChatCapability("catalog.lookup")).toBe("catalog.lookup");
    expect(actionFromChatCapability("estimate.from_evidence")).toBe("estimate.from_evidence");
    expect(actionFromChatCapability("weather.schedule_recommend")).toBe("weather.schedule_recommend");
  });

  it("gates outbound SMS and voice EOD as consequential", () => {
    expect(classifyMutation("POST", "/sms/blast")).toMatchObject({ action: "comms.sms", consequential: true });
    expect(classifyMutation("POST", "/voice-eod/batch")).toMatchObject({
      action: "field.voice_eod",
      consequential: true,
    });
    expect(classifyMutation("GET", "/sms/recent")).toEqual({ skip: true });
  });

  it("classifies briefing persist as ops.eod_briefing", () => {
    const c = classifyMutation("POST", "/briefings/run-now");
    expect(c).toMatchObject({ action: "ops.eod_briefing", consequential: true });
    expect(classifyMutation("GET", "/briefings/latest")).toEqual({ skip: true });
  });

  it("treats unknown office POSTs as generic.mutate (fail closed in ASSISTED)", () => {
    const c = classifyMutation("POST", "/mystery/wipe");
    expect(c).toMatchObject({ action: "generic.mutate", consequential: true });
    expect(isConsequentialAction("generic.mutate")).toBe(true);
  });
});

describe("unknown mode fails closed", () => {
  it("denies mutations when mode is garbage", () => {
    const d = decideFalkonPolicy(input({ mode: "YEET" }));
    expect(d.code).toBe("DENY");
  });
});

describe("auditability of the decision packet", () => {
  it("records actor channel, mode, action, and decision code", () => {
    const d = decideFalkonPolicy(
      input({
        actor: "user-1",
        role: "admin",
        tenantId: "tenant-a",
        capability: "invoices.send",
        targetType: "invoice",
        targetId: "inv-1",
      }),
    );
    expect(d).toMatchObject({
      code: "REQUIRE_APPROVAL",
      action: "send_invoice",
      mode: "ASSISTED",
      actorChannel: "human",
      permitted: false,
      requiresApproval: true,
      reason: "assisted_approval_required",
    });
    expect(httpStatusForDecision(d.code)).toBe(202);
  });
});

describe("HTTP actor channel is not client-settable", () => {
  it("never treats HTTP as worker even if a client would send that header", () => {
    expect(
      actorChannelFromRequest({
        path: "/jobs",
        haloIdentity: { tenantId: "t" },
      }),
    ).toBe("human");
    expect(actorChannelFromRequest({ path: "/jobs" })).toBe("s2s");
    expect(actorChannelFromRequest({ path: "/command/actions/execute" })).toBe("ai");
  });
});

describe("ops.eod_briefing is a HALO snapshot", () => {
  it("lets a SHADOW worker persist the recap", () => {
    const d = decideFalkonPolicy(
      input({ mode: "SHADOW", action: "ops.eod_briefing", actorChannel: "worker" }),
    );
    expect(d.code).toBe("ALLOW_AUTOMATIC");
    expect(d.reason).toBe("halo_internal_snapshot");
  });

  it("lets ASSISTED persist without invoice-style approval", () => {
    const d = decideFalkonPolicy(
      input({ mode: "ASSISTED", action: "ops.eod_briefing", actorChannel: "human" }),
    );
    expect(d.permitted).toBe(true);
  });
});

describe("field.voice_eod outbound dial", () => {
  it("does not place calls in SHADOW", () => {
    const d = decideFalkonPolicy(
      input({ mode: "SHADOW", action: "field.voice_eod", actorChannel: "human" }),
    );
    expect(d.code).toBe("SHADOW_ONLY");
    expect(d.reason).toBe("shadow_no_outbound_dial");
  });

  it("requires ASSISTED approval even for a human operator", () => {
    const d = decideFalkonPolicy(
      input({ mode: "ASSISTED", action: "field.voice_eod", actorChannel: "human" }),
    );
    expect(d.code).toBe("REQUIRE_APPROVAL");
    expect(d.permitted).toBe(false);
  });

  it("denies LIVE dials", () => {
    const d = decideFalkonPolicy(
      input({ mode: "LIVE", action: "field.voice_eod", actorChannel: "human" }),
    );
    expect(d.code).toBe("DENY");
  });
});

describe("path helpers", () => {
  it("extracts invoice/job ids from office paths", () => {
    expect(targetIdFromPath("/invoices/abc/send")).toBe("abc");
    expect(targetIdFromPath("/jobs/job-1/assign")).toBe("job-1");
    expect(targetIdFromPath("/settings/reset")).toBeNull();
  });

  it("skips public token surfaces so crew/client pay is not office-gated", () => {
    expect(classifyMutation("POST", "/portal/tok/invoices")).toEqual({ skip: true });
    expect(classifyMutation("POST", "/pay/tok/charge")).toEqual({ skip: true });
    expect(classifyMutation("POST", "/client/tok/work-requests")).toEqual({ skip: true });
  });
});
