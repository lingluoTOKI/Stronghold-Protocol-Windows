// test/helpers/profile-test.mjs — profile-gated test() handles.
//
// A test file that asserts PRISTINE UPSTREAM behaviour (vanilla-only) starts with:
//   import { test } from '../helpers/profile-test.mjs';   // defaults to vanilla-only when the file asserts upstream
// or explicitly:
//   import { vanillaTest as test } from '../helpers/profile-test.mjs';
//   import { rhineTest as test }   from '../helpers/profile-test.mjs';
// Under any other profile the file's cases are reported as skipped (not failures), so `npm test` can run the SAME
// test tree under both profiles without cross-contaminating them.

import nodeTest from 'node:test';

const PROFILE = process.env.SP_TEST_PROFILE === 'vanilla' ? 'vanilla' : 'rhine';

/** Runs only under the pristine upstream profile; skipped under rhine. */
export const vanillaTest = PROFILE === 'vanilla' ? nodeTest : nodeTest.skip;
/** Runs only under the Rhine overlay profile; skipped under vanilla. */
export const rhineTest = PROFILE === 'rhine' ? nodeTest : nodeTest.skip;
/** Runs under both profiles (the common case — upstream behaviour the overlay preserves). */
export const test = nodeTest;

export const PROFILE_NAME = PROFILE;
