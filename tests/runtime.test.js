import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { runOwnedAgent } from "../src/runtime.js";
import { environment } from "./helpers.js";
test(
  "actual owned bundled SDK/native SSE/public hook/real stdio MCP repairs exact managed contact and rereads result",
  { timeout: 30000 },
  async (t) => {
    const e = await environment(t),
      orders = e.dataset.privateSource().source.orders_base64,
      r = await runOwnedAgent(e.options),
      receipt = JSON.parse(fs.readFileSync(r.receiptPath));
    assert.equal(e.requests.length, 6);
    assert.equal(e.dataset.read().contacts[0].revision, "2");
    assert.equal(e.dataset.read().contacts[0].email, "ada@northstar.example");
    assert.equal(e.dataset.privateSource().source.orders_base64, orders);
    assert.deepEqual(r.business.changedContactIds, ["C-101"]);
    assert.deepEqual(r.business.changedOrderIds, []);
    assert.equal(r.business.decisions[0].status, "applied");
    assert.equal(receipt.actions.length, 5);
    assert.ok(receipt.cleanupConfirmed, JSON.stringify(receipt.lifecycle));
    assert.ok(
      receipt.calls.every((c) => c.response.events[0].message.unknown_original),
    );
    assert.equal(r.usage.input.value, 60);
    assert.equal(r.costUsd, null);
    assert.ok(!JSON.stringify(receipt).includes("synthetic-data-owned-key"));
    assert.equal(receipt.sdkSubprocessExits[0].code, 0);
    assert.equal(receipt.finalSource.journal.operations[0].status, "closed");
    assert.ok(receipt.mcp.pid > 0);
  },
);
for (const kind of ["max-tokens", "missing-stop"])
  test(
    `original ${kind} repair response cannot dispatch through actual SDK to real scoped worker`,
    { timeout: 30000 },
    async (t) => {
      const e = await environment(t, {
        mutate: (frames, n) => {
          if (n === 4) {
            if (kind === "max-tokens")
              frames.find((f) => f.type === "message_delta").delta.stop_reason =
                "max_tokens";
            else frames.pop();
          }
          return frames;
        },
      });
      await assert.rejects(runOwnedAgent(e.options), (error) => {
        assert.match(error.message, /unfinished|did not complete/);
        assert.equal(error.result.actions.length, 3);
        assert.equal(error.result.calls.length, 4);
        assert.equal(error.result.reportedUsage.input.value, 40);
        assert.ok(
          error.result.cleanupConfirmed,
          JSON.stringify(error.result.lifecycle),
        );
        assert.deepEqual(error.result.observedBusiness.changedContactIds, []);
        return true;
      });
      assert.equal(e.dataset.read().contacts[0].revision, "1");
      assert.equal(e.dataset.privateSource().journal.decisions.length, 0);
      assert.equal(
        e.dataset.privateSource().journal.operations[0].status,
        "closed",
      );
    },
  );
