// Run with: node server/docker.check.ts
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// Plugin sources use extensionless imports; let plain node resolve them.
registerHooks({
  resolve: (spec, context, next) => {
    try {
      return next(spec, context);
    } catch {
      return next(`${spec}.ts`, context);
    }
  },
});
const { hostPorts, memoryBytes } = await import("./docker.ts");

assert.deepEqual(hostPorts("0.0.0.0:5432->5432/tcp, [::]:5432->5432/tcp"), ["5432"]);
assert.deepEqual(hostPorts("0.0.0.0:8080->80/tcp, 0.0.0.0:8443->443/tcp"), ["8080", "8443"]);
assert.deepEqual(hostPorts("5432/tcp"), []);
assert.deepEqual(hostPorts(""), []);
assert.equal(memoryBytes("784.8MiB / 24.4GiB"), 784.8 * 1024 ** 2);
assert.equal(memoryBytes("1.5GiB / 24.4GiB"), 1.5 * 1024 ** 3);
assert.equal(memoryBytes("512kB / 1GB"), 512e3);
assert.equal(memoryBytes("0B / 0B"), 0);
assert.equal(memoryBytes("--"), 0);
console.log("ok");
