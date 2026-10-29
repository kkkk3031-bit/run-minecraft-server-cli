// Runs the real launcher-template.bat in cmd.exe against the mock CraftHost API,
// feeding menu choices on stdin. Windows only (CI runs it on windows-latest).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, openSync, closeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startMock, TOKEN } from "./helpers/mock-crafthost.mjs";

const WIN = process.platform === "win32";
const TEMPLATE = fileURLToPath(new URL("../launcher-template.bat", import.meta.url));
let mock;

before(async () => { if (WIN) mock = await startMock(); });
after(() => mock?.close());

/** Copies the template with BASE/TOKEN pointed at the mock, runs it with `input` on stdin. */
function runBat(input, token = TOKEN) {
  const dir = mkdtempSync(join(tmpdir(), "bat-"));
  const bat = join(dir, "start-test.bat");
  const src = readFileSync(TEMPLATE, "utf-8")
    .replace(/set "BASE=[^"]*"/, `set "BASE=${mock.url}"`)
    .replace(/set "TOKEN=[^"]*"/, `set "TOKEN=${token}"`);
  writeFileSync(bat, src);
  const inputFile = join(dir, "input.txt");
  writeFileSync(inputFile, input.join("\r\n") + "\r\n");
  // stdin is a real file handle — the same as `start-test.bat < input.txt`, with no cmd quoting rules involved.
  const stdin = openSync(inputFile, "r");
  const child = spawn("cmd.exe", ["/d", "/c", bat], { stdio: [stdin, "pipe", "pipe"], cwd: dir });
  let out = "", err = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (err += d));
  const timer = setTimeout(() => child.kill(), 120000);
  return new Promise((ok) => child.on("close", (code) => {
    clearTimeout(timer);
    closeSync(stdin);
    ok({ code, out, err, all: `--- stdout ---\n${out}\n--- stderr ---\n${err}` });
  }));
}

test("menu shows all four status lines from the API", { skip: !WIN && "Windows only" }, async () => {
  const r = await runBat(["0"]);
  assert.match(r.out, /Status : online/, r.all);
  assert.match(r.out, /Address: amber-creeper\.joinmc\.link/, r.all);
  assert.match(r.out, /Type\s+: paper 1\.21\.1/, r.all);
  assert.match(r.out, /Players: 2\/20/, r.all);
});

test("refresh then exit consumes exactly two menu inputs", { skip: !WIN && "Windows only" }, async () => {
  const r = await runBat(["4", "0"]);
  assert.equal((r.out.match(/Select an option/g) || []).length, 2, r.all);
});

test("stop sends POST /stop and shows the reply", { skip: !WIN && "Windows only" }, async () => {
  const r = await runBat(["2", "", "0"]);
  assert.match(r.out, /OK stopping/, r.all);
  assert.ok(mock.requests.some((q) => q.method === "POST" && q.path === `/api/launcher/${TOKEN}/stop`));
});

test("start on an online server says it's already online", { skip: !WIN && "Windows only" }, async () => {
  const r = await runBat(["1", "0"]);
  assert.match(r.out, /already online/, r.all);
});
