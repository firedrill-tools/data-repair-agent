import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { parseJSON } from "./json.js";
export const minimalEnvironment = () =>
  Object.fromEntries(
    [
      "PATH",
      "HOME",
      "TMPDIR",
      "TMP",
      "TEMP",
      "USER",
      "LOGNAME",
      "LANG",
      "LC_ALL",
      "SystemRoot",
      "WINDIR",
    ]
      .filter((k) => typeof process.env[k] === "string")
      .map((k) => [k, process.env[k]]),
  );
async function within(promise, ms) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(Error("data MCP child exit unconfirmed")),
          ms,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
export class DataMCP {
  constructor(owner, root, output) {
    Object.assign(this, { owner, root, output });
    this.closeAttempted = false;
    this.closed = false;
    this.exitObserved = false;
    this.pending = new Set();
    this.stderr = "";
    this.exited = new Promise((resolve) => (this.resolveExit = resolve));
  }
  async open() {
    this.owner.basicGuard();
    this.client = new Client(
      { name: "owned-data-repair-controller", version: "0.2.0" },
      { versionNegotiation: { mode: "legacy" } },
    );
    this.transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        fileURLToPath(new URL("./mcp-server.js", import.meta.url)),
        "--workspace",
        this.root,
        "--operator-worker",
        ...(this.owner.allowWrites ? ["--allow-writes"] : []),
      ],
      cwd: this.output,
      stderr: "pipe",
      maxBufferSize: 2 * 1024 * 1024,
      env: {
        ...minimalEnvironment(),
        DATA_REPAIR_OPERATION_CREDENTIAL: this.owner.credential,
        DATA_REPAIR_OPERATION_ID: this.owner.scope.id,
      },
    });
    this.transport.onclose = () => {
      this.exitObserved = true;
      this.resolveExit();
    };
    this.transport.stderr?.on("data", (b) => {
      this.stderr = (this.stderr + b).slice(-65536);
    });
    await this.client.connect(this.transport, {
      signal: this.owner.signal,
      timeout: 10000,
    });
    this.owner.receipt.data.lifecycle.mcpAllocated = true;
    const names = (
      await this.client.listTools(undefined, {
        signal: this.owner.signal,
        timeout: 10000,
      })
    ).tools
      .map((t) => t.name)
      .sort();
    if (
      JSON.stringify(names) !==
      JSON.stringify([
        "find_records",
        "get_record",
        "inspect_datasets",
        "repair_contact_email",
        "repair_order_status",
      ])
    )
      throw Error("worker tool boundary differs");
    this.owner.receipt.data.mcp = {
      pid: this.transport.pid,
      protocol:
        "actual client/server2.3.1 explicit legacy negotiation; five business tools; no source/permission controller tool",
    };
    this.owner.receipt.save();
    return this;
  }
  async execute(name, args) {
    this.owner.basicGuard();
    if (this.closeAttempted) throw Error("data MCP is closing");
    const work = this.client.callTool(
      { name: name.replace("mcp__data__", ""), arguments: args },
      undefined,
      {
        signal: this.owner.signal,
        timeout: Math.max(
          1,
          Math.min(15000, Math.ceil(this.owner.deadline - performance.now())),
        ),
        resetTimeoutOnProgress: false,
      },
    );
    this.pending.add(work);
    let response;
    try {
      response = await work;
    } finally {
      this.pending.delete(work);
    }
    if (
      !response ||
      !Array.isArray(response.content) ||
      response.content.length !== 1 ||
      response.content[0].type !== "text"
    )
      throw Error("unexpected data MCP response");
    const raw = response.content[0].text;
    if (Buffer.byteLength(raw) > 1024 * 1024)
      throw Error("MCP business response exceeds retained limit");
    const value = parseJSON(raw);
    if (response.isError)
      throw Object.assign(Error(value.error ?? "data MCP operation failed"), {
        businessObservation: value,
      });
    return { value, response };
  }
  async close() {
    if (this.closeAttempted) throw Error("data MCP close already attempted");
    this.closeAttempted = true;
    const errors = [];
    try {
      if (this.client) await this.client.close();
      else if (this.transport) await this.transport.close();
    } catch (e) {
      errors.push(e);
    }
    if (this.transport)
      try {
        await within(this.exited, 5000);
      } catch (e) {
        errors.push(e);
      }
    await Promise.allSettled([...this.pending]);
    this.owner.receipt.data.mcpStderr = this.stderr;
    this.owner.receipt.data.lifecycle.mcpClosed =
      !this.transport || this.exitObserved;
    if (errors.length) throw errors[0];
    this.closed = true;
  }
}
