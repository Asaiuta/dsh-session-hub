// src/invariant.ts
function invariant(condition, message) {
  if (!condition) throw new Error(`dsh-session-hub: ${message}`);
}
export {
  invariant
};
//# sourceMappingURL=invariant.js.map
