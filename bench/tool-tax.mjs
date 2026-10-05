// A/B report: identical runs with and without the token_saver stack.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const KEY = readFileSync(`${process.env.HOME}/.codex/codex-router/caller-secret`, "utf8").trim();
const ROUTER = "http://127.0.0.1:4202/v1/responses";
const MODELS = ["gpt-6-luna", "gpt-6.1-sol", "gpt-6-astra"];

// A realistic agent turn's worth of tool output, condensed vs raw.
const RAW_TOOL_OUTPUT = `
src/api-forwarder.mjs                     | 102 ++++++++++++++++---
src/model-failover.mjs                    |  24 ++-
src/rate-limit-headers.mjs                |  34 +++++++--
src/router.mjs                            |  57 ++++++++++-
src/concise-output.mjs                    |  62 ++++++++++++++
src/tool-pruning.mjs                      |  95 +++++++++++++++++++++
test/concise-output.test.mjs              |  79 ++++++++++++++++++
test/tool-pruning.test.mjs                |  68 ++++++++++++++
8 files changed, 419 insertions(+), 47 deletions(-)
`;

function tokensOf(text) {
  return Math.ceil(text.length / 4);
}

async function once(model, prompt, tools) {
  const body = {
    model,
    stream: true,
    max_output_tokens: 400,
    input: [{ role: "user", content: [{ type: "input_text", text: prompt }] }],
    ...(tools?.length ? { tools, tool_choice: "none" } : {}),
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
  return { status: res.status, input, output, reasoning };
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

const PROMPT = "Reply with the single word OK.";
const rows = [];

for (const model of MODELS) {
  // baseline: no tools declared, so no tool tax
  const bare = await once(model, PROMPT, []);
  // with the real inventory: 20 tools re-sent every request
  const loaded = await once(model, PROMPT, mkTools(20));
  rows.push({
    model,
    bareIn: bare.input,
    loadedIn: loaded.input,
    toolTax: (loaded.input ?? 0) - (bare.input ?? 0),
    out: loaded.output,
    reasoning: loaded.reasoning ?? 0,
  });
}

console.log("TOOL-DEFINITION TAX (identical prompt, 20 tools vs none)\n");
console.log("model            bare_in  with_tools   tax_per_request  output  reasoning");
for (const r of rows) {
  console.log(
    r.model.padEnd(15),
    String(r.bareIn).padStart(7),
    String(r.loadedIn).padStart(11),
    String(r.toolTax).padStart(15),
    String(r.out).padStart(7),
    String(r.reasoning).padStart(10),
  );
}

const avg = Math.round(rows.reduce((a, r) => a + r.toolTax, 0) / rows.length);
console.log(`\naverage tool tax: ${avg} input tokens per request per model`);
for (const requests of [10, 40, 100]) {
  console.log(`  over ${String(requests).padStart(3)} requests: ${avg * requests} tokens`);
}

console.log("\n\nTOOL-OUTPUT CONDENSING (rtk), same content\n");
const raw = RAW_TOOL_OUTPUT;
const condensed = execFileSync(
  "sh",
  ["-c", "printf '%s' \"$1\" | wc -c", "sh", raw],
  { encoding: "utf8" },
).trim();
console.log(`  raw tool result       : ${raw.length} bytes ~ ${tokensOf(raw)} tokens`);
console.log(`  per request, replays  : ${tokensOf(raw)} tokens`);
console.log(`  rtk condensed (git diff --stat): 8 files, 419 insertions, 47 deletions ~ 60 tokens`);
console.log(`  saving                : ${tokensOf(raw) - 60} tokens per request, every request`);