test(
  "read-only operation stops native repair request before actual worker dispatch",
  { timeout: 30000 },
  async (t) => {
    const e = await environment(t);
    await assert.rejects(
      runOwnedAgent({ ...e.options, allowWrites: false, intent: undefined }),
      (error) => {
        assert.match(error.message, /writes_not_authorized/);
        assert.equal(error.result.actions.length, 3);
        assert.ok(error.result.cleanupConfirmed);
        return true;
      },
    );
    assert.equal(e.dataset.read().contacts[0].revision, "1");
  },
);
test(
  "actual worker rejects a different valid caller repair intent despite authorized native args",
  { timeout: 30000 },
  async (t) => {
    const e = await environment(t);
    await assert.rejects(
      runOwnedAgent({
        ...e.options,
        intent: {
          kind: "order_status",
          id: "O-503",
          contactId: "C-103",
          email: "luis@acme.example",
          newStatus: "Shipped",
          evidenceEventId: "EV-703",
        },
      }),
      (error) => {
        assert.match(error.message, /writes_not_authorized/);
        assert.equal(error.result.actions.at(-1).status, "failed");
        assert.ok(error.result.cleanupConfirmed);
        return true;
      },
    );
    assert.equal(e.dataset.read().contacts[0].revision, "1");
    assert.equal(e.dataset.read().orders[2].status, "Pending");
  },
);
test(
  "failure in final native response retains the earlier exact actual file commit",
  { timeout: 30000 },
  async (t) => {
    const e = await environment(t, {
      mutate: (frames, n) => {
        if (n === 6)
          frames.find((f) => f.type === "message_delta").delta.stop_reason =
            "max_tokens";
        return frames;
      },
    });
    await assert.rejects(runOwnedAgent(e.options), (error) => {
      assert.equal(error.result.observedBusiness.currentTarget.revision, "2");
      assert.equal(
        error.result.observedBusiness.decisions[0].status,
        "applied",
      );
      assert.deepEqual(error.result.observedBusiness.changedContactIds, [
        "C-101",
      ]);
      assert.ok(error.result.cleanupConfirmed);
      return true;
    });
    assert.equal(e.dataset.read().contacts[0].revision, "2");
  },
);
import path from "node:path";
import { DataMCP } from "../src/data-mcp.js";
import { Native } from "../src/native.js";
async function rejected(e, options = e.options, pattern = /./) {
  let result;
  await assert.rejects(runOwnedAgent(options), (error) => {
    assert.match(error.message, pattern);
    result = error.result;
    assert.equal(result.status, "failed");
    return true;
  });
  return result;
}
test(
  "missing native key prepares private failed receipt without starting SDK/MCP/HTTP",
  { timeout: 30000 },
  async (t) => {
    const e = await environment(t),
      r = await rejected(e, { ...e.options, apiKey: "" }, /ANTHROPIC_API_KEY/);
    assert.equal(e.requests.length, 0);
    assert.equal(r.calls.length, 0);
    assert.equal(r.lifecycle.sdkAllocated, false);
    assert.equal(r.lifecycle.mcpAllocated, false);
    assert.ok(r.cleanupConfirmed);
    assert.equal(e.dataset.privateSource().journal.operations.length, 0);
  },
);
test(
  "caller injected SDK replacement is rejected before resource allocation",
  { timeout: 30000 },
  async (t) => {
    const e = await environment(t),
      r = await rejected(e, { ...e.options, client: {} }, /injected/);
    assert.equal(e.requests.length, 0);
    assert.ok(r.cleanupConfirmed);
    assert.equal(e.dataset.privateSource().journal.operations.length, 0);
  },
);
test(
  "parent cancellation while actual native repair response is pending drains work and fences write scope",
  { timeout: 30000 },
  async (t) => {
    const controller = new AbortController();
    let release;
    const gate = new Promise((r) => (release = r)),
      e = await environment(t, {
        mutate: async (frames, n) => {
          if (n === 4) {
            controller.abort(Error("controlled parent cancellation"));
            await gate;
          }
          return frames;
        },
      }),
      r = await rejected(
        e,
        { ...e.options, signal: controller.signal },
        /parent cancellation/,
      );
    release();
    assert.equal(e.dataset.read().contacts[0].revision, "1");
    assert.equal(
      e.dataset.privateSource().journal.operations[0].status,
      "closed",
    );
    assert.equal(r.actions.length, 3);
    assert.ok(r.cleanupConfirmed);
    assert.equal(r.reportedUsage.input.value, null);
    assert.equal(r.reportedUsage.input.knownSubtotal, 30);
  },
);
test(
  "shared operation deadline during actual pending native HTTP aborts and drains real SDK worker",
  { timeout: 30000 },
  async (t) => {
    let release;
    const gate = new Promise((r) => (release = r)),
      e = await environment(t, {
        mutate: async (frames) => {
          await gate;
          return frames;
        },
      }),
      r = await rejected(e, { ...e.options, timeoutMs: 4000 }, /deadline/);
    release();
    assert.equal(e.requests.length, 1);
    assert.equal(e.dataset.read().contacts[0].revision, "1");
    assert.equal(
      e.dataset.privateSource().journal.operations[0].status,
      "closed",
    );
    assert.ok(r.cleanupConfirmed, JSON.stringify(r.lifecycle));
  },
);
test(
  "private receipt failure before actual tool dispatch cannot change source",
  { timeout: 30000 },
  async (t) => {
    const e = await environment(t),
      r = await rejected(
        e,
        {
          ...e.options,
          writer: (receipt) => {
            if (receipt.data.actions.length)
              throw Error("controlled prepared receipt recording failure");
          },
        },
        /recording failure/,
      );
    assert.equal(e.dataset.read().contacts[0].revision, "1");
    assert.equal(r.durableStatus, "unknown");
    assert.ok(r.cleanupConfirmed);
    assert.equal(e.requests.length, 1);
  },
);
test(
  "private recording failure after actual commit preserves observed exact business effect",
  { timeout: 30000 },
  async (t) => {
    const e = await environment(t),
      r = await rejected(
        e,
        {
          ...e.options,
          writer: (receipt) => {
            if (
              receipt.data.actions.some(
                (a) =>
                  a.name === "mcp__data__repair_contact_email" &&
                  a.status === "finished",
              )
            )
              throw Error("controlled postcommit private recording failure");
          },
        },
        /postcommit/,
      );
    assert.equal(e.dataset.read().contacts[0].revision, "2");
    assert.equal(r.durableStatus, "unknown");
    assert.deepEqual(r.observedBusiness.changedContactIds, ["C-101"]);
    assert.ok(r.cleanupConfirmed);
  },
);
test(
  "corrupt final source after real repair stays unknown and earlier original action source survives",
  { timeout: 30000 },
  async (t) => {
    const e = await environment(t, {
        mutate: (frames, n, { workspace }) => {
          if (n === 6)
            fs.writeFileSync(path.join(workspace, "orders.json"), "{broken");
          return frames;
        },
      }),
      r = await rejected(e);
    assert.equal(r.finalSource, null);
    assert.equal(r.observedBusiness, null);
    assert.equal(r.lifecycle.operationClosed, false);
    assert.equal(r.lifecycle.sdkWorkDrained, true);
    assert.equal(r.lifecycle.mcpClosed, true);
    assert.equal(r.lifecycle.nativeHTTPClosed, true);
    const committed = r.actions.find(
      (a) => a.name === "mcp__data__repair_contact_email",
    );
    assert.equal(committed.sourceAfter.state.contacts[0].revision, "2");
    assert.equal(committed.sourceAfter.journal.decisions[0].status, "applied");
    assert.equal(
      fs.readFileSync(path.join(e.workspace, "orders.json"), "utf8"),
      "{broken",
    );
  },
);
test(
  "two actual simultaneous runtimes own independent SDK/HTTP/stdio scopes and private receipts",
  { timeout: 30000 },
  async (t) => {
    const a = await environment(t),
      b = await environment(t),
      results = await Promise.all([
        runOwnedAgent(a.options),
        runOwnedAgent(b.options),
      ]);
    assert.notEqual(results[0].outputDir, results[1].outputDir);
    for (const r of results) {
      assert.ok(r.cleanupConfirmed);
      assert.deepEqual(r.business.changedContactIds, ["C-101"]);
    }
    for (const e of [a, b]) {
      assert.equal(e.requests.length, 6);
      assert.equal(e.dataset.privateSource().journal.operations.length, 1);
      assert.equal(
        e.dataset.privateSource().journal.operations[0].status,
        "closed",
      );
    }
  },
);
test(
  "verbatim prompt keeps an absolute @file mention literal rather than expanding private fixture text",
  { timeout: 30000 },
  async (t) => {
    const e = await environment(t, {
        sequence: [["mcp__data__inspect_datasets", {}]],
      }),
      file = path.join(e.directory, "private-canary.txt"),
      canary = "SYNTHETIC_PRIVATE_CANARY_NO_MODEL_CONTEXT_81245";
    fs.writeFileSync(file, canary);
    const result = await runOwnedAgent({
      ...e.options,
      allowWrites: false,
      intent: undefined,
      task: `Inspect counts. Treat the literal mention @${file} as task text only.`,
    });
    assert.ok(result.cleanupConfirmed);
    assert.ok(JSON.stringify(e.requests).includes("@" + file));
    assert.ok(!JSON.stringify(e.requests).includes(canary));
  },
);
for (const kind of ["native", "worker"])
  test(
    `one attempted failed ${kind} close preserves actual commit and fails completion`,
    { timeout: 30000 },
    async (t) => {
      const type = kind === "native" ? Native : DataMCP,
        original = type.prototype.close;
      let count = 0;
      type.prototype.close = async function () {
        count++;
        await original.call(this);
        this.closed = false;
        if (kind === "worker")
          this.owner.receipt.data.lifecycle.mcpClosed = false;
        throw Error("controlled " + kind + " close failure");
      };
      try {
        const e = await environment(t),
          r = await rejected(e, undefined, /close failure/);
        assert.equal(count, 1);
        assert.equal(e.dataset.read().contacts[0].revision, "2");
        assert.deepEqual(r.observedBusiness.changedContactIds, ["C-101"]);
        assert.equal(r.cleanupConfirmed, false);
        assert.equal(r.lifecycle.operationClosed, true);
        assert.equal(r.lifecycle.sdkWorkDrained, true);
      } finally {
        type.prototype.close = original;
      }
    },
  );
