/**
 * WASM memory management for manifold-3d objects.
 *
 * manifold-3d objects live in WASM memory and must be freed with `.delete()`. Instead of
 * sprinkling deletes everywhere, all geometry code runs inside `withScope(fn)`:
 *
 *   const body = withScope(() => {
 *     const a = kit.prism(...);          // tracked automatically
 *     const b = a.translate([0, 0, 1]);  // tracked automatically
 *     return a.add(b);                   // survives; a and b are deleted
 *   });
 *
 * Tracking: once `initManifold()` has run, every Manifold / CrossSection returned by any
 * manifold-3d constructor, static or method is registered automatically (see
 * `instrumentManifold`), including intermediates nobody kept a reference to. `keep(o)`
 * registers an object explicitly (idempotent) and returns it.
 *
 * Ownership: an object belongs to the innermost scope active when it was first tracked.
 * When a scope ends, every object it owns is deleted EXCEPT those reachable from the
 * return value (the value itself, or Manifolds/CrossSections inside returned arrays /
 * plain objects, up to 3 levels deep); those are handed to the parent scope (or, at top
 * level, to the caller, who must delete them). If `fn` throws, everything it owns is
 * deleted and the error is rethrown. `fn` must be synchronous.
 *
 * `liveObjectCount()` returns the number of tracked objects not yet deleted — tests
 * assert it returns to its baseline after a build.
 */

export interface Deletable {
  delete(): void;
}

interface Handle extends Deletable {
  isDeleted(): boolean;
}

const live = new Set<Handle>();
const owner = new WeakMap<Handle, Set<Handle>>();
const stack: Array<Set<Handle>> = [];

export function isHandle(o: unknown): o is Handle {
  if (typeof o !== 'object' || o === null) return false;
  try {
    return typeof (o as Handle).delete === 'function' && typeof (o as Handle).isDeleted === 'function';
  } catch {
    return false; // exotic objects (e.g. proxies that throw on unknown properties)
  }
}

function isDeleted(o: Handle): boolean {
  try {
    return o.isDeleted();
  } catch {
    return true;
  }
}

/** Register a WASM object with the innermost active scope (no-op if already tracked). */
export function track<T>(o: T): T {
  if (!isHandle(o) || live.has(o) || isDeleted(o)) return o;
  live.add(o);
  const scope = stack[stack.length - 1];
  if (scope) {
    scope.add(o);
    owner.set(o, scope);
  }
  return o;
}

/** Explicitly keep (track) an object; returns it. Same as track() but typed for Kit.keep. */
export function keep<T extends Deletable>(o: T): T {
  return track(o);
}

function dispose(o: Handle): void {
  live.delete(o);
  owner.delete(o);
  if (!isDeleted(o)) o.delete();
}

function collectHandles(value: unknown, out: Set<Handle>, depth: number): void {
  if (isHandle(value)) {
    out.add(value);
    return;
  }
  if (depth <= 0 || value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const v of value) collectHandles(v, out, depth - 1);
    return;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return; // only plain objects
  for (const v of Object.values(value)) collectHandles(v, out, depth - 1);
}

/** Run `fn` in a new scope; see the module docs for ownership rules. */
export function withScope<T>(fn: () => T): T {
  const scope = new Set<Handle>();
  stack.push(scope);
  let result: T;
  try {
    result = fn();
    if (result && typeof (result as { then?: unknown }).then === 'function') {
      throw new TypeError('withScope(fn): fn must be synchronous');
    }
  } catch (err) {
    stack.pop();
    for (const o of scope) dispose(o);
    throw err;
  }
  stack.pop();
  const escaping = new Set<Handle>();
  collectHandles(result, escaping, 3);
  const parent = stack[stack.length - 1];
  for (const o of scope) {
    if (escaping.has(o) && !isDeleted(o)) {
      if (parent) {
        parent.add(o);
        owner.set(o, parent);
      } else {
        owner.delete(o);
      }
    } else {
      dispose(o);
    }
  }
  return result;
}

