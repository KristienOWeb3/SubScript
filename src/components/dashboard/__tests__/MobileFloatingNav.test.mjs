import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function mountNav({ delayedContainer = false } = {}) {
  const effects = [];
  const windowTarget = new EventTarget();
  const container = new EventTarget();
  container.scrollTop = 0;
  let found = !delayedContainer;
  let poll;
  let nextFrame = 0;
  const frames = new Map();
  const cancelled = [];
  const states = [];
  const registrations = [];
  const removals = [];
  for (const target of [windowTarget, container]) {
    const add = target.addEventListener.bind(target);
    const remove = target.removeEventListener.bind(target);
    target.addEventListener = (type, callback, options) => {
      registrations.push({ target, type, callback });
      add(type, callback, options);
    };
    target.removeEventListener = (type, callback) => {
      removals.push({ target, type, callback });
      remove(type, callback);
    };
  }
  const source = fs.readFileSync("src/components/dashboard/MobileFloatingNav.tsx", "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    require(id) {
      if (id === "react") return {
        useEffect: (effect) => effects.push(effect),
        useLayoutEffect: () => {},
        useId: () => "nav-selection",
        useRef: (current) => ({ current }),
        useCallback: (fn) => fn,
        useState: (initial) => {
          let value = initial;
          return [value, (next) => {
            value = typeof next === "function" ? next(value) : next;
            states.push(value);
          }];
        },
      };
      if (id === "react/jsx-runtime") return { jsx: () => null, jsxs: () => null };
      if (id === "framer-motion") return { motion: {}, useReducedMotion: () => false };
      return {};
    },
    window: windowTarget,
    document: { querySelector: () => found ? container : null, documentElement: { scrollTop: 0 } },
    Date,
    requestAnimationFrame: (callback) => { frames.set(++nextFrame, callback); return nextFrame; },
    cancelAnimationFrame: (id) => { cancelled.push(id); frames.delete(id); },
    setInterval: (callback) => { poll = callback; return 1; },
    clearInterval: () => { poll = undefined; },
  });
  exports.default({ tabs: [{ id: "home", label: "Home" }], activeTab: "home", onSelectTab() {} });
  const cleanups = effects.map((effect) => effect());
  return {
    container, windowTarget, frames, cancelled, states, registrations, removals,
    findContainer() { found = true; poll?.(); },
    flush() { for (const [id, callback] of frames) { frames.delete(id); callback(); } },
    unmount() { for (const cleanup of cleanups) cleanup?.(); },
  };
}

test("navigation scroll retracts and every listener and queued frame is released on unmount", () => {
  const nav = mountNav();
  nav.container.scrollTop = 40;
  nav.container.dispatchEvent(new Event("scroll"));
  nav.flush();
  assert.equal(nav.states.at(-1), true);
  nav.container.scrollTop = 80;
  nav.container.dispatchEvent(new Event("scroll"));
  assert.equal(nav.frames.size, 1);
  nav.unmount();
  assert.equal(nav.frames.size, 0);
  assert.equal(nav.cancelled.length, 1);
  for (const listener of nav.registrations) {
    assert.ok(nav.removals.some((removed) => removed.target === listener.target &&
      removed.type === listener.type && removed.callback === listener.callback));
  }
  nav.container.dispatchEvent(new Event("scroll"));
  nav.windowTarget.dispatchEvent(new Event("scroll"));
  assert.equal(nav.frames.size, 0);
});

test("navigation removes the scroll listener when its container appears after mount", () => {
  const nav = mountNav({ delayedContainer: true });
  nav.findContainer();
  nav.unmount();
  nav.container.dispatchEvent(new Event("scroll"));
  assert.equal(nav.frames.size, 0);
  assert.equal(nav.registrations.length, nav.removals.length);
});
