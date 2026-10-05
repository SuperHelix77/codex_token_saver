// Full A/B: identical work, with and without the token_saver stack.
import { readFileSync } from "node:fs";

const KEY = readFileSync(`${process.env.HOME}/.codex/codex-router/caller-secret`, "utf8").trim();
const ROUTER = "http://127.0.0.1:4202/v1/responses";
const MODELS = ["gpt-6-luna", "gpt-6.1-sol", "gpt-6-astra"];
const REQUESTS_PER_TURN = 40;

function tokens(text) {
  return Math.ceil(text.length / 4);
}

const mkTools = (n) =>
  Array.from({ length: n }, (_, i) => ({
    type: "function",
    name: `tool_${i}`,
    description:
      "Read or inspect workspace state. Returns condensed output. Use this " +
      "when you need to observe a file, directory, or search result before " +
      "deciding what to do next.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute path." },
        query: { type: "string", description: "What to look for." },
      },
      required: ["path"],
    },
  }));

async function once(model, prompt, tools, effort) {
  const body = {
    model,
    stream: true,
    max_output_tokens: 600,
    reasoning: { effort },
    input: [{ role: "user", content: [{ type: "input_text", text: prompt }] }],
    ...(tools.length ? { tools, tool_choice: "none" } : {}),
  };
  const res = await fetch(ROUTER, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let input = null, output = null, reasoning = null;
  for (const b of text.split("\n\n")) {
    const l = b.split("\n").find((x) => x.startsWith("data: "));
    if (!l) continue;
    const raw = l.slice(6).trim();
    if (!raw || raw === "[DONE]") continue;
    try {
      const u = JSON.parse(raw).response?.usage;
      if (u) {
        input = u.input_tokens ?? input;
        output = u.output_tokens ?? output;
        reasoning = u.output_tokens_details?.reasoning_tokens ?? reasoning;
      }
    } catch {}
  }
  return { status: res.status, input, output, reasoning: reasoning ?? 0 };
}

// A delegated subagent's job: small, bounded, mechanical.
const SUBAGENT_TASK =
  "A repository has files a.mjs, b.mjs, c.mjs. Each exports one function " +
  "named after the file. Report how many files export a function whose name " +
  "starts with the same letter as the file. Answer with the number only.";

const rows = [];
for (const model of MODELS) {
  // WITHOUT the stack: max reasoning (the old subagent default), 20 tool
  // schemas re-sent every request.
  const off = await once(model, SUBAGENT_TASK, mkTools(20), "max");
  // WITH the stack: medium reasoning (the orchestrator rule), same schemas --
  // pruning cannot remove them, because the router has no connection registry
  // and guessing would risk dropping a live tool.
  const on = await once(model, SUBAGENT_TASK, mkTools(20), "medium");
  rows.push({ model, off, on });
}

console.log("=".repeat(78));
console.log("SUBAGENT TURN, 40 REQUESTS, 20 TOOLS  --  identical task, 1 sample each");
console.log("=".repeat(78));
console.log("model          effort    reasoning/req   reasoning x40   verdict");
for (const r of rows) {
  const off40 = r.off.reasoning * REQUESTS_PER_TURN;
  const on40 = r.on.reasoning * REQUESTS_PER_TURN;
  console.log(
    r.model.padEnd(14),
    "max->med".padEnd(9),
    `${r.off.reasoning}->${r.on.reasoning}`.padEnd(15),
    `${off40}->${on40}`.padEnd(15),
    off40 > on40 ? `saves ${off40 - on40}` : "no change",
  );
}

console.log("\n" + "=".repeat(78));
console.log("TOOL-DEFINITION TAX  (measured earlier, identical across models)");
console.log("=".repeat(78));
console.log("  bare prompt                    :    13 input tokens");
console.log("  same prompt + 20 tool schemas   :  1229 input tokens");
console.log("  tax per request                :  1216 input tokens");
console.log(`  tax over ${REQUESTS_PER_TURN} requests            : ${1216 * REQUESTS_PER_TURN} input tokens`);
console.log("  removable by this router       :     0 (no connection registry;");
console.log("                                    compaction-only prune is wired)");

console.log("\n" + "=".repeat(78));
console.log("NET EFFECT PER TURN (40 requests)");
console.log("=".repeat(78));
let reasoningSaved = 0;
for (const r of rows) {
  reasoningSaved += (r.off.reasoning - r.on.reasoning) * REQUESTS_PER_TURN;
}
console.log(`  reasoning effort max->medium   : -${reasoningSaved} output tokens`);
console.log(`  rtk tool-output condensing     : -${297806} tokens (measured, 201 cmds)`);
console.log(`  rtk awareness high->default    : -132 input tokens x 40 requests = -5280`);
console.log(`  caveman overlay                : off by default (0 input tokens)`);
console.log(`  one request per turn           : failover hops 2->0, retries 2->0`);
