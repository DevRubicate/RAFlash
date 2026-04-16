/**
 * RAEngine Hello World Tests
 *
 * Basic tests to verify the Deno test infrastructure works.
 */

import { test, assertEqual } from "../../tests/framework.ts";

test("hello world - basic assertion", () => {
    assertEqual(true, true);
});

test("hello world - math works", () => {
    assertEqual(1 + 1, 2);
});

test("hello world - strings", () => {
    assertEqual("hello", "hello");
});
