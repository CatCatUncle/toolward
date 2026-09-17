import { strict as assert } from "node:assert";
import { test } from "node:test";
import { globToRegExp, parseFrontmatter, parseJsonc, stripJsonc } from "../dist/core/parse.js";
import { parseTomlLite } from "../dist/core/toml.js";
import { detectHosts, expandHome, knownHosts } from "../dist/collect/hosts.js";

// `join()` uses the host separator, so Windows returns backslashes. The
// separator is the platform's business; these tests are about the path parts.
const slash = (path) => path.replaceAll("\\", "/");

test("stripJsonc removes comments but keeps string contents", () => {
  const input = `{
    // a line comment
    "url": "https://example.com/a#b", /* trailing */
    "list": [1, 2,],
  }`;
  const parsed = JSON.parse(stripJsonc(input));
  assert.equal(parsed.url, "https://example.com/a#b");
  assert.deepEqual(parsed.list, [1, 2]);
});

test("parseJsonc returns undefined instead of throwing", () => {
  assert.equal(parseJsonc("{ not json"), undefined);
  assert.deepEqual(parseJsonc('{"a":1}'), { a: 1 });
});

test("parseFrontmatter reads the YAML subset skills use", () => {
  const { data, body } = parseFrontmatter(
    ["---", "name: demo", "description: Does a thing", "allowed-tools: Bash(git status:*), Read", "---", "", "# Body"].join("\n"),
  );
  assert.equal(data.name, "demo");
  assert.equal(data["allowed-tools"], "Bash(git status:*), Read");
  assert.match(body, /# Body/);
});

test("parseFrontmatter tolerates a file with no frontmatter", () => {
  const { data, body } = parseFrontmatter("# Just markdown\n");
  assert.deepEqual(data, {});
  assert.match(body, /Just markdown/);
});

test("globToRegExp handles ** and *", () => {
  assert.ok(globToRegExp("**/node_modules/**").test("a/b/node_modules/c/d.js"));
  assert.ok(globToRegExp("*.json").test("settings.json"));
  assert.equal(globToRegExp("*.json").test("dir/settings.json"), false);
});

test("parseTomlLite reads a Codex-style MCP server table", () => {
  const toml = [
    'model = "gpt-5.4"',
    "",
    "[mcp_servers.docs]",
    'command = "npx"',
    'args = ["-y", "@acme/docs@1.2.3"]',
    "",
    "[mcp_servers.docs.env]",
    'TOKEN = "abc"    # trailing comment',
    "",
    "[mcp_servers.inline]",
    'command = "uvx"',
    "env = { A = \"1\", B = \"2\" }",
  ].join("\n");
  const parsed = parseTomlLite(toml);
  assert.equal(parsed.model, "gpt-5.4");
  const servers = parsed.mcp_servers;
  assert.deepEqual(servers.docs.args, ["-y", "@acme/docs@1.2.3"]);
  assert.equal(servers.docs.env.TOKEN, "abc");
  assert.deepEqual(servers.inline.env, { A: "1", B: "2" });
});

test("parseTomlLite ignores comments and blank lines without inventing keys", () => {
  const parsed = parseTomlLite("# just a comment\n\n  # another\n");
  assert.deepEqual(parsed, {});
});

test("known hosts cover the mainstream agent clients", () => {
  const ids = knownHosts("/home/u", "linux").map((host) => host.id);
  for (const id of ["claude-code", "codex", "cursor", "vscode", "cline", "zed", "gemini-cli"]) {
    assert.ok(ids.includes(id), `missing host ${id}`);
  }
  assert.equal(new Set(ids).size, ids.length, "duplicate host id");
  for (const host of knownHosts("/home/u", "linux")) {
    assert.ok(host.paths.length > 0, `${host.id} has no paths`);
    for (const path of host.paths) assert.ok(slash(path).startsWith("/home/u"), `${host.id}: ${path} escapes home`);
  }
});

test("host paths follow the platform convention", () => {
  const mac = knownHosts("/Users/u", "darwin").find((h) => h.id === "claude-desktop");
  assert.match(slash(mac.paths[0]), /Library\/Application Support\/Claude/);
  const linux = knownHosts("/home/u", "linux").find((h) => h.id === "claude-desktop");
  assert.match(slash(linux.paths[0]), /\.config\/Claude/);
});

test("a custom host path from the config file may start with ~", () => {
  assert.equal(slash(expandHome("~/.myagent/mcp.json", "/home/u")), "/home/u/.myagent/mcp.json");
  assert.equal(expandHome("~", "/home/u"), "/home/u");
  assert.equal(expandHome("/etc/agent.json", "/home/u"), "/etc/agent.json");
  assert.equal(expandHome("./local/~weird", "/home/u"), "./local/~weird");
});

test("a custom host with no files on disk is not reported as detected", () => {
  const detected = detectHosts([{ name: "My Agent", paths: ["~/definitely-not-here/mcp.json"] }], "/home/u");
  assert.ok(!detected.some((host) => host.id === "my-agent"));
});
