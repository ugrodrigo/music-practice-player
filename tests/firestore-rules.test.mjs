import { readFile } from 'node:fs/promises';
import { before, after, beforeEach, test } from 'node:test';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, collection, collectionGroup, getDoc, getDocs, setDoc, updateDoc, deleteDoc, writeBatch, setLogLevel } from 'firebase/firestore';

const projectId = 'demo-music-practice';
if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:18080') throw Error('Only the local test emulator is allowed');
let env;
const data = (payload = '"private note"', revision = 1) => ({ payload, revision });
const notes = db => doc(db, 'users/alice/items/notes');
const cueId = `track-${'a'.repeat(64)}-cue-0`;
before(async () => {
  setLogLevel('silent');
  env = await initializeTestEnvironment({ projectId, firestore: {
    host: '127.0.0.1', port: 18080,
    rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8'),
  }});
});
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(notes(context.firestore()), data());
  });
});
after(async () => { await env?.cleanup(); });

test('signed-out clients cannot read, list, create, update or delete private data', async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertFails(getDoc(notes(db)));
  await assertFails(getDocs(collection(db, 'users/alice/items')));
  await assertFails(setDoc(doc(db, `users/alice/items/${cueId}`), data('null')));
  await assertFails(updateDoc(notes(db), data('"overwrite"', 2)));
  await assertFails(deleteDoc(notes(db)));
});
test('another account cannot read, list, create, overwrite or delete Alice data', async () => {
  const db = env.authenticatedContext('bob').firestore();
  await assertFails(getDoc(notes(db)));
  await assertFails(getDocs(collection(db, 'users/alice/items')));
  await assertFails(setDoc(doc(db, `users/alice/items/${cueId}`), data('null')));
  await assertFails(setDoc(notes(db), data('"overwrite"', 2)));
  await assertFails(deleteDoc(notes(db)));
  await assertSucceeds(setDoc(doc(db, 'users/bob/items/notes'), data('"Bob"')));
});
test('owner can read and list their data and write valid notes and cue revisions', async () => {
  const db = env.authenticatedContext('alice').firestore();
  await assertSucceeds(getDoc(notes(db)));
  await assertSucceeds(getDocs(collection(db, 'users/alice/items')));
  await assertSucceeds(updateDoc(notes(db), data('"updated"', 2)));
  const cue = doc(db, `users/alice/items/${cueId}`);
  await assertSucceeds(setDoc(cue, data('{"time":3,"name":"Intro"}')));
  await assertSucceeds(setDoc(cue, data('null', 2)));
});
test('revisions cannot be skipped, reused, negative, fractional or strings', async () => {
  const db = env.authenticatedContext('alice').firestore();
  for (const revision of [0, 1, 3, -1, 1.5, '2']) {
    await assertFails(setDoc(notes(db), data('"bad"', revision)));
  }
  await assertFails(setDoc(doc(db, `users/alice/items/${cueId}`), data('null', 2)));
});
test('missing fields, wrong types, excess size and injected fields are rejected', async () => {
  const db = env.authenticatedContext('alice').firestore();
  for (const invalid of [
    { revision: 2 }, { payload: '"text"' }, data({}, 2), data(null, 2),
    data('x'.repeat(200001), 2), { ...data('"text"', 2), admin: true },
  ]) await assertFails(setDoc(notes(db), invalid));
  await assertSucceeds(setDoc(notes(db), data('x'.repeat(200000), 2)));
});
test('unknown documents, nested paths, account listing and collection-group queries are denied', async () => {
  const db = env.authenticatedContext('alice').firestore();
  for (const path of ['users/alice', 'users/alice/items/settings', 'users/alice/items/track-123-cue-0', 'users/alice/items/notes/nested/secret', 'admin/settings']) {
    await assertFails(setDoc(doc(db, path), data()));
    // Owners can read missing item IDs, but cannot create unsupported items.
    if (path.split('/').length === 4 && path.startsWith('users/alice/items/')) {
      await assertSucceeds(getDoc(doc(db, path)));
    } else await assertFails(getDoc(doc(db, path)));
  }
  await assertFails(getDocs(collection(db, 'users')));
  await assertFails(getDocs(collectionGroup(db, 'items')));
});
test('one forbidden write rejects an entire batch, and deletes remain forbidden', async () => {
  const db = env.authenticatedContext('alice').firestore();
  const batch = writeBatch(db);
  batch.update(notes(db), data('"changed"', 2));
  batch.set(doc(db, 'users/bob/items/notes'), data());
  await assertFails(batch.commit());
  const snapshot = await assertSucceeds(getDoc(notes(db)));
  if (snapshot.data().revision !== 1) throw Error('Rejected batch changed data');
  await assertFails(deleteDoc(notes(db)));
});