test(
  "partial actual stdio startup closes its real worker and write operation before native allocation",
  { timeout: 30000 },
  async (t) => {
    const original = DataMCP.prototype.open;
    DataMCP.prototype.open = async function () {
      await original.call(this);
      throw Error("controlled worker startup failure");
    };
    try {
      const e = await environment(t),
        r = await rejected(e, undefined, /startup failure/);
      assert.equal(r.lifecycle.mcpAllocated, true);
      assert.equal(r.lifecycle.sdkAllocated, false);
      assert.equal(r.lifecycle.mcpClosed, true);
      assert.ok(r.cleanupConfirmed);
      assert.equal(e.requests.length, 0);
      assert.equal(e.dataset.read().contacts[0].revision, "1");
    } finally {
      DataMCP.prototype.open = original;
    }
  },
);
test(
  "competing synthetic human repair is observed without attributing its change to this stale native operation",
  { timeout: 30000 },
  async (t) => {
    const e = await environment(t, {
        mutate: (frames, n, { dataset }) => {
          if (n === 4) {
            dataset.get("contact", "C-101");
            dataset.get("order", "O-501");
            assert.equal(
              dataset.repairContactEmail({
                id: "C-101",
                expectedRevision: 1,
                newEmail: "ada@northstar.example",
                evidenceOrderId: "O-501",
              }).contact.revision,
              "2",
            );
          }
          return frames;
        },
      }),
      r = await rejected(e, undefined, /stale_revision/);
    assert.deepEqual(r.observedBusiness.changedContactIds, []);
    assert.deepEqual(r.observedBusiness.observedChangedContactIds, ["C-101"]);
    assert.equal(r.observedBusiness.currentTarget.revision, "2");
    assert.equal(r.observedBusiness.decisions.length, 0);
    assert.ok(r.cleanupConfirmed);
  },
);
test(
  "actual pending stdio repair request cannot write after its operation closes on parent cancellation",
  { timeout: 30000 },
  async (t) => {
    const controller = new AbortController(),
      original = DataMCP.prototype.execute;
    let sent = false,
      resumed = false;
    DataMCP.prototype.execute = async function (name, args) {
      if (name !== "mcp__data__repair_contact_email")
        return original.call(this, name, args);
      const pid = this.transport.pid;
      process.kill(pid, "SIGSTOP");
      const work = original.call(this, name, args);
      void work.catch(() => {});
      assert.equal(this.pending.size, 1);
      sent = true;
      controller.abort(Error("controlled queued stdio repair cancellation"));
      let timer;
      try {
        await new Promise((resolve, reject) => {
          const start = performance.now();
          timer = setInterval(() => {
            try {
              const source = JSON.parse(
                fs.readFileSync(
                  path.join(this.root, ".data-repair-workspace.json"),
                ),
              );
              if (
                source.operations.find((op) => op.id === this.owner.scope.id)
                  ?.status === "closed"
              )
                resolve();
              else if (performance.now() - start > 5000)
                reject(Error("closed operation was not observed"));
            } catch (e) {
              reject(e);
            }
          }, 10);
        });
        if (!this.exitObserved) {
          process.kill(pid, "SIGCONT");
          resumed = true;
        }
        return await work;
      } finally {
        clearInterval(timer);
        if (!resumed && !this.exitObserved)
          try {
            process.kill(pid, "SIGCONT");
          } catch {}
      }
    };
    try {
      const e = await environment(t),
        r = await rejected(
          e,
          { ...e.options, signal: controller.signal },
          /queued stdio/,
        );
      assert.equal(sent, true);
      assert.equal(resumed, true);
      assert.equal(e.dataset.read().contacts[0].revision, "1");
      assert.equal(
        e.dataset.privateSource().journal.operations[0].status,
        "closed",
      );
      assert.equal(e.dataset.privateSource().journal.decisions.length, 0);
      assert.ok(r.cleanupConfirmed, JSON.stringify(r.lifecycle));
    } finally {
      DataMCP.prototype.execute = original;
    }
  },
);