/** Number of tracked WASM objects that have not been deleted yet. */
export function liveObjectCount(): number {
  for (const o of live) if (isDeleted(o)) live.delete(o);
  return live.size;
}

/** Current scope nesting depth (0 = no active scope). */
export function scopeDepth(): number {
  return stack.length;
}

// ---------------------------------------------------------------------------
// Automatic tracking of manifold-3d objects
// ---------------------------------------------------------------------------

const WRAPPED = Symbol('switchcover.tracked');
const SKIP = new Set(['constructor', 'delete', 'isDeleted', 'deleteLater', 'isAliasOf', 'clone']);
const FN_META = new Set(['length', 'name', 'prototype', 'arguments', 'caller']);

// WASM boundary: manifold-3d's classes are plain JS functions/embind classes; we patch them
// generically, so the patched members are typed loosely here.
type AnyFn = ((...args: unknown[]) => unknown) & { [WRAPPED]?: true };

function trackResult(r: unknown): unknown {
  if (Array.isArray(r)) for (const e of r) track(e);
  else track(r);
  return r;
}

function wrapFn(fn: AnyFn): AnyFn {
  if (fn[WRAPPED]) return fn;
  const wrapped = function (this: unknown, ...args: unknown[]) {
    return trackResult(fn.apply(this, args));
  } as AnyFn;
  // Embind overload dispatchers look up `proto[name].overloadTable` at call time, so the
  // wrapper must carry the original function's own properties.
  for (const key of Reflect.ownKeys(fn)) {
    if (typeof key === 'string' && FN_META.has(key)) continue;
    const desc = Object.getOwnPropertyDescriptor(fn, key);
    if (desc) Object.defineProperty(wrapped, key, desc);
  }
  wrapped[WRAPPED] = true;
  return wrapped;
}

function patchMembers(obj: object): void {
  for (const name of Object.getOwnPropertyNames(obj)) {
    if (SKIP.has(name) || FN_META.has(name) || name.startsWith('_')) continue;
    const desc = Object.getOwnPropertyDescriptor(obj, name);
    if (!desc || typeof desc.value !== 'function' || !desc.writable) continue;
    Object.defineProperty(obj, name, { ...desc, value: wrapFn(desc.value as AnyFn) });
  }
}

function patchPrototypeChain(proto: object | null): void {
  while (proto && proto !== Object.prototype) {
    // Stop at embind's shared ClassHandle prototype (owns isDeleted/delete/clone).
    if (Object.prototype.hasOwnProperty.call(proto, 'isDeleted')) break;
    patchMembers(proto);
    proto = Object.getPrototypeOf(proto) as object | null;
  }
}

function wrapConstructor(orig: AnyFn): AnyFn {
  if (orig[WRAPPED]) return orig;
  patchMembers(orig); // statics
  const ctor = function (this: unknown, ...args: unknown[]) {
    // manifold-3d's JS wrappers return the embind object explicitly, so calling without
    // `new` is equivalent and `new ctor()` returns this object.
    return track(orig.apply(undefined, args));
  } as AnyFn;
  for (const key of Reflect.ownKeys(orig)) {
    if (typeof key === 'string' && FN_META.has(key)) continue;
    const desc = Object.getOwnPropertyDescriptor(orig, key);
    if (desc) Object.defineProperty(ctor, key, desc);
  }
  Object.defineProperty(ctor, 'prototype', { value: orig.prototype, writable: false });
  ctor[WRAPPED] = true;
  return ctor;
}

/**
 * Patch a manifold-3d toplevel so every returned Manifold / CrossSection is tracked.
 * Called once by initManifold() after setup(). Idempotent.
 */
// WASM boundary: the toplevel is mutated in place; typed as a loose record here.
export function instrumentManifold(wasm: { Manifold: unknown; CrossSection: unknown }): void {
  const top = wasm as unknown as Record<'Manifold' | 'CrossSection', AnyFn>;
  for (const key of ['Manifold', 'CrossSection'] as const) {
    const cls = top[key];
    if (cls[WRAPPED]) continue;
    patchPrototypeChain(cls.prototype as object);
    top[key] = wrapConstructor(cls);
  }
}
