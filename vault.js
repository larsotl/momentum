/* Encrypted storage.
 * All app data is one JSON document, encrypted with AES-GCM using a key
 * derived from the user's passphrase (PBKDF2-SHA256, 310k iterations).
 * The passphrase and key never leave the device and are never stored.
 */
(function (root) {
  'use strict';
  const DB_NAME = 'momentum';
  const STORE = 'kv';
  const VAULT_KEY = 'vault';
  const ITERATIONS = 310000;
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function idbGet(key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const r = db.transaction(STORE).objectStore(STORE).get(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  async function idbSet(key, val) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(val, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  function b64(buf) {
    const bytes = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function unb64(str) {
    const s = atob(str);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  async function deriveKey(passphrase, salt, iterations) {
    const base = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  async function seal(key, salt, iterations, obj) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
    return { app: 'momentum', format: 1, kdf: 'PBKDF2-SHA256', iterations, salt: b64(salt), iv: b64(iv), data: b64(ct) };
  }
  async function open(key, blob) {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(blob.iv) }, key, unb64(blob.data));
    return JSON.parse(dec.decode(pt));
  }

  // Session (in memory only)
  let session = null; // { key, salt, iterations }

  const Vault = {
    async exists() { return !!(await idbGet(VAULT_KEY)); },

    async create(passphrase, initialState) {
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const key = await deriveKey(passphrase, salt, ITERATIONS);
      session = { key, salt, iterations: ITERATIONS };
      await idbSet(VAULT_KEY, await seal(key, salt, ITERATIONS, initialState));
      if (navigator.storage && navigator.storage.persist) { try { await navigator.storage.persist(); } catch (e) {} }
      return initialState;
    },

    async unlock(passphrase) {
      const blob = await idbGet(VAULT_KEY);
      if (!blob) throw new Error('No data on this device');
      const salt = unb64(blob.salt);
      const key = await deriveKey(passphrase, salt, blob.iterations);
      let state;
      try { state = await open(key, blob); } catch (e) { throw new Error('Wrong passphrase'); }
      session = { key, salt, iterations: blob.iterations };
      if (navigator.storage && navigator.storage.persist) { try { await navigator.storage.persist(); } catch (e) {} }
      return state;
    },

    async save(state) {
      if (!session) throw new Error('Locked');
      await idbSet(VAULT_KEY, await seal(session.key, session.salt, session.iterations, state));
    },

    async changePassphrase(oldPass, newPass, state) {
      const blob = await idbGet(VAULT_KEY);
      const oldKey = await deriveKey(oldPass, unb64(blob.salt), blob.iterations);
      try { await open(oldKey, blob); } catch (e) { throw new Error('Current passphrase is wrong'); }
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const key = await deriveKey(newPass, salt, ITERATIONS);
      session = { key, salt, iterations: ITERATIONS };
      await idbSet(VAULT_KEY, await seal(key, salt, ITERATIONS, state));
    },

    // Backup file = same encrypted format, readable only with the passphrase used when it was made
    async exportBackup(state) {
      if (!session) throw new Error('Locked');
      return seal(session.key, session.salt, session.iterations, state);
    },

    async readBackup(blob, passphrase) {
      if (!blob || blob.app !== 'momentum' || !blob.data) throw new Error('Not a Momentum backup file');
      const key = await deriveKey(passphrase, unb64(blob.salt), blob.iterations);
      try { return await open(key, blob); } catch (e) { throw new Error('Wrong passphrase for this backup'); }
    },

    lock() { session = null; },
    isUnlocked() { return !!session; }
  };

  root.Vault = Vault;
})(this);
