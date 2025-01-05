/**
 * RAEngine Hello World Tests
 *
 * Basic tests to verify the Deno test infrastructure works.
 */

import { assertEquals } from "https://deno.land/std/assert/mod.ts";

Deno.test("hello world - basic assertion", () => {
    assertEquals(true, true);
});

Deno.test("hello world - math works", () => {
    assertEquals(1 + 1, 2);
});

Deno.test("hello world - strings", () => {
    assertEquals("hello", "hello");
});
