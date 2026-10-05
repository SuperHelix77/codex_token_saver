// Reasoning effort is a multiplier on thinking tokens, and thinking tokens are
// billed as output. Measure it rather than assume the ratio.
// Portable credential/router resolution. See bench/tool-tax.mjs for env vars.
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const SECRET_PATH = process.env.ROUTER_SECRET
  || path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "codex-router", "caller-secret");
const KEY = readFileSync(SECRET_PATH, "utf8").trim();
const ROUTER = process.env.ROUTER_URL || "http://127.0.0.1:4202/v1/responses";

async function run(model, effort, prompt) {
  const body = { model, stream: true, max_output_tokens: 900,
    input: [{ role: "user", content: [{ type: "input_text", text: prompt }] }] };
  if (effort) body.reasoning = { effort };
  const res = await fetch("http://127.0.0.1:4202/v1/responses", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let out = null, inp = null, reasoning = null;
  for (const b of text.split("\n\n")) {
    const l = b.split("\n").find((x) => x.startsWith("data: "));
    if (!l) continue;
    const raw = l.slice(6).trim();
    if (!raw || raw === "[DONE]") continue;
    try {
      const e = JSON.parse(raw);
      const u = e.response?.usage;
      if (u) { inp = u.input_tokens ?? inp; out = u.output_tokens ?? out;
               reasoning = u.output_tokens_details?.reasoning_tokens ?? reasoning; }
    } catch {}
  }
  return { status: res.status, inp, out, reasoning };
}

const P = "A tap sequence is 16 frames long and must alternate A and B, starting with A. How many valid sequences exist? Answer with the number only.";
for (const effort of ["low", "medium", "high", "max"]) {
  const r = await run("gpt-6-luna", effort, P);
  console.log(`luna/${effort.padEnd(7)} status=${r.status} in=${r.inp} out=${r.out} reasoning=${r.reasoning ?? "n/a"}`);
}
